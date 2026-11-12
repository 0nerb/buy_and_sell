import { ratingValue } from './ratings'
import type { Action, Consensus, ConsensusSource, Report, Settings } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

function ageInDays(isoDate: string, now: Date): number {
  const t = Date.parse(isoDate)
  if (Number.isNaN(t)) return 0
  return Math.max(0, (now.getTime() - t) / DAY_MS)
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Relatórios que valem na data `now`:
 *  - descarta os publicados depois de `now` (permite calcular "como estava há 30 dias");
 *  - para carteiras recomendadas, mantém só a versão mais recente de cada
 *    (instituição, carteira) — quem saiu da carteira deixa de ser recomendado.
 */
export function activeReports(reports: Report[], now: Date): Report[] {
  const cutoff = now.toISOString().slice(0, 10)
  const latestPortfolio = new Map<string, Report>()
  const result: Report[] = []
  for (const r of reports) {
    if (r.reportDate > cutoff) continue
    if (!r.portfolioName) {
      result.push(r)
      continue
    }
    const key = `${r.institution.trim().toLowerCase()}|${r.portfolioName.trim().toLowerCase()}`
    const cur = latestPortfolio.get(key)
    if (!cur || r.reportDate > cur.reportDate) latestPortfolio.set(key, r)
  }
  return [...result, ...latestPortfolio.values()]
}

/**
 * Consolida as recomendações de todos os relatórios em uma lista por ticker.
 *
 * Regras:
 *  - Para cada par (instituição, ticker) vale só a recomendação mais recente —
 *    um banco que mudou de "compra" para "neutro" não conta duas vezes.
 *  - Recomendações mais antigas que `maxAgeDays` são descartadas.
 *  - Cada recomendação pesa 0.5^(idade / halfLifeDays).
 *  - score = média ponderada (compra = +1, neutro = 0, venda = -1).
 */
export function buildConsensus(reports: Report[], settings: Settings, now = new Date()): Consensus[] {
  // chave: ticker -> instituição -> fonte mais recente
  const latest = new Map<string, Map<string, ConsensusSource & { company: string | null }>>()

  for (const report of activeReports(reports, now)) {
    const age = ageInDays(report.reportDate, now)
    if (age > settings.maxAgeDays) continue
    const weight = Math.pow(0.5, age / settings.halfLifeDays)
    const institution = report.institution.trim() || 'Desconhecida'
    const instKey = institution.toLowerCase()

    for (const call of report.calls) {
      const ticker = call.ticker.toUpperCase().trim()
      if (!ticker) continue
      let byInst = latest.get(ticker)
      if (!byInst) latest.set(ticker, (byInst = new Map()))
      const current = byInst.get(instKey)
      // Mesma data: uma recomendação de compra em qualquer carteira da instituição prevalece.
      if (current && (current.reportDate > report.reportDate ||
          (current.reportDate === report.reportDate && ratingValue(current.rating) >= ratingValue(call.rating)))) continue
      byInst.set(instKey, {
        reportId: report.id,
        institution,
        reportDate: report.reportDate,
        rating: call.rating,
        originalRating: call.originalRating,
        targetPrice: call.currency === 'BRL' ? call.targetPrice : null,
        priceAtReport: call.currency === 'BRL' ? call.priceAtReport : null,
        thesis: call.thesis,
        weight,
        company: call.company
      })
    }
  }

  const result: Consensus[] = []
  for (const [ticker, byInst] of latest) {
    const sources = [...byInst.values()].sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    const totalWeight = sources.reduce((s, x) => s + x.weight, 0)
    const score =
      totalWeight > 0 ? sources.reduce((s, x) => s + x.weight * ratingValue(x.rating), 0) / totalWeight : 0

    const action: Action =
      score >= settings.actionThreshold ? 'comprar' : score <= -settings.actionThreshold ? 'vender' : 'manter'

    const avgTargetPrice = mean(sources.flatMap((s) => (s.targetPrice ? [s.targetPrice] : [])))
    const referencePrice = sources.find((s) => s.priceAtReport)?.priceAtReport ?? null
    const upside = avgTargetPrice && referencePrice ? avgTargetPrice / referencePrice - 1 : null

    result.push({
      ticker,
      company: sources.find((s) => s.company)?.company ?? null,
      action,
      score,
      buyCount: sources.filter((s) => s.rating === 'compra').length,
      neutralCount: sources.filter((s) => s.rating === 'neutro').length,
      sellCount: sources.filter((s) => s.rating === 'venda').length,
      avgTargetPrice,
      referencePrice,
      upside,
      lastUpdate: sources[0].reportDate,
      sources: sources.map(({ company: _c, ...s }) => s)
    })
  }

  // Mais convicção primeiro: |score| × nº de fontes, depois upside.
  return result.sort(
    (a, b) =>
      Math.abs(b.score) * b.sources.length - Math.abs(a.score) * a.sources.length ||
      (b.upside ?? -Infinity) - (a.upside ?? -Infinity)
  )
}
