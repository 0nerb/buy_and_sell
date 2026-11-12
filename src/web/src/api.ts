import type {
  ConsolidatedPortfolio,
  Consensus,
  ImportResult,
  ProviderId,
  Report,
  PricesInfo,
  SearchJob,
  Settings,
  SettingsView
} from '@shared/types'

/** Cabeçalho exigido pelo servidor (bloqueia chamadas vindas de outros sites). */
const HEADERS = { 'x-recomendacao': '1' }

async function request<T>(method: string, path: string, body?: unknown, contentType = 'application/json'): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? HEADERS : { ...HEADERS, 'Content-Type': contentType },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : (body as BodyInit)
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Erro ${res.status} ao falar com o servidor.`)
  }
  return res.json()
}

/** Lê uma resposta text/event-stream (SSE) e entrega cada evento. */
async function readSSE(res: Response, onEvent: (event: string, data: string) => void): Promise<void> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let sep: number
    while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(buffer.slice(sep).match(/^\r?\n\r?\n/)![0].length + sep)
      let event = 'message'
      const data: string[] = []
      for (const line of chunk.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) onEvent(event, data.join('\n'))
    }
  }
}

export const api = {
  listReports: () => request<Report[]>('GET', '/reports'),
  importFile: (file: File) =>
    request<ImportResult>('POST', `/reports?name=${encodeURIComponent(file.name)}`, file, 'application/pdf'),
  /** Relê um relatório: como o PDF não fica guardado, a pessoa escolhe o arquivo de novo. */
  rereadReport: (id: string, file: File) => request<ImportResult>('POST', `/reports/${id}/reread`, file, 'application/pdf'),
  updateReport: (id: string, patch: { institution: string; reportDate: string; sourceUrl: string | null }) =>
    request<void>('PATCH', `/reports/${id}`, patch),
  deleteReport: (id: string) => request<void>('DELETE', `/reports/${id}`),
  /** Abre o link do relatório numa aba nova (o PDF em si não é guardado). */
  openReport: (report: Report) => {
    if (report.sourceUrl && /^https?:\/\//.test(report.sourceUrl)) window.open(report.sourceUrl, '_blank', 'noopener')
  },
  getConsensus: () => request<Consensus[]>('GET', '/consensus'),
  getPortfolio: () => request<ConsolidatedPortfolio>('GET', '/portfolio'),
  /** Situação da busca de carteiras (null se nenhuma foi feita desde que o servidor subiu). */
  getSearch: () => request<SearchJob | null>('GET', '/search'),
  startSearch: (month: string) => request<SearchJob>('POST', '/search', { month }),
  /** Acompanha a busca em andamento até ela terminar (ou até `signal` abortar). */
  watchSearch: async (onJob: (job: SearchJob) => void, signal: AbortSignal): Promise<void> => {
    const res = await fetch('/api/search/events', { headers: HEADERS, signal })
    if (!res.ok) throw new Error(`Erro ${res.status} ao acompanhar a busca.`)
    await readSSE(res, (event, data) => {
      if (event === 'job') onJob(JSON.parse(data))
    })
  },
  getPrices: () => request<PricesInfo>('GET', '/prices'),
  refreshPrices: () => request<PricesInfo>('POST', '/prices/refresh'),
  listModels: (provider: ProviderId) => request<string[]>('GET', `/models/${provider}`),
  getSettings: (refresh = false) => request<SettingsView>('GET', `/settings${refresh ? '?refresh=1' : ''}`),
  saveSettings: (patch: Partial<Settings>) => request<SettingsView>('PATCH', '/settings', patch),
  setApiKey: (provider: ProviderId, key: string | null) =>
    request<SettingsView>('PUT', `/settings/keys/${provider}`, { key })
}
