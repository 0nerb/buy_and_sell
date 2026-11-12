const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1, signDisplay: 'always' })

export const fmtMoney = (v: number | null) => (v == null ? '—' : brl.format(v))
export const fmtPct = (v: number | null) => (v == null ? '—' : pct.format(v))
export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
export const ratingLabel = { compra: 'Compra', neutro: 'Neutro', venda: 'Venda' } as const
export const actionLabel = { comprar: 'Comprar', manter: 'Manter', vender: 'Vender' } as const
