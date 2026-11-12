import { Fragment, useState } from 'react'
import type { Report } from '@shared/types'
import { api } from '../api'
import { fmtDate, fmtMoney, ratingLabel } from '../format'

interface Props {
  reports: Report[]
  onChange: () => void
  onImport: () => void
}

function EditRow({ report, onDone }: { report: Report; onDone: () => void }) {
  const [institution, setInstitution] = useState(report.institution)
  const [reportDate, setReportDate] = useState(report.reportDate)
  const save = async () => {
    await api.updateReport(report.id, { institution, reportDate })
    onDone()
  }
  return (
    <div className="row">
      <input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Instituição" />
      <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} style={{ flex: 0 }} />
      <button className="primary" onClick={save}>
        Salvar
      </button>
      <button onClick={onDone}>Cancelar</button>
    </div>
  )
}

export function Reports({ reports, onChange, onImport }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    onChange()
  }

  if (reports.length === 0) {
    return (
      <div className="empty">
        <h2>Nenhum relatório importado</h2>
        <p>Arraste PDFs para esta página ou use o botão Importar PDFs.</p>
        <button className="primary" onClick={onImport}>
          Importar PDFs
        </button>
      </div>
    )
  }

  return (
    <>
      {error && <div className="notice">{error}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Instituição</th>
              <th>Relatório</th>
              <th className="num">Recomendações</th>
              <th>Leitura</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <Fragment key={r.id}>
                <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td>{fmtDate(r.reportDate)}</td>
                  <td>{r.institution}</td>
                  <td className="wrap">
                    <div>{r.title || r.fileName}</div>
                    <div className="small muted">{r.source === 'web' ? r.sourceUrl ?? 'sem URL de origem' : r.fileName}</div>
                  </td>
                  <td className="num">{r.calls.length}</td>
                  <td>
                    {r.source === 'web' ? (
                      <span className="badge ia" title={r.sourceVerified ? 'Fonte confirmada na busca' : 'A URL não apareceu nos resultados da busca — confira'}>
                        Web{r.sourceVerified ? '' : ' ⚠'}
                      </span>
                    ) : (
                      <span className={`badge ${r.method}`}>{r.method === 'ia' ? 'IA' : 'Heurística'}</span>
                    )}
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <button
                        disabled={r.source === 'web' && !r.sourceUrl}
                        onClick={() => api.openReport(r)}
                      >
                        {r.source === 'web' ? 'Fonte' : 'Abrir'}
                      </button>
                      <button onClick={() => setEditing(r.id)}>Editar</button>
                      {r.source !== 'web' && (
                        <button
                          disabled={busy === r.id}
                          onClick={async () => {
                            setBusy(r.id)
                            await act(() => api.reprocessReport(r.id))
                            setBusy(null)
                          }}
                        >
                          {busy === r.id ? 'Lendo…' : 'Reprocessar'}
                        </button>
                      )}
                      <button
                        className="danger"
                        onClick={() => confirm(`Remover "${r.fileName}"?`) && act(() => api.deleteReport(r.id))}
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
                {editing === r.id && (
                  <tr className="details">
                    <td colSpan={6}>
                      <div className="details-inner">
                        <EditRow
                          report={r}
                          onDone={() => {
                            setEditing(null)
                            onChange()
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                )}
                {open === r.id && (
                  <tr className="details">
                    <td colSpan={6}>
                      <div className="details-inner">
                        {r.summary && <p className="wrap">{r.summary}</p>}
                        {r.calls.length === 0 ? (
                          <p className="muted">Nenhuma recomendação de ação encontrada neste relatório.</p>
                        ) : (
                          <table>
                            <thead>
                              <tr>
                                <th>Ticker</th>
                                <th>Rating</th>
                                <th className="num">Preço-alvo</th>
                                <th className="num">Preço no relatório</th>
                                <th>Tese</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.calls.map((c) => (
                                <tr key={c.ticker}>
                                  <td className="ticker">{c.ticker}</td>
                                  <td>
                                    <span className={`badge ${c.rating}`}>{ratingLabel[c.rating]}</span>{' '}
                                    <span className="small muted">{c.originalRating}</span>
                                  </td>
                                  <td className="num">
                                    {c.currency === 'BRL' ? fmtMoney(c.targetPrice) : c.targetPrice != null ? `${c.currency} ${c.targetPrice}` : '—'}
                                  </td>
                                  <td className="num">
                                    {c.currency === 'BRL' ? fmtMoney(c.priceAtReport) : c.priceAtReport != null ? `${c.currency} ${c.priceAtReport}` : '—'}
                                  </td>
                                  <td className="wrap small">{c.thesis}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
