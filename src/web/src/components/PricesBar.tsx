import type { PricesInfo } from '@shared/types'

export interface PricesState {
  info: PricesInfo | null
  loading: boolean
  error: string | null
  refresh: () => void
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Hora da última cotação + botão "Atualizar preços" (Yahoo Finance). */
export function PricesBar({ prices }: { prices: PricesState }) {
  const { info, loading, error } = prices
  return (
    <div className="prices-bar">
      <button onClick={prices.refresh} disabled={loading}>
        {loading ? (
          <>
            <span className="spinner" aria-hidden /> Atualizando preços…
          </>
        ) : (
          '↻ Atualizar preços'
        )}
      </button>
      <span className="small muted">
        {info?.updatedAt
          ? `Cotações de ${fmt(info.updatedAt)} · Yahoo Finance (atraso de ~15 min)`
          : 'Cotações ainda não buscadas · Yahoo Finance'}
        {info && info.missing.length > 0 && ` · sem cotação: ${info.missing.join(', ')}`}
      </span>
      {error && <span className="small status-erro">{error}</span>}
    </div>
  )
}
