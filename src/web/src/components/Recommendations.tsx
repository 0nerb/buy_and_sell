import { Fragment, useMemo, useState } from 'react'
import type { Action, Consensus } from '@shared/types'
import { actionLabel, fmtDate, fmtMoney, fmtPct, ratingLabel } from '../format'

type Filter = 'todas' | Action

function ScoreBar({ score }: { score: number }) {
  const width = Math.abs(score) * 50
  const color = score > 0 ? 'var(--buy)' : score < 0 ? 'var(--sell)' : 'var(--hold)'
  return (
    <div className="score" title={`Score ${score.toFixed(2)} (−1 venda … +1 compra)`}>
      <div className="score-bar">
        <div
          className="score-fill"
          style={{ background: color, width: `${width}%`, left: score >= 0 ? '50%' : `${50 - width}%` }}
        />
      </div>
      <span className="small muted">{score.toFixed(2)}</span>
    </div>
  )
}

export function Recommendations({ consensus, onImport }: { consensus: Consensus[]; onImport: () => void }) {
  const [filter, setFilter] = useState<Filter>('todas')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const counts = useMemo(
    () => ({
      todas: consensus.length,
      comprar: consensus.filter((c) => c.action === 'comprar').length,
      manter: consensus.filter((c) => c.action === 'manter').length,
      vender: consensus.filter((c) => c.action === 'vender').length
    }),
    [consensus]
  )

  const rows = useMemo(() => {
    const q = query.trim().toUpperCase()
    return consensus.filter(
      (c) =>
        (filter === 'todas' || c.action === filter) &&
        (!q || c.ticker.includes(q) || (c.company ?? '').toUpperCase().includes(q))
    )
  }, [consensus, filter, query])

  if (consensus.length === 0) {
    return (
      <div className="empty">
        <h2>Nenhuma recomendação ainda</h2>
        <p>Importe relatórios em PDF (BTG, XP, Itaú BBA…) ou arraste-os para esta janela.</p>
        <button className="primary" onClick={onImport}>
          Importar PDFs
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="toolbar">
        <div className="segmented">
          {(['todas', 'comprar', 'manter', 'vender'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'todas' ? 'Todas' : actionLabel[f]} ({counts[f]})
            </button>
          ))}
        </div>
        <input type="search" placeholder="Buscar ticker ou empresa" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Sugestão</th>
              <th>Consenso</th>
              <th className="num">Compra</th>
              <th className="num">Neutro</th>
              <th className="num">Venda</th>
              <th className="num">Preço-alvo médio</th>
              <th className="num">Preço ref.</th>
              <th className="num">Potencial</th>
              <th>Atualizado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <Fragment key={c.ticker}>
                <tr className="clickable" onClick={() => setOpen(open === c.ticker ? null : c.ticker)}>
                  <td>
                    <span className="ticker">{c.ticker}</span>
                    {c.company && <div className="small muted">{c.company}</div>}
                  </td>
                  <td>
                    <span className={`badge ${c.action}`}>{actionLabel[c.action]}</span>
                  </td>
                  <td>
                    <ScoreBar score={c.score} />
                  </td>
                  <td className="num">{c.buyCount}</td>
                  <td className="num">{c.neutralCount}</td>
                  <td className="num">{c.sellCount}</td>
                  <td className="num">{fmtMoney(c.avgTargetPrice)}</td>
                  <td className="num">{fmtMoney(c.referencePrice)}</td>
                  <td className={`num ${c.upside == null ? '' : c.upside >= 0 ? 'pos' : 'neg'}`}>{fmtPct(c.upside)}</td>
                  <td>{fmtDate(c.lastUpdate)}</td>
                </tr>
                {open === c.ticker && (
                  <tr className="details">
                    <td colSpan={10}>
                      <div className="details-inner">
                        <table>
                          <thead>
                            <tr>
                              <th>Instituição</th>
                              <th>Data</th>
                              <th>Rating</th>
                              <th className="num">Preço-alvo</th>
                              <th className="num">Peso</th>
                              <th>Tese</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.sources.map((s) => (
                              <tr key={s.reportId + s.institution}>
                                <td>{s.institution}</td>
                                <td>{fmtDate(s.reportDate)}</td>
                                <td>
                                  <span className={`badge ${s.rating}`}>{ratingLabel[s.rating]}</span>{' '}
                                  <span className="small muted">{s.originalRating}</span>
                                </td>
                                <td className="num">{fmtMoney(s.targetPrice)}</td>
                                <td className="num small muted">{(s.weight * 100).toFixed(0)}%</td>
                                <td className="wrap small">{s.thesis}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="disclaimer">
        Consolidação automática de relatórios de terceiros — não é recomendação de investimento. O preço de referência é o
        citado nos próprios relatórios, não a cotação atual. Confira sempre o documento original.
      </p>
    </>
  )
}
