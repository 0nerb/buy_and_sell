import type { ImportProgress } from '@shared/types'

const ICON: Record<ImportProgress['status'], string> = {
  processando: '⏳',
  ok: '✓',
  duplicado: '•',
  erro: '✕'
}

export function ImportPanel({ items, busy, onClose }: { items: ImportProgress[]; busy: boolean; onClose: () => void }) {
  return (
    <div className="card progress-panel">
      <header>
        <span>Importação</span>
        <button className="link" onClick={onClose} disabled={busy}>
          Fechar
        </button>
      </header>
      <ul>
        {items.map((p) => (
          <li key={p.key} title={p.message}>
            <span className={`status-${p.status}`}>{ICON[p.status]}</span>
            <span className="name">{p.fileName}</span>
            <span className={`small status-${p.status}`}>{p.status === 'processando' ? 'lendo…' : p.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
