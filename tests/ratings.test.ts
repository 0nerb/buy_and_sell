import { describe, expect, it } from 'vitest'
import { normalizeRating } from '@shared/ratings'

describe('normalizeRating', () => {
  it.each([
    ['Compra', 'compra'],
    ['Outperform', 'compra'],
    ['Overweight', 'compra'],
    ['Market Perform', 'neutro'],
    ['Neutro', 'neutro'],
    ['Manter', 'neutro'],
    ['Hold', 'neutro'],
    ['Equal Weight', 'neutro'],
    ['Venda', 'venda'],
    ['Underperform', 'venda'],
    ['Sell', 'venda']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeRating(input)).toBe(expected)
  })

  it('não confunde "vendas" (receita) com recomendação de venda', () => {
    expect(normalizeRating('as vendas cresceram 12% no trimestre')).toBeNull()
  })

  it('"market perform" não vira compra por causa de "perform"', () => {
    expect(normalizeRating('Recomendação: Market Perform')).toBe('neutro')
  })
})
