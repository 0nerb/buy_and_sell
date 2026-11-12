import { createHash } from 'node:crypto'
import { canonicalInstitution } from '@shared/institutions'
import type { ProviderId, Report, SearchProgress, SearchResult, StockCall } from '@shared/types'
import { activeProvider, AIError } from './ai'
import {
  monthLabel,
  PORTFOLIOS_SCHEMA,
  PortfoliosSchema,
  PortfolioStreamParser,
  researchPrompt,
  STRUCTURE_PROMPT,
  type FoundPortfolio
} from './ai/shared'
import { getReports, getSettings, saveReport } from './store'

const TICKER = /^[A-Z]{4}(3|4|5|6|11)$/

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** URLs/domínios que a ferramenta de busca realmente trouxe — para conferir as fontes citadas. */
class SeenSources {
  private urls = new Set<string>()
  private hosts = new Set<string>()
  add(url: string, title: string) {
    this.urls.add(url)
    this.hosts.add(hostOf(url))
    // No Gemini as URLs vêm por redirecionamento; o título costuma ser o domínio.
    this.hosts.add(title.replace(/^www\./, ''))
  }
  has(url: string | null): boolean {
    return !!url && (this.urls.has(url) || this.hosts.has(hostOf(url)))
  }
}

/** Converte uma carteira encontrada num "relatório" do app (ou null se não tiver ativos válidos). */
function toReport(p: FoundPortfolio, month: string, provider: ProviderId, verified: boolean): Report | null {
  const calls: StockCall[] = []
  const seen = new Set<string>()
  for (const a of p.assets) {
    const ticker = a.ticker.toUpperCase().trim()
    if (!TICKER.test(ticker) || seen.has(ticker)) continue
    seen.add(ticker)
    calls.push({
      ticker,
      company: a.company,
      rating: 'compra',
      originalRating: `Carteira: ${p.portfolioName}${a.weight != null ? ` (${(a.weight * 100).toFixed(1)}%)` : ''}`,
      targetPrice: null,
      priceAtReport: null,
      currency: 'BRL',
      horizon: null,
      thesis: ''
    })
  }
  if (calls.length === 0) return null

  const institution = canonicalInstitution(p.institution)
  const refMonth = /^\d{4}-\d{2}$/.test(p.referenceMonth) ? p.referenceMonth : month
  const reportDate =
    p.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(p.publishedDate) && p.publishedDate.startsWith(refMonth)
      ? p.publishedDate
      : `${refMonth}-01`

  return {
    id: createHash('sha256').update(`web|${institution}|${p.portfolioName}|${refMonth}`.toLowerCase()).digest('hex'),
    fileName: `${p.portfolioName} — ${monthLabel(refMonth)}`,
    filePath: '',
    institution,
    reportDate,
    title: p.portfolioName,
    summary: `Carteira encontrada pela busca automática (${calls.length} ativos).`,
    importedAt: new Date().toISOString(),
    method: 'ia',
    provider,
    source: 'web',
    portfolioName: p.portfolioName,
    sourceUrl: p.sourceUrl,
    sourceVerified: verified,
    calls
  }
}

export interface SearchHooks {
  onProgress: (p: SearchProgress) => void
  /** Chamado a cada carteira gravada no banco, durante a busca. */
  onSaved: (report: Report, totalSaved: number) => void
}

/**
 * Busca na web as carteiras recomendadas do mês.
 *
 * Cada carteira é gravada no banco ASSIM QUE a IA termina de lê-la: a IA
 * escreve um bloco <carteira>{...}</carteira> logo depois de ler cada página,
 * e o PortfolioStreamParser entrega o bloco para ser validado e salvo — sem
 * esperar a pesquisa inteira acabar. Se a busca cair no meio, o que já foi
 * lido fica salvo.
 *
 * Se a IA não seguir o formato (nenhum bloco), as anotações finais passam por
 * uma etapa extra de conversão para JSON, como plano B.
 */
export async function searchPortfolios(month: string, { onProgress, onSaved }: SearchHooks): Promise<SearchResult> {
  const provider = await activeProvider()
  if (!provider) {
    throw new AIError('O provedor de IA não está pronto: configure a chave de API ou o login do Claude nas Configurações.')
  }
  const { trackedInstitutions } = getSettings()
  if (trackedInstitutions.length === 0) throw new AIError('Nenhuma instituição selecionada nas Configurações.')

  const seen = new SeenSources()
  const saved = new Map<string, Report>()
  const institutions = new Set<string>()

  const save = (p: FoundPortfolio) => {
    const report = toReport(p, month, provider.id, seen.has(p.sourceUrl))
    if (!report) return
    saveReport(report)
    saved.set(report.id, report)
    institutions.add(report.institution)
    onSaved(report, saved.size)
    onProgress({
      stage: 'pesquisando',
      message: `Salva: ${report.institution} — ${report.portfolioName} (${report.calls.length} ativos)`
    })
  }

  const parser = new PortfolioStreamParser(save)
  onProgress({ stage: 'pesquisando', message: `Procurando carteiras de ${monthLabel(month)}…` })

  const research = await provider.research(researchPrompt(month, trackedInstitutions), {
    onStatus: (message) => onProgress({ stage: 'pesquisando', message }),
    onText: (chunk) => parser.push(chunk),
    onSource: (url, title) => seen.add(url, title)
  })
  let notFound = parser.notFound

  if (saved.size === 0) {
    // Plano B: a IA não usou o formato combinado; converte as anotações de uma vez.
    onProgress({ stage: 'organizando', message: 'Organizando os resultados…' })
    const sourcesList = research.sources.map((s) => `- ${s.title} — ${s.url}`).join('\n')
    const raw = await provider.structure(
      STRUCTURE_PROMPT,
      `Instituições pedidas: ${trackedInstitutions.join(', ')}\n\n<anotacoes>\n${research.text}\n</anotacoes>\n\n<paginas_consultadas>\n${sourcesList}\n</paginas_consultadas>`,
      PORTFOLIOS_SCHEMA
    )
    const parsed = PortfoliosSchema.safeParse(raw)
    if (!parsed.success) throw new AIError('Resposta da IA em formato inesperado.')
    for (const p of parsed.data.portfolios) save(p)
    notFound = parsed.data.notFound
  } else {
    // Fontes que só apareceram depois do bloco (comum no Gemini): confere de novo.
    for (const s of research.sources) seen.add(s.url, s.title)
    const byId = new Map(getReports().map((r) => [r.id, r]))
    for (const r of saved.values()) {
      const current = byId.get(r.id)
      if (current && !current.sourceVerified && seen.has(current.sourceUrl ?? null)) {
        saveReport({ ...current, sourceVerified: true })
      }
    }
  }

  const result: SearchResult = { month, portfolios: saved.size, institutions: [...institutions], notFound }
  onProgress({
    stage: 'ok',
    message: `${saved.size} carteira(s) de ${institutions.size} instituição(ões) salvas.`
  })
  return result
}
