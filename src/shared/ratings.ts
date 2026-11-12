import type { Rating } from './types'

/**
 * Vocabulário de ratings usado por bancos e corretoras (PT e EN).
 * A ordem importa: expressões mais longas primeiro, para "market perform"
 * não ser lido como "perform" etc.
 */
const RATING_TERMS: [RegExp, Rating][] = [
  [/\b(strong\s+buy|compra\s+forte)\b/i, 'compra'],
  [/\b(market\s*perform|sector\s*perform|equal[-\s]?weight|in[-\s]?line|peer\s*perform)\b/i, 'neutro'],
  [/\b(em\s+linha(\s+com\s+o\s+mercado)?|neutr[oa]|neutral|manter|manuten[çc][ãa]o|hold)\b/i, 'neutro'],
  [/\b(outperform|overweight|sobreponderar|sobreponderado|acima\s+d[oa]\s+(m[ée]dia|mercado))\b/i, 'compra'],
  [/\b(underperform|underweight|subponderar|subponderado|abaixo\s+d[oa]\s+(m[ée]dia|mercado))\b/i, 'venda'],
  [/\b(compra|comprar|buy|accumulate|acumular)\b/i, 'compra'],
  // "vendas" (receita) é extremamente comum em relatórios — exigimos a forma singular.
  [/\b(venda|vender|sell|reduzir|reduce)\b(?!s)/i, 'venda']
]

/** Converte o texto de rating de um relatório para a escala compra/neutro/venda. */
export function normalizeRating(text: string): Rating | null {
  for (const [re, rating] of RATING_TERMS) {
    if (re.test(text)) return rating
  }
  return null
}

/**
 * Encontra o termo de rating mais próximo de `pos` dentro de `text`.
 * Usado pela heurística: num parágrafo com vários tickers, o rating
 * relevante é o que está mais perto do código.
 */
export function nearestRating(text: string, pos: number): { rating: Rating; term: string; distance: number } | null {
  let best: { rating: Rating; term: string; distance: number } | null = null
  for (const [re, rating] of RATING_TERMS) {
    for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
      const start = m.index
      const end = start + m[0].length
      const distance = pos < start ? start - pos : pos > end ? pos - end : 0
      if (!best || distance < best.distance) best = { rating, term: m[0], distance }
    }
  }
  return best
}

export function ratingValue(r: Rating): number {
  return r === 'compra' ? 1 : r === 'venda' ? -1 : 0
}

export const RATING_PATTERNS = RATING_TERMS
