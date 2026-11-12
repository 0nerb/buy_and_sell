import type { TargetSource } from '@shared/types'
import { fmtMoney, fmtPct } from '../format'

/** Preço-alvo médio, indicando quando vem do consenso de analistas do Yahoo Finance. */
export function TargetCell({ value, source, analysts }: { value: number | null; source: TargetSource; analysts: number | null }) {
  return (
    <td
      className="num"
      title={
        source === 'relatorios'
          ? 'Média dos preços-alvo dos relatórios e carteiras coletados'
          : source === 'yahoo'
            ? 'Nenhum relatório coletado informou preço-alvo: consenso de analistas do Yahoo Finance'
            : 'Sem preço-alvo'
      }
    >
      {fmtMoney(value)}
      {source === 'yahoo' && (
        <div className="small muted">
          analistas{analysts ? ` (${analysts})` : ''} · Yahoo
        </div>
      )}
    </td>
  )
}

/** Cotação atual com a variação do dia embaixo. */
export function CurrentPriceCell({ price, change }: { price: number | null; change: number | null }) {
  return (
    <td className="num">
      {fmtMoney(price)}
      {change != null && <div className={`small ${change >= 0 ? 'pos' : 'neg'}`}>{fmtPct(change)} hoje</div>}
    </td>
  )
}

/** Potencial até o preço-alvo médio; marca quando foi calculado com o preço do relatório. */
export function UpsideCell({ upside, basis }: { upside: number | null; basis: 'atual' | 'relatorio' | null }) {
  return (
    <td
      className={`num ${upside == null ? '' : upside >= 0 ? 'pos' : 'neg'}`}
      title={
        basis === 'relatorio'
          ? 'Calculado com o preço citado no relatório (sem cotação atual). Clique em "Atualizar preços".'
          : basis === 'atual'
            ? 'Preço-alvo médio ÷ cotação atual − 1'
            : 'Sem preço-alvo informado'
      }
    >
      {fmtPct(upside)}
      {basis === 'relatorio' && <sup>*</sup>}
    </td>
  )
}
