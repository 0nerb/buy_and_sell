import { createHash } from 'node:crypto'
import { canonicalInstitution } from '@shared/institutions'
import type { Report, SearchProgress, SearchResult, StockCall } from '@shared/types'
import { activeProvider, AIError } from './ai'
import { monthLabel, PORTFOLIOS_SCHEMA, PortfoliosSchema, researchPrompt, STRUCTURE_PROMPT } from './ai/shared'
import { getSettings, saveReport } from './store'

const TICKER = /^[A-Z]{4}(3|4|5|6|11)$/

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Busca na web as carteiras recomendadas do mês e salva cada uma como um
 * "relatório" (source = 'web'), que entra no consenso como os PDFs.
 *
 * Em duas etapas, para funcionar igual em qualquer provedor:
 *  1. pesquisa com busca na web → anotações em texto livre com as URLs;
 *  2. conversão das anotações em JSON validado (sem web).
 */
export async function searchPortfolios(
  month: string,
  onProgress: (p: SearchProgress) => void
): Promise<SearchResult> {
  const provider = await activeProvider()
  if (!provider) throw new AIError('O provedor de IA não está pronto: configure a chave de API ou o login do Claude nas Configurações.')
  const { trackedInstitutions } = getSettings()
  if (trackedInstitutions.length === 0) throw new AIError('Nenhuma instituição selecionada nas Configurações.')

  onProgress({ stage: 'pesquisando', message: `Procurando carteiras de ${monthLabel(month)}…` })
  const research = await provider.research(researchPrompt(month, trackedInstitutions), (message) =>
    onProgress({ stage: 'pesquisando', message })
  )

  onProgress({ stage: 'organizando', message: 'Organizando os resultados…' })
  const sourcesList = research.sources.map((s) => `- ${s.title} — ${s.url}`).join('\n')
  const raw = await provider.structure(
    STRUCTURE_PROMPT,
    `Instituições pedidas: ${trackedInstitutions.join(', ')}\n\n<anotacoes>\n${research.text}\n</anotacoes>\n\n<paginas_consultadas>\n${sourcesList}\n</paginas_consultadas>`,
    PORTFOLIOS_SCHEMA
  )
  const parsed = PortfoliosSchema.safeParse(raw)
  if (!parsed.success) throw new AIError('Resposta da IA em formato inesperado.')

  const seenUrls = new Set(research.sources.map((s) => s.url))
  // No Gemini as URLs vêm por redirecionamento; o título costuma ser o domínio.
  const seenHosts = new Set(research.sources.flatMap((s) => [hostOf(s.url), s.title.replace(/^www\./, '')]))

  const institutions = new Set<string>()
  let saved = 0
  for (const p of parsed.data.portfolios) {
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
    if (calls.length === 0) continue

    const refMonth = /^\d{4}-\d{2}$/.test(p.referenceMonth) ? p.referenceMonth : month
    const reportDate =
      p.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(p.publishedDate) && p.publishedDate.startsWith(refMonth)
        ? p.publishedDate
        : `${refMonth}-01`
    const verified = !!p.sourceUrl && (seenUrls.has(p.sourceUrl) || seenHosts.has(hostOf(p.sourceUrl)))

    const report: Report = {
      id: createHash('sha256').update(`web|${canonicalInstitution(p.institution)}|${p.portfolioName}|${refMonth}`.toLowerCase()).digest('hex'),
      fileName: `${p.portfolioName} — ${monthLabel(refMonth)}`,
      filePath: '',
      institution: canonicalInstitution(p.institution),
      reportDate,
      title: p.portfolioName,
      summary: `Carteira encontrada pela busca automática (${calls.length} ativos).`,
      importedAt: new Date().toISOString(),
      method: 'ia',
      provider: provider.id,
      source: 'web',
      portfolioName: p.portfolioName,
      sourceUrl: p.sourceUrl,
      sourceVerified: verified,
      calls
    }
    saveReport(report)
    institutions.add(canonicalInstitution(p.institution))
    saved++
  }

  const result: SearchResult = {
    month,
    portfolios: saved,
    institutions: [...institutions],
    notFound: parsed.data.notFound
  }
  onProgress({
    stage: 'ok',
    message: `${saved} carteira(s) de ${institutions.size} instituição(ões) encontradas.`
  })
  return result
}
