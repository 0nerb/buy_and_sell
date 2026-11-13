import { createHash } from 'node:crypto'
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
import { getQuotes, pricesInfo, refreshMissingInBackground, refreshPrices } from './prices'
import { currentJob, isRunning, startSearch, subscribe } from './searchJob'
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

/** Porta padrão longe da 3000, que costuma estar ocupada por outros projetos (Next.js, React…). */
const DEFAULT_PORT = 3100
const PORT_FROM_ENV = process.env.PORT ? Number(process.env.PORT) : null
const PORT = PORT_FROM_ENV ?? DEFAULT_PORT
/** `npm run dev`: a interface é servida pelo Vite (porta 5173), não por este servidor. */
const DEV = process.argv.includes('--dev')
const HOST = '127.0.0.1'
const WEB_DIR = resolve('dist/web')
const WEB_DIR_RELATIVE = 'dist/web' // serveStatic resolve a partir do diretório atual
const PROVIDERS: ProviderId[] = ['claude-code', 'anthropic', 'gemini']
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
  const result = await importPdf(name, data)
  if (result.status === 'ok') refreshMissingInBackground()
  return c.json(result)
})

// "Reler PDF": o arquivo não fica guardado, então a pessoa envia de novo.
// Precisa ser o mesmo arquivo (mesmo conteúdo) do relatório escolhido.
app.post('/api/reports/:id/reread', async (c) => {
  const report = findReport(c.req.param('id'))
  if (report.source === 'web') throw new HttpError(400, 'Carteiras da web não vêm de PDF.')
  const data = Buffer.from(await c.req.arrayBuffer())
  if (createHash('sha256').update(data).digest('hex') !== report.id) {
    throw new HttpError(409, `Este não é o mesmo arquivo do relatório "${report.fileName}".`)
  }
  const result = await importPdf(report.fileName, data, true)
  if (result.status === 'ok') refreshMissingInBackground()
  return c.json(result)
})

app.patch('/api/reports/:id', async (c) => {
  const report = findReport(c.req.param('id'))
  const body = await c.req.json<{ institution?: string; reportDate?: string; sourceUrl?: string | null }>()
  if (body.reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.reportDate)) throw new HttpError(400, 'Data inválida.')
  const url = body.sourceUrl?.trim()
  if (url && !/^https?:\/\/\S+$/.test(url)) throw new HttpError(400, 'O link precisa começar com http:// ou https://')
  saveReport({
    ...report,
    institution: body.institution?.trim() || report.institution,
    reportDate: body.reportDate || report.reportDate,
    sourceUrl: body.sourceUrl === undefined ? report.sourceUrl : url || null,
    // Link trocado à mão deixa de ser "verificado pela busca".
    sourceVerified: body.sourceUrl === undefined || url === report.sourceUrl ? report.sourceVerified : false
  })
  return c.json({ ok: true })
})

app.delete('/api/reports/:id', (c) => {
  deleteReport(findReport(c.req.param('id')).id)
  return c.json({ ok: true })
})


// ---------- Consenso e carteira ----------
app.get('/api/consensus', (c) => c.json(buildConsensus(getReports(), getSettings(), new Date(), getQuotes())))
app.get('/api/portfolio', (c) => c.json(buildConsolidated(getReports(), getSettings(), new Date(), getQuotes())))

// ---------- Cotações ----------
app.get('/api/prices', (c) => c.json(pricesInfo()))
app.post('/api/prices/refresh', async (c) => {
  try {
    return c.json(await refreshPrices())
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err))
  }
})

app.get('/api/search', (c) => c.json(currentJob()))

app.post('/api/search', async (c) => {
  const { month } = await c.req.json<{ month: string }>()
  if (!/^\d{4}-\d{2}$/.test(month ?? '')) throw new HttpError(400, 'Mês inválido.')
  if (isRunning()) throw new HttpError(409, 'Já existe uma busca em andamento.')
  return c.json(startSearch(month), 202)
})

// Server-Sent Events: manda a situação atual e cada atualização até a busca terminar.
app.get('/api/search/events', (c) =>
  streamSSE(c, async (stream) => {
    const job = currentJob()
    if (!job) return
    await stream.writeSSE({ event: 'job', data: JSON.stringify(job) })
    if (job.finishedAt) return
    await new Promise<void>((resolve) => {
      const unsubscribe = subscribe((j) => {
        stream.writeSSE({ event: 'job', data: JSON.stringify(j) }).catch(() => {})
        if (j.finishedAt) done()
      })
      // Mantém a conexão viva em proxies e detecta quem fechou a aba.
      const ping = setInterval(() => stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}), 15_000)
      function done() {
        clearInterval(ping)
        unsubscribe()
        resolve()
      }
      stream.onAbort(done)
    })
  })
)

// ---------- Configurações ----------
app.get('/api/models/:provider', async (c) => {
  const p = await createProvider(provider(c.req.param('provider')))
  return c.json(p ? await p.listModels() : [])
})

app.get('/api/settings', async (c) => c.json(await getSettingsView(c.req.query('refresh') === '1')))

app.patch('/api/settings', async (c) => {
  const patch = await c.req.json<Partial<Settings>>()
  if (patch.provider) provider(patch.provider)
  saveSettings(patch)
  return c.json(await getSettingsView('claudeCodePath' in patch))
})

app.put('/api/settings/keys/:provider', async (c) => {
  const { key } = await c.req.json<{ key: string | null }>()
  const id = provider(c.req.param('provider'))
  if (id === 'claude-code') throw new HttpError(400, 'O Claude por assinatura usa o login do Claude Code, não uma chave.')
  setApiKey(id, key)
  return c.json(await getSettingsView())
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

/** Tenta abrir o servidor numa porta; resolve false se ela já estiver em uso. */
function listen(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: HOST }, () => resolve(true))
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        server.close()
        resolve(false)
      } else reject(err)
    })
  })
}

async function start() {
  // Com porta fixa (variável PORT) ou em modo dev (o Vite repassa /api para essa porta),
  // não dá para trocar sozinho: avisa com clareza. No "npm start", procura a próxima livre.
  const canMove = !DEV && PORT_FROM_ENV === null
  let port = PORT
  for (let tries = 0; ; tries++) {
    if (await listen(port)) break
    if (!canMove || tries >= 20) {
      console.error(
        `\n  A porta ${port} já está em uso por outro programa.\n` +
          `  Feche o programa que está usando essa porta ou escolha outra, por exemplo:\n` +
          `    PORT=${port + 1} npm ${DEV ? 'run dev' : 'start'}\n` +
          `  (no Windows PowerShell: $env:PORT=${port + 1}; npm ${DEV ? 'run dev' : 'start'})\n`
      )
      process.exit(1)
    }
    console.warn(`  A porta ${port} já está em uso; tentando a ${port + 1}…`)
    port++
  }

  const url = DEV ? 'http://localhost:5173' : existsSync(WEB_DIR) ? `http://localhost:${port}` : null
  if (!url) {
    console.error('Interface não encontrada em dist/web. Rode "npm start" (que faz o build) ou "npm run dev".')
    return
  }
  console.log(`\n  Recomendação rodando em ${url}\n  Dados em ${DATA_DIR}\n`)
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
