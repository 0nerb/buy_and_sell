import type { StockCall } from '@shared/types'

/** O que um extrator devolve; o restante do Report é preenchido por quem chama. */
export interface ExtractedReport {
  institution: string
  reportDate: string
  title: string
  summary: string
  calls: StockCall[]
}

/** Ticker da B3: 4 letras + 3/4/5/6/11 (ON, PN, PNA, PNB, units/FIIs/BDRs). */
export const B3_TICKER = /\b([A-Z]{4}(?:3|4|5|6|11))\b/g

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Remove duplicatas mantendo a primeira ocorrência de cada ticker. */
export function dedupeCalls(calls: StockCall[]): StockCall[] {
  const seen = new Set<string>()
  return calls.filter((c) => {
    const key = c.ticker.toUpperCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
