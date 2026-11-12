import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { buildConsensus } from '@shared/consensus'
import { buildConsolidated } from '@shared/portfolio'
import type { ProviderId, Settings } from '@shared/types'
import { AIError, createProvider } from './ai'
import { ImportError, importPdf } from './importer'
import { searchPortfolios } from './search'
import {
  DATA_DIR,
  deleteReport,
  getReports,
  getSettings,
  getSettingsView,
  saveReport,
  saveSettings,
  setApiKey
} from './store'

const PORT = Number(process.env.PORT ?? 3000)
/** `npm run dev`: a interface é servida pelo Vite (porta 5173), não por este servidor. */
const DEV = process.argv.includes('--dev')
const HOST = '127.0.0.1'
const WEB_DIR = resolve('dist/web')
const WEB_DIR_RELATIVE = 'dist/web' // serveStatic resolve a partir do diretório atual
const PROVIDERS: ProviderId[] = ['anthropic', 'gemini']
const MAX_UPLOAD = 60 * 1024 * 1024

const app = new Hono()

/** Erros esperados (mensagem pode ir para a tela) viram 400; o resto, 500. */
class HttpError extends Error {
  constructor(public status: 400 | 404 | 409 | 413, message: string) {
    super(message)
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status)
  if (err instanceof AIError || err instanceof ImportError) return c.json({ error: err.message }, 400)
  console.error(err)
  return c.json({ error: 'Erro interno no servidor. Veja o terminal para detalhes.' }, 500)
})

// ---------- Proteções para um servidor local que guarda chaves de API ----------
app.use('*', async (c, next) => {
  // Contra DNS rebinding: só atende quando acessado por localhost.
  const host = (c.req.header('host') ?? '').replace(/:\d+$/, '')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return c.text('Host não permitido', 403)
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
})

app.use('/api/*', async (c, next) => {
  // Cabeçalho próprio força preflight CORS (que não respondemos): outros sites
  // abertos no navegador não conseguem chamar esta API.
  if (c.req.header('x-recomendacao') !== '1') return c.json({ error: 'Requisição não permitida' }, 403)
  await next()
})

const provider = (id: string): ProviderId => {
  if (!PROVIDERS.includes(id as ProviderId)) throw new HttpError(400, 'Provedor desconhecido.')
  return id as ProviderId
}

const findReport = (id: string) => {
  const report = getReports().find((r) => r.id === id)
  if (!report) throw new HttpError(404, 'Relatório não encontrado.')
  return report
}

// ---------- Relatórios ----------
app.get('/api/reports', (c) => c.json(getReports()))

app.post('/api/reports', async (c) => {
  const name = c.req.query('name') ?? 'relatorio.pdf'
  if (Number(c.req.header('content-length') ?? 0) > MAX_UPLOAD) throw new HttpError(413, 'Arquivo grande demais (máx. 60 MB).')
  const data = Buffer.from(await c.req.arrayBuffer())
  return c.json(await importPdf(name, data))
})

app.post('/api/reports/:id/reprocess', async (c) => {
  const report = findReport(c.req.param('id'))
  if (!report.filePath || !existsSync(report.filePath)) {
    throw new HttpError(409, 'O PDF original não está na pasta de dados. Importe-o novamente.')
  }
  return c.json(await importPdf(report.fileName, await readFile(report.filePath), true))
})

app.patch('/api/reports/:id', async (c) => {
  const report = findReport(c.req.param('id'))
  const body = await c.req.json<{ institution?: string; reportDate?: string }>()
  if (body.reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.reportDate)) throw new HttpError(400, 'Data inválida.')
  saveReport({
    ...report,
    institution: body.institution?.trim() || report.institution,
    reportDate: body.reportDate || report.reportDate
  })
  return c.json({ ok: true })
})

app.delete('/api/reports/:id', (c) => {
  deleteReport(findReport(c.req.param('id')).id)
  return c.json({ ok: true })
})

// O PDF é aberto numa aba nova; essa navegação não manda o cabeçalho x-recomendacao,
// então a rota fica fora de /api. Só serve arquivos de relatórios conhecidos.
app.get('/pdf/:id', async (c) => {
  const report = findReport(c.req.param('id'))
  if (!report.filePath || !existsSync(report.filePath)) throw new HttpError(404, 'PDF não encontrado.')
  c.header('Content-Type', 'application/pdf')
  c.header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(report.fileName)}`)
  return c.body(await readFile(report.filePath))
})

// ---------- Consenso e carteira ----------
app.get('/api/consensus', (c) => c.json(buildConsensus(getReports(), getSettings())))
app.get('/api/portfolio', (c) => c.json(buildConsolidated(getReports(), getSettings())))

let searching = false
app.post('/api/search', async (c) => {
  const { month } = await c.req.json<{ month: string }>()
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new HttpError(400, 'Mês inválido.')
  if (searching) throw new HttpError(409, 'Já existe uma busca em andamento.')
  searching = true
  // Server-Sent Events: o navegador recebe o progresso enquanto a IA pesquisa.
  return streamSSE(c, async (stream) => {
    try {
      const result = await searchPortfolios(month, (p) => stream.writeSSE({ event: 'progress', data: JSON.stringify(p) }))
      await stream.writeSSE({ event: 'result', data: JSON.stringify(result) })
    } catch (err) {
      const message = err instanceof AIError ? err.message : `Falha na busca: ${err instanceof Error ? err.message : err}`
      if (!(err instanceof AIError)) console.error(err)
      await stream.writeSSE({ event: 'progress', data: JSON.stringify({ stage: 'erro', message }) })
    } finally {
      searching = false
    }
  })
})

// ---------- Configurações ----------
app.get('/api/models/:provider', async (c) => {
  const p = createProvider(provider(c.req.param('provider')))
  return c.json(p ? await p.listModels() : [])
})

app.get('/api/settings', (c) => c.json(getSettingsView()))

app.patch('/api/settings', async (c) => {
  const patch = await c.req.json<Partial<Settings>>()
  if (patch.provider) provider(patch.provider)
  saveSettings(patch)
  return c.json(getSettingsView())
})

app.put('/api/settings/keys/:provider', async (c) => {
  const { key } = await c.req.json<{ key: string | null }>()
  setApiKey(provider(c.req.param('provider')), key)
  return c.json(getSettingsView())
})

// ---------- Interface (build de produção) ----------
if (!DEV && existsSync(WEB_DIR)) {
  app.use('/assets/*', serveStatic({ root: WEB_DIR_RELATIVE }))
  app.get('*', async (c) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
    )
    return c.html(await readFile(resolve(WEB_DIR, 'index.html'), 'utf8'))
  })
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  const url = DEV ? 'http://localhost:5173' : existsSync(WEB_DIR) ? `http://localhost:${PORT}` : null
  if (!url) {
    console.error('Interface não encontrada em dist/web. Rode "npm start" (que faz o build) ou "npm run dev".')
  }
  if (url) console.log(`\n  Recomendação rodando em ${url}\n  Dados em ${DATA_DIR}\n`)
})
