import { useEffect, useState } from 'react'
import { elapsed, monthName, type SearchState } from '../useSearch'

/**
 * Faixa fixa logo abaixo do topo, visível em todas as abas:
 * barra animada + etapa atual + tempo enquanto a busca roda;
 * depois, o resultado (ou o erro) até a pessoa fechar.
 */
export function SearchIndicator({ search, onOpen, onPortfolioTab }: {
  search: SearchState
  onOpen: () => void
  onPortfolioTab: boolean
}) {
  const { job, running, showResult } = search
  const [, tick] = useState(0)

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  if (!job || (!running && !showResult)) return null

  if (running) {
    return (
      <div className="search-indicator running" role="status" aria-live="polite">
        <div className="indeterminate" />
        <div className="search-indicator-body">
          <span className="spinner" aria-hidden />
          <strong>Buscando carteiras de {monthName(job.month)}</strong>
          <span className="search-step">{job.progress.message}</span>
          {job.saved > 0 && (
            <span className="search-saved">
              {job.saved} {job.saved === 1 ? 'carteira salva' : 'carteiras salvas'}
            </span>
          )}
          <span className="search-time">{elapsed(job.startedAt)}</span>
          {!onPortfolioTab && (
            <button className="link" onClick={onOpen}>
              Acompanhar
            </button>
          )}
        </div>
      </div>
    )
  }

  const failed = job.progress.stage === 'erro'
  return (
    <div className={`search-indicator ${failed ? 'failed' : 'done'}`} role="status" aria-live="polite">
      <div className="search-indicator-body">
        <span aria-hidden>{failed ? '✕' : '✓'}</span>
        <strong>{failed ? 'A busca falhou' : 'Busca concluída'}</strong>
        <span className="search-step">
          {job.progress.message}
          {job.finishedAt && ` (${elapsed(job.startedAt, job.finishedAt)})`}
        </span>
        {!failed && !onPortfolioTab && (
          <button className="link" onClick={onOpen}>
            Ver carteira
          </button>
        )}
        <button className="link close" onClick={search.dismiss} aria-label="Fechar aviso">
          ×
        </button>
      </div>
    </div>
  )
}
