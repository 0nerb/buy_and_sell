import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PROVIDER_LABEL,
  type ConsolidatedPortfolio,
  type Consensus,
  type ImportProgress,
  type Report,
  type SettingsView
} from '@shared/types'
import { api } from './api'
import { ImportPanel } from './components/ImportPanel'
import { Portfolio } from './components/Portfolio'
import { Recommendations } from './components/Recommendations'
import { Reports } from './components/Reports'
import { Settings } from './components/Settings'

type Tab = 'carteira' | 'recomendacoes' | 'relatorios' | 'config'

let uploadSeq = 0

export function App() {
  const [tab, setTab] = useState<Tab>('carteira')
  const [reports, setReports] = useState<Report[]>([])
  const [consensus, setConsensus] = useState<Consensus[]>([])
  const [portfolio, setPortfolio] = useState<ConsolidatedPortfolio | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [progress, setProgress] = useState<ImportProgress[]>([])
  const [dragging, setDragging] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const dragDepth = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [r, c, p, s] = await Promise.all([api.listReports(), api.getConsensus(), api.getPortfolio(), api.getSettings()])
      setReports(r)
      setConsensus(c)
      setPortfolio(p)
      setSettings(s)
      setServerError(null)
    } catch (e) {
      setServerError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const update = (p: ImportProgress) =>
    setProgress((prev) => (prev.some((x) => x.key === p.key) ? prev.map((x) => (x.key === p.key ? p : x)) : [...prev, p]))

  /** Envia os PDFs um a um para o servidor, atualizando o painel de progresso. */
  const importFiles = async (files: File[]) => {
    const queue = files.map((file) => ({ file, key: `${++uploadSeq}` }))
    for (const { file, key } of queue) update({ key, fileName: file.name, status: 'processando' })
    for (const { file, key } of queue) {
      if (!/\.pdf$/i.test(file.name)) {
        update({ key, fileName: file.name, status: 'erro', message: 'Não é PDF' })
        continue
      }
      try {
        const r = await api.importFile(file)
        update(
          r.status === 'duplicado'
            ? { key, fileName: file.name, status: 'duplicado', message: 'Já importado' }
            : { key, fileName: file.name, status: 'ok', message: `${r.report.calls.length} recomendação(ões)` }
        )
        if (r.status === 'ok') refresh()
      } catch (e) {
        update({ key, fileName: file.name, status: 'erro', message: e instanceof Error ? e.message : String(e) })
      }
    }
    refresh()
  }

  const pick = () => fileInput.current?.click()

  // Arrastar e soltar PDFs em qualquer lugar da página.
  useEffect(() => {
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current++
      setDragging(true)
    }
    const onLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) importFiles(files)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const busy = progress.some((p) => p.status === 'processando')

  return (
    <div className="app">
      <header className="topbar">
        <h1>Recomendação</h1>
        <nav>
          <button className={tab === 'carteira' ? 'active' : ''} onClick={() => setTab('carteira')}>
            Carteira consolidada
          </button>
          <button className={tab === 'recomendacoes' ? 'active' : ''} onClick={() => setTab('recomendacoes')}>
            Recomendações
          </button>
          <button className={tab === 'relatorios' ? 'active' : ''} onClick={() => setTab('relatorios')}>
            Relatórios ({reports.length})
          </button>
          <button className={tab === 'config' ? 'active' : ''} onClick={() => setTab('config')}>
            Configurações
          </button>
        </nav>
        <div className="spacer" />
        <div className="actions">
          <button className="primary" onClick={pick} disabled={busy}>
            {busy ? 'Processando…' : 'Importar PDFs'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length) importFiles(files)
            }}
          />
        </div>
      </header>

      <main>
        {serverError && (
          <div className="notice">
            Não foi possível falar com o servidor: {serverError}. Ele está rodando (<code>npm start</code>)?{' '}
            <button className="link" onClick={refresh}>
              Tentar de novo
            </button>
          </div>
        )}

        {settings && !settings.aiReady && tab !== 'config' && (
          <div className="notice">
            {settings.provider === 'claude-code'
              ? 'O Claude (assinatura) não está conectado'
              : `Sem chave de API do ${PROVIDER_LABEL[settings.provider]}`}
            : a busca automática fica desligada e os PDFs são lidos por uma heurística simples, bem menos precisa.{' '}
            <button className="link" onClick={() => setTab('config')}>
              Configurar
            </button>
          </div>
        )}

        {tab === 'carteira' && settings && (
          <Portfolio portfolio={portfolio} settings={settings} onChange={refresh} onOpenSettings={() => setTab('config')} />
        )}
        {tab === 'recomendacoes' && <Recommendations consensus={consensus} onImport={pick} />}
        {tab === 'relatorios' && <Reports reports={reports} onChange={refresh} onImport={pick} />}
        {tab === 'config' && settings && <Settings settings={settings} onChange={setSettings} onSaved={refresh} />}
      </main>

      {dragging && <div className="drop-overlay">Solte os PDFs para importar</div>}
      {progress.length > 0 && <ImportPanel items={progress} onClose={() => setProgress([])} busy={busy} />}
    </div>
  )
}
