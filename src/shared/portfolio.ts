import { activeReports, buildConsensus } from './consensus'
import type { Consensus, ConsolidatedPortfolio, Report, Settings } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Ações com mais instituições recomendando compra; desempate por score e potencial. */
function rank(consensus: Consensus[], size: number): Consensus[] {
  return consensus
    .filter((c) => c.buyCount > 0)
    .sort(
      (a, b) =>
        b.buyCount - a.buyCount ||
        b.score - a.score ||
        (b.upside ?? -Infinity) - (a.upside ?? -Infinity) ||
        a.ticker.localeCompare(b.ticker)
    )
    .slice(0, size)
}

/**
 * Carteira consolidada: as `portfolioSize` ações que mais aparecem como
 * compra entre as instituições, com peso proporcional ao nº de indicações.
 * Compara com a carteira que o app teria montado 30 dias atrás.
 */
export function buildConsolidated(reports: Report[], settings: Settings, now = new Date()): ConsolidatedPortfolio {
  const current = rank(buildConsensus(reports, settings, now), settings.portfolioSize)
  const before = new Date(now.getTime() - 30 * DAY_MS)
  const previous = rank(buildConsensus(reports, settings, before), settings.portfolioSize)
  const previousSet = new Set(previous.map((c) => c.ticker))
  const currentSet = new Set(current.map((c) => c.ticker))

  const minDate = new Date(now.getTime() - settings.maxAgeDays * DAY_MS).toISOString().slice(0, 10)
  const institutions = new Set(
    activeReports(reports, now)
      .filter((r) => r.reportDate >= minDate)
      .map((r) => r.institution.trim().toLowerCase())
  )

  const totalVotes = current.reduce((s, c) => s + c.buyCount, 0)
  return {
    institutionsTracked: institutions.size,
    entries: current.map((c) => ({
      ticker: c.ticker,
      company: c.company,
      institutions: c.sources.filter((s) => s.rating === 'compra').map((s) => s.institution),
      weight: totalVotes ? c.buyCount / totalVotes : 0,
      score: c.score,
      avgTargetPrice: c.avgTargetPrice,
      upside: c.upside,
      status: previous.length === 0 || previousSet.has(c.ticker) ? 'mantido' : 'novo'
    })),
    removed: previous.filter((c) => !currentSet.has(c.ticker)).map((c) => ({ ticker: c.ticker, company: c.company }))
  }
}
