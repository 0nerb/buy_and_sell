import { useCallback, useEffect, useRef, useState } from 'react'
import { PROVIDER_LABEL, type ConsolidatedPortfolio, type Consensus, type ImportProgress, type Report, type SettingsView } from '@shared/types'
import { ImportPanel } from './components/ImportPanel'
import { Portfolio } from './components/Portfolio'
import { Recommendations } from './components/Recommendations'
import { Reports } from './components/Reports'
import { Settings } from './components/Settings'

type Tab = 'carteira' | 'recomendacoes' | 'relatorios' | 'config'

export function App() {
  const [tab, setTab] = useState<Tab>('carteira')
  const [reports, setReports] = useState<Report[]>([])
  const [consensus, setConsensus] = useState<Consensus[]>([])
  const [portfolio, setPortfolio] = useState<ConsolidatedPortfolio | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const [progress, setProgress] = useState<ImportProgress[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const refresh = useCallback(async () => {
    const [r, c, p, s] = await Promise.all([
      window.api.listReports(),
      window.api.getConsensus(),
      window.api.getPortfolio(),
      window.api.getSettings()
    ])
    setReports(r)
    setConsensus(c)
    setPortfolio(p)
    setSettings(s)
  }, [])

  useEffect(() => {
    refresh()
    return window.api.onImportProgress((p) => {
      setProgress((prev) => {
        const others = prev.filter((x) => x.filePath !== p.filePath)
        return [...others, p]
      })
      if (p.status === 'ok') refresh()
    })
  }, [refresh])

  const runImport = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
    } finally {
      refresh()
    }
  }

  const pick = () => runImport(() => window.api.pickAndImport())

  // Arrastar e soltar PDFs em qualquer lugar da janela.
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
      if (files.length) runImport(() => window.api.importFiles(files))
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
        </div>
      </header>

      <main>
        {settings && !settings.aiReady && tab !== 'config' && (
          <div className="notice">
            Sem chave de API do {PROVIDER_LABEL[settings.provider]}: a busca automática fica desligada e os PDFs são
            lidos por uma heurística simples, bem menos precisa.{' '}
            <button className="link" onClick={() => setTab('config')}>
              Configurar chave
            </button>
          </div>
        )}

        {tab === 'carteira' && settings && (
          <Portfolio portfolio={portfolio} settings={settings} onChange={refresh} onOpenSettings={() => setTab('config')} />
        )}
        {tab === 'recomendacoes' && <Recommendations consensus={consensus} onImport={pick} />}
        {tab === 'relatorios' && (
          <Reports reports={reports} onChange={refresh} onImport={pick} runImport={runImport} />
        )}
        {tab === 'config' && settings && <Settings settings={settings} onChange={setSettings} onSaved={refresh} />}
      </main>

      {dragging && <div className="drop-overlay">Solte os PDFs para importar</div>}
      {progress.length > 0 && <ImportPanel items={progress} onClose={() => setProgress([])} busy={busy} />}
    </div>
  )
}
