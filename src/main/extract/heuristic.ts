import { nearestRating } from '@shared/ratings'
import type { Rating, StockCall } from '@shared/types'
import { B3_TICKER, dedupeCalls, today, type ExtractedReport } from './common'

/**
 * Extrator offline, sem IA. Funciona razoavelmente em relatórios de
 * "início de cobertura" e "carteira recomendada", mas erra com layouts em
 * tabela complexos. Serve de fallback quando não há chave de API.
 */

const INSTITUTIONS: [RegExp, string][] = [
  [/btg\s*pactual|\bbtg\b/i, 'BTG Pactual'],
  [/\bxp\s*(investimentos|research)?\b/i, 'XP'],
  [/ita[uú]\s*bba/i, 'Itaú BBA'],
  [/bradesco\s*bbi/i, 'Bradesco BBI'],
  [/\bsafra\b/i, 'Safra'],
  [/santander/i, 'Santander'],
  [/\bgenial\b/i, 'Genial'],
  [/[áa]gora\s*investimentos/i, 'Ágora'],
  [/bb\s*investimentos|banco\s+do\s+brasil/i, 'BB Investimentos'],
  [/\binter\s*(invest|research)/i, 'Inter'],
  [/goldman\s*sachs/i, 'Goldman Sachs'],
  [/j\.?\s*p\.?\s*morgan/i, 'JPMorgan'],
  [/morgan\s*stanley/i, 'Morgan Stanley'],
  [/\bubs\b/i, 'UBS'],
  [/bank\s+of\s+america|bofa/i, 'BofA'],
  [/citi(group|\s*research)?\b/i, 'Citi'],
  [/\bwarren\b/i, 'Warren'],
  [/\bnord\s*(research|investimentos)\b/i, 'Nord'],
  [/empiricus/i, 'Empiricus'],
  [/\bmodal\b/i, 'Modal']
]

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, março: 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
}

const pad = (n: number) => String(n).padStart(2, '0')

export function detectInstitution(text: string): string {
  const head = text.slice(0, 4000)
  let best: [string, number] = ['Desconhecida', 0]
  for (const [re, name] of INSTITUTIONS) {
    const count = (head.match(new RegExp(re.source, 'gi')) ?? []).length
    if (count > best[1]) best = [name, count]
  }
  return best[0]
}

export function detectDate(text: string): string {
  const head = text.slice(0, 4000)
  const candidates: string[] = []

  for (const m of head.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) candidates.push(`${y}-${pad(mo)}-${pad(d)}`)
  }
  for (const m of head.matchAll(/\b(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})\b/gi)) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo) candidates.push(`${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`)
  }
  // Datas no futuro costumam ser projeções ("dividendos em 30/03/2027"), não a publicação.
  const valid = candidates.filter((c) => c <= today())
  return valid.sort().at(-1) ?? today()
}

/** "1.234,56" / "34,50" / "34.50" -> número. */
export function parseBrazilianNumber(raw: string): number | null {
  let s = raw.trim()
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

const TARGET_RE =
  /(?:pre[çc]o[-\s]?(?:alvo|justo)|target(?:\s+price)?|\bPA\b|valor\s+justo)\s*(?:12M|de|:|-|\(.*?\))?\s*(?:de\s+)?(?:R\$\s*)?(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i
const PRICE_RE = /(?:pre[çc]o\s+atual|cota[çc][ãa]o|[úu]ltimo\s+pre[çc]o|price)\s*(?:de|:|-)?\s*(?:R\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)/i

export function extractHeuristic(text: string): ExtractedReport {
  const clean = text.replace(/\s+/g, ' ')
  const windows = new Map<string, { text: string; pos: number }[]>()

  for (const m of clean.matchAll(B3_TICKER)) {
    const start = Math.max(0, m.index - 160)
    // A janela termina no próximo ticker, para não "roubar" o rating do ativo seguinte.
    const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 220)
    const nextTicker = after.search(new RegExp(B3_TICKER.source))
    const end = m.index + m[0].length + (nextTicker >= 0 ? nextTicker : after.length)
    const list = windows.get(m[1]) ?? []
    list.push({ text: clean.slice(start, end), pos: m.index - start })
    windows.set(m[1], list)
  }

  const calls: StockCall[] = []
  for (const [ticker, wins] of windows) {
    const votes: Record<Rating, number> = { compra: 0, neutro: 0, venda: 0 }
    let original = ''
    let target: number | null = null
    let price: number | null = null

    for (const w of wins) {
      const r = nearestRating(w.text, w.pos)
      if (r) {
        votes[r.rating]++
        original ||= r.term
      }
      const forward = w.text.slice(w.pos)
      if (target === null) {
        const t = forward.match(TARGET_RE)
        if (t) target = parseBrazilianNumber(t[1])
      }
      if (price === null) {
        const p = forward.match(PRICE_RE)
        if (p) price = parseBrazilianNumber(p[1])
      }
    }

    const total = votes.compra + votes.neutro + votes.venda
    if (total === 0) continue // ticker só citado, sem recomendação perto
    const rating = (Object.entries(votes) as [Rating, number][]).sort((a, b) => b[1] - a[1])[0][0]

    calls.push({
      ticker,
      company: null,
      rating,
      originalRating: original,
      targetPrice: target,
      priceAtReport: price,
      currency: 'BRL',
      horizon: null,
      thesis: `Leitura automática (sem IA): ${votes.compra} menção(ões) de compra, ${votes.neutro} neutra(s), ${votes.venda} de venda próximas ao ticker.`
    })
  }

  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 10) ?? ''
  return {
    institution: detectInstitution(text),
    reportDate: detectDate(text),
    title: firstLine.slice(0, 140),
    summary: '',
    calls: dedupeCalls(calls)
  }
}
