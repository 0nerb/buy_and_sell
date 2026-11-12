import type { SearchJob } from '@shared/types'
import { AIError } from './ai'
import { searchPortfolios } from './search'

/**
 * A busca roda como um "trabalho" do servidor, independente de quem pediu:
 * trocar de tela ou recarregar a página não interrompe nada, e qualquer
 * tela pode se reconectar para acompanhar o progresso.
 */

let job: SearchJob | null = null
const listeners = new Set<(job: SearchJob) => void>()

const notify = () => {
  if (job) for (const l of listeners) l(job)
}

export const currentJob = () => job
export const isRunning = () => !!job && !job.finishedAt

export function startSearch(month: string): SearchJob {
  if (isRunning()) throw new Error('Já existe uma busca em andamento.')
  job = {
    month,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: { stage: 'pesquisando', message: 'Iniciando…' },
    result: null
  }
  const current = job
  searchPortfolios(month, (p) => {
    current.progress = p
    notify()
  })
    .then((result) => {
      current.result = result
    })
    .catch((err) => {
      if (!(err instanceof AIError)) console.error(err)
      const message = err instanceof AIError ? err.message : `Falha na busca: ${err instanceof Error ? err.message : err}`
      current.progress = { stage: 'erro', message }
    })
    .finally(() => {
      current.finishedAt = new Date().toISOString()
      notify()
    })
  return job
}

/** Recebe cada atualização do trabalho; devolve a função para cancelar a inscrição. */
export function subscribe(listener: (job: SearchJob) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
