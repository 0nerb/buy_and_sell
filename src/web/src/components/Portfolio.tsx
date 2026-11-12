import { useState } from 'react'
import { PROVIDER_LABEL, type ConsolidatedPortfolio, type SettingsView } from '@shared/types'
import { fmtMoney, fmtPct } from '../format'
import { monthName, type SearchState } from '../useSearch'

interface Props {
  portfolio: ConsolidatedPortfolio | null
  settings: SettingsView
  search: SearchState
  onOpenSettings: () => void
}

const currentMonth = () => new Date().toISOString().slice(0, 7)

export function Portfolio({ portfolio, settings, search, onOpenSettings }: Props) {
  const [month, setMonth] = useState(currentMonth())
  const { job, running } = search
  const notFound = job?.finishedAt ? (job.result?.notFound ?? []) : []

  const entries = portfolio?.entries ?? []

  return (
    <>
      <div className="card search-box">
        <div>
          <h2>Busca automática de carteiras recomendadas</h2>
          <p className="muted small">
            Com {PROVIDER_LABEL[settings.provider]}, a IA pesquisa na web as carteiras do mês de{' '}
            {settings.trackedInstitutions.length} instituições e as adiciona aos seus relatórios. Leva alguns minutos;
            você pode usar as outras abas enquanto isso.{' '}
            <button className="link" onClick={onOpenSettings}>
              Alterar
            </button>
          </p>
        </div>
        <div className="row">
          <input
            type="month"
            value={month}
            max={currentMonth()}
            disabled={running}
            onChange={(e) => setMonth(e.target.value)}
          />
          <button className="primary" onClick={() => search.start(month)} disabled={running || !settings.aiReady}>
            {running ? (
              <>
                <span className="spinner light" aria-hidden /> Buscando {monthName(job!.month)}…
              </>
            ) : (
              'Buscar carteiras'
            )}
          </button>
        </div>
        {!settings.aiReady && (
          <p className="small status-erro">
            Conecte o provedor de IA ({PROVIDER_LABEL[settings.provider]}) nas Configurações para usar a busca.
          </p>
        )}
        {search.startError && <p className="small status-erro">{search.startError}</p>}
        {notFound.length > 0 && (
          <p className="small muted">
            Sem carteira encontrada em {monthName(job!.month)}: {notFound.join(', ')}
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <h2>Carteira consolidada vazia</h2>
          <p>Busque as carteiras do mês ou importe relatórios em PDF para montar a carteira.</p>
        </div>
      ) : (
        <>
          <p className="muted">
            {entries.length === 1 ? 'A ação mais recomendada' : `As ${entries.length} ações mais recomendadas`} para compra
            entre {portfolio!.institutionsTracked}{' '}
            {portfolio!.institutionsTracked === 1 ? 'instituição acompanhada' : 'instituições acompanhadas'}. Peso
            proporcional ao número de indicações.
          </p>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Ticker</th>
                  <th className="num">Indicações</th>
                  <th className="num">Peso</th>
                  <th>Instituições</th>
                  <th className="num">Preço-alvo médio</th>
                  <th className="num">Potencial</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.ticker}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <span className="ticker">{e.ticker}</span>
                      {e.company && <div className="small muted">{e.company}</div>}
                    </td>
                    <td className="num">
                      {e.institutions.length} de {portfolio!.institutionsTracked}
                    </td>
                    <td className="num">
                      <div className="weight">
                        <div className="weight-bar" style={{ width: `${e.weight * 100}%` }} />
                        <span>{(e.weight * 100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="wrap small">{e.institutions.join(', ')}</td>
                    <td className="num">{fmtMoney(e.avgTargetPrice)}</td>
                    <td className={`num ${e.upside == null ? '' : e.upside >= 0 ? 'pos' : 'neg'}`}>{fmtPct(e.upside)}</td>
                    <td>{e.status === 'novo' && <span className="badge comprar">Novo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {portfolio!.removed.length > 0 && (
            <p className="small muted">
              Saíram da carteira consolidada em relação a 30 dias atrás:{' '}
              {portfolio!.removed.map((r) => r.ticker).join(', ')}
            </p>
          )}
        </>
      )}

      <p className="disclaimer">
        Consolidação automática de recomendações de terceiros — não é recomendação de investimento. A busca por IA pode
        errar ou trazer carteiras desatualizadas: confira as fontes na aba Relatórios.
      </p>
    </>
  )
}
