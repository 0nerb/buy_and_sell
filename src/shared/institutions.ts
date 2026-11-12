/**
 * Nomes conhecidos de bancos e corretoras e as variações com que aparecem
 * ("XP Investimentos", "BTG Pactual Research"…). Usado para reconhecer a
 * instituição num PDF e para não contar a mesma instituição duas vezes.
 */
export const INSTITUTIONS: [RegExp, string][] = [
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

/** "XP Investimentos" → "XP"; nomes desconhecidos ficam como vieram. */
export function canonicalInstitution(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  for (const [re, canonical] of INSTITUTIONS) {
    if (re.test(trimmed)) return canonical
  }
  return trimmed
}
