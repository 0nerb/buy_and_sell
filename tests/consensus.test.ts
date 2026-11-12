import { describe, expect, it } from 'vitest'
import { buildConsensus } from '@shared/consensus'
import { DEFAULT_SETTINGS, type Rating, type Report } from '@shared/types'

const now = new Date('2026-11-12T12:00:00Z')

function report(id: string, institution: string, reportDate: string, calls: [string, Rating, number?, number?][]): Report {
  return {
    id, institution, reportDate, fileName: `${id}.pdf`, title: '', summary: '',
    importedAt: now.toISOString(), method: 'ia',
    calls: calls.map(([ticker, rating, targetPrice, priceAtReport]) => ({
      ticker, rating, company: null, originalRating: rating, targetPrice: targetPrice ?? null,
      priceAtReport: priceAtReport ?? null, currency: 'BRL', horizon: null, thesis: ''
    }))
  }
}

describe('buildConsensus', () => {
  it('sugere comprar quando os bancos concordam em compra', () => {
    const c = buildConsensus(
      [
        report('a', 'BTG Pactual', '2026-11-10', [['PETR4', 'compra', 50, 40]]),
        report('b', 'XP', '2026-11-01', [['PETR4', 'compra', 46]])
      ],
      DEFAULT_SETTINGS,
      now
    )
    expect(c).toHaveLength(1)
    expect(c[0].action).toBe('comprar')
    expect(c[0].buyCount).toBe(2)
    expect(c[0].avgTargetPrice).toBe(48)
    expect(c[0].upside).toBeCloseTo(0.2)
  })

  it('usa só a recomendação mais recente de cada banco', () => {
    const c = buildConsensus(
      [
        report('old', 'BTG Pactual', '2026-09-01', [['VALE3', 'compra']]),
        report('new', 'BTG Pactual', '2026-11-01', [['VALE3', 'venda']])
      ],
      DEFAULT_SETTINGS,
      now
    )
    expect(c[0].sources).toHaveLength(1)
    expect(c[0].action).toBe('vender')
  })

  it('ignora relatórios mais velhos que maxAgeDays', () => {
    const c = buildConsensus([report('x', 'Safra', '2025-01-01', [['ITUB4', 'compra']])], DEFAULT_SETTINGS, now)
    expect(c).toHaveLength(0)
  })

  it('recomendações divididas resultam em manter', () => {
    const c = buildConsensus(
      [
        report('a', 'BTG Pactual', '2026-11-10', [['WEGE3', 'compra']]),
        report('b', 'XP', '2026-11-10', [['WEGE3', 'venda']])
      ],
      DEFAULT_SETTINGS,
      now
    )
    expect(c[0].action).toBe('manter')
    expect(c[0].score).toBeCloseTo(0)
  })

  it('usa a cotação atual no potencial quando ela existe', () => {
    const reports = [report('a', 'BTG Pactual', '2026-11-10', [['PETR4', 'compra', 50, 40]])]
    const semCotacao = buildConsensus(reports, DEFAULT_SETTINGS, now)[0]
    expect(semCotacao.upsideBasis).toBe('relatorio')
    expect(semCotacao.upside).toBeCloseTo(0.25)

    const quotes = { PETR4: { price: 44.56, currency: 'BRL', changePercent: 0.0232, time: null, name: null, analystTarget: { mean: 60, low: 55, high: 72, analysts: 12 }, fetchedAt: '' } }
    const comCotacao = buildConsensus(reports, DEFAULT_SETTINGS, now, quotes)[0]
    expect(comCotacao.currentPrice).toBe(44.56)
    expect(comCotacao.upsideBasis).toBe('atual')
    expect(comCotacao.upside).toBeCloseTo(50 / 44.56 - 1)
  })

  it('sem preço-alvo nos relatórios, usa o consenso de analistas do Yahoo', () => {
    const reports = [report('a', 'XP', '2026-11-10', [['VALE3', 'compra']])]
    const quotes = { VALE3: { price: 64, currency: 'BRL', changePercent: null, time: null, name: null, analystTarget: { mean: 80, low: 70, high: 90, analysts: 11 }, fetchedAt: '' } }
    const c = buildConsensus(reports, DEFAULT_SETTINGS, now, quotes)[0]
    expect(c.targetSource).toBe('yahoo')
    expect(c.avgTargetPrice).toBe(80)
    expect(c.analystCount).toBe(11)
    expect(c.upside).toBeCloseTo(0.25)
  })

  it('preço-alvo dos relatórios tem prioridade sobre o do Yahoo', () => {
    const reports = [report('a', 'XP', '2026-11-10', [['VALE3', 'compra', 70]])]
    const quotes = { VALE3: { price: 64, currency: 'BRL', changePercent: null, time: null, name: null, analystTarget: { mean: 80, low: 70, high: 90, analysts: 11 }, fetchedAt: '' } }
    const c = buildConsensus(reports, DEFAULT_SETTINGS, now, quotes)[0]
    expect(c.targetSource).toBe('relatorios')
    expect(c.avgTargetPrice).toBe(70)
  })
})
