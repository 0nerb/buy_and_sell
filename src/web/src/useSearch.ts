import { useCallback, useEffect, useRef, useState } from 'react'
import type { SearchJob } from '@shared/types'
import { api } from './api'

/**
 * Estado da busca de carteiras, mantido no topo do app (não dentro de uma
 * tela), para o indicador continuar visível ao trocar de aba. Ao abrir ou
 * recarregar a página, reconecta a uma busca que já esteja rodando no servidor.
 */
export function useSearch(onDataChanged: () => void) {
  const [job, setJob] = useState<SearchJob | null>(null)
  /** Busca cujo aviso de conclusão a pessoa já fechou (ou que terminou antes de abrir a página). */
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const watching = useRef<AbortController | null>(null)
  const finishedRef = useRef(onDataChanged)
  finishedRef.current = onDataChanged

  const watch = useCallback(async () => {
    watching.current?.abort()
    const ctrl = new AbortController()
    watching.current = ctrl
    let last: SearchJob | null = null
    let savedSeen = -1
    for (let attempt = 0; attempt < 5 && !ctrl.signal.aborted; attempt++) {
      try {
        await api.watchSearch((j) => {
          last = j
          setJob(j)
          // Cada carteira é gravada durante a busca: atualiza as telas na hora.
          if (savedSeen >= 0 && j.saved > savedSeen) finishedRef.current()
          savedSeen = j.saved
        }, ctrl.signal)
      } catch {
        if (ctrl.signal.aborted) return
      }
      if ((last as SearchJob | null)?.finishedAt) break
      // Conexão caiu no meio da busca: espera um pouco e reconecta.
      await new Promise((r) => setTimeout(r, 2000))
    }
    if (ctrl.signal.aborted) return
    const seen = last as SearchJob | null
    if (!seen?.finishedAt) {
      // Não deu para acompanhar até o fim: confere se a busca ainda existe no servidor.
      const now = await api.getSearch().catch(() => null)
      if (now && now.startedAt === seen?.startedAt) setJob(now)
      else
        setJob((j) =>
          j && !j.finishedAt
            ? {
                ...j,
                finishedAt: new Date().toISOString(),
                progress: { stage: 'erro', message: 'A busca foi interrompida (o servidor foi reiniciado). Tente de novo.' }
              }
            : j
        )
    }
    finishedRef.current()
  }, [])

  useEffect(() => {
    api
      .getSearch()
      .then((j) => {
        setJob(j)
        if (j?.finishedAt) setDismissed(j.startedAt)
        else if (j) watch()
      })
      .catch(() => {})
    return () => watching.current?.abort()
  }, [watch])

  const start = async (month: string) => {
    setStartError(null)
    try {
      setJob(await api.startSearch(month))
      watch()
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e))
    }
  }

  const running = !!job && !job.finishedAt
  return {
    job,
    running,
    start,
    startError,
    /** Mostrar o aviso de conclusão? */
    showResult: !!job?.finishedAt && dismissed !== job.startedAt,
    dismiss: () => job && setDismissed(job.startedAt)
  }
}

export type SearchState = ReturnType<typeof useSearch>

export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export function elapsed(fromIso: string, toIso?: string | null): string {
  const secs = Math.max(0, Math.round(((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000))
  const m = Math.floor(secs / 60)
  return m ? `${m}min${String(secs % 60).padStart(2, '0')}s` : `${secs}s`
}
