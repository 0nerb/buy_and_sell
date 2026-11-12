import { describe, expect, it } from 'vitest'
import { detectDate, extractHeuristic, parseBrazilianNumber } from '../src/server/extract/heuristic'

const SAMPLE = `BTG Pactual Research — Bancos
São Paulo, 10 de novembro de 2026

Itaú Unibanco (ITUB4): reiteramos recomendação de Compra, com preço-alvo de R$ 45,00.
As vendas de seguros cresceram no trimestre.

Banco do Brasil (BBAS3): rebaixamos para Neutro, preço-alvo R$ 30,50.

Bradesco (BBDC4) — Venda. Preço-alvo de R$ 12,00.

Também citamos SANB11 no contexto do setor.`

describe('heurística', () => {
  it('extrai tickers, ratings e preços-alvo', () => {
    const r = extractHeuristic(SAMPLE)
    expect(r.institution).toBe('BTG Pactual')
    expect(r.reportDate).toBe('2026-11-10')
    const byTicker = Object.fromEntries(r.calls.map((c) => [c.ticker, c]))
    expect(byTicker.ITUB4.rating).toBe('compra')
    expect(byTicker.ITUB4.targetPrice).toBe(45)
    expect(byTicker.BBAS3.rating).toBe('neutro')
    expect(byTicker.BBAS3.targetPrice).toBe(30.5)
    expect(byTicker.BBDC4.rating).toBe('venda')
  })

  it('converte números no formato brasileiro', () => {
    expect(parseBrazilianNumber('1.234,56')).toBe(1234.56)
    expect(parseBrazilianNumber('34,5')).toBe(34.5)
    expect(parseBrazilianNumber('34.50')).toBe(34.5)
  })

  it('ignora datas futuras (projeções)', () => {
    expect(detectDate('Publicado em 05/11/2026. Dividendos em 30/03/2099.')).toBe('2026-11-05')
  })
})
