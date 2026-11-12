import { describe, expect, it } from 'vitest'
import { buildConsensus } from '@shared/consensus'
import { buildConsolidated } from '@shared/portfolio'
import { DEFAULT_SETTINGS, type Report } from '@shared/types'

const now = new Date('2026-11-12T12:00:00Z')

function carteira(institution: string, reportDate: string, tickers: string[], portfolioName = 'Carteira Recomendada'): Report {
  return {
    id: `${institution}-${portfolioName}-${reportDate}`,
    institution, reportDate, portfolioName, source: 'web', fileName: '', title: portfolioName,
    summary: '', importedAt: now.toISOString(), method: 'ia',
    calls: tickers.map((ticker) => ({
      ticker, rating: 'compra' as const, company: null, originalRating: 'Carteira', targetPrice: null,
      priceAtReport: null, currency: 'BRL', horizon: null, thesis: ''
    }))
  }
}

describe('carteiras recomendadas', () => {
  it('ativo que saiu da carteira deixa de contar como compra', () => {
    const c = buildConsensus(
      [carteira('XP', '2026-10-01', ['PETR4', 'VALE3']), carteira('XP', '2026-11-01', ['VALE3'])],
      DEFAULT_SETTINGS,
      now
    )
    expect(c.map((x) => x.ticker)).toEqual(['VALE3'])
  })

  it('ranqueia pelas ações que mais aparecem e calcula pesos', () => {
    const p = buildConsolidated(
      [
        carteira('XP', '2026-11-01', ['PETR4', 'ITUB4', 'WEGE3']),
        carteira('BTG Pactual', '2026-11-01', ['PETR4', 'ITUB4']),
        carteira('Safra', '2026-11-01', ['PETR4'])
      ],
      { ...DEFAULT_SETTINGS, portfolioSize: 2 },
      now
    )
    expect(p.institutionsTracked).toBe(3)
    expect(p.entries.map((e) => e.ticker)).toEqual(['PETR4', 'ITUB4'])
    expect(p.entries[0].weight).toBeCloseTo(3 / 5)
    expect(p.entries[1].institutions.sort()).toEqual(['BTG Pactual', 'XP'])
  })

  it('marca o que entrou e o que saiu em relação a 30 dias atrás', () => {
    const p = buildConsolidated(
      [
        carteira('XP', '2026-10-01', ['PETR4', 'BBAS3']),
        carteira('XP', '2026-11-01', ['PETR4', 'WEGE3'])
      ],
      DEFAULT_SETTINGS,
      now
    )
    const status = Object.fromEntries(p.entries.map((e) => [e.ticker, e.status]))
    expect(status).toEqual({ PETR4: 'mantido', WEGE3: 'novo' })
    expect(p.removed.map((r) => r.ticker)).toEqual(['BBAS3'])
  })

  it('duas carteiras da mesma instituição contam como uma indicação', () => {
    const p = buildConsolidated(
      [
        carteira('XP', '2026-11-01', ['TAEE11'], 'Carteira Dividendos'),
        carteira('XP', '2026-11-01', ['TAEE11'], 'Top 10')
      ],
      DEFAULT_SETTINGS,
      now
    )
    expect(p.entries[0].institutions).toEqual(['XP'])
  })
})

describe('nomes de instituições', () => {
  it('"XP" e "XP Investimentos" são a mesma instituição', () => {
    const p = buildConsolidated(
      [
        carteira('XP Investimentos', '2026-11-01', ['PETR4'], 'Top Ações'),
        carteira('XP', '2026-11-01', ['PETR4'], 'Dividendos'),
        carteira('BTG Pactual Research', '2026-11-01', ['PETR4'])
      ],
      DEFAULT_SETTINGS,
      now
    )
    expect(p.institutionsTracked).toBe(2)
    expect(p.entries[0].institutions.sort()).toEqual(['BTG Pactual', 'XP'])
  })
})
