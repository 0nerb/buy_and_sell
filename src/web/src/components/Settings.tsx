import { useEffect, useState } from 'react'
import { api } from '../api'
import { DEFAULT_INSTITUTIONS, PROVIDER_LABEL, type ProviderId, type SettingsView } from '@shared/types'

interface Props {
  settings: SettingsView
  onChange: (s: SettingsView) => void
  onSaved: () => void
}

const PROVIDERS: ProviderId[] = ['anthropic', 'gemini']

const KEY_INFO: Record<ProviderId, { url: string; site: string; placeholder: string; env: string }> = {
  anthropic: {
    url: 'https://console.anthropic.com/settings/keys',
    site: 'console.anthropic.com',
    placeholder: 'sk-ant-…',
    env: 'ANTHROPIC_API_KEY'
  },
  gemini: {
    url: 'https://aistudio.google.com/apikey',
    site: 'aistudio.google.com',
    placeholder: 'AIza…',
    env: 'GEMINI_API_KEY'
  }
}

/** Sugestões exibidas antes de a lista real de modelos ser carregada da API. */
const SUGGESTED_MODELS: Record<ProviderId, string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  gemini: []
}

export function Settings({ settings, onChange, onSaved }: Props) {
  const save = async (patch: Partial<SettingsView>) => {
    onChange(await api.saveSettings(patch))
    onSaved()
  }

  return (
    <div className="settings">
      <section className="card">
        <h2>Provedor de IA</h2>
        <p className="muted">
          A IA lê os PDFs e faz a busca automática de carteiras. Você pode cadastrar as duas chaves e alternar quando
          quiser. As chaves ficam só no seu computador (data/secrets.json) e nunca são enviadas ao navegador.
        </p>
        <div className="field">
          <label>Usar</label>
          <select value={settings.provider} onChange={(e) => save({ provider: e.target.value as ProviderId })}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
                {settings.keys[p] ? '' : ' — sem chave'}
              </option>
            ))}
          </select>
        </div>
      </section>

      {PROVIDERS.map((p) => (
        <ProviderSection
          key={p}
          provider={p}
          settings={settings}
          active={settings.provider === p}
          onChange={(s) => {
            onChange(s)
            onSaved()
          }}
          onSave={save}
        />
      ))}

      <InstitutionsSection settings={settings} onSave={save} />

      <section className="card">
        <h2>Cálculo do consenso</h2>
        <p className="muted small">
          Para cada banco vale a recomendação mais recente sobre o ativo (e só a versão mais recente de cada carteira).
          Recomendações pesam menos com o tempo; o score vai de −1 (todos dizem venda) a +1 (todos dizem compra).
        </p>
        <NumberField label="Ações na carteira consolidada" value={settings.portfolioSize} min={1} max={50} onSave={(v) => save({ portfolioSize: v })} />
        <NumberField label="Ignorar relatórios com mais de (dias)" value={settings.maxAgeDays} min={1} onSave={(v) => save({ maxAgeDays: v })} />
        <NumberField label="Meia-vida do peso (dias)" value={settings.halfLifeDays} min={1} onSave={(v) => save({ halfLifeDays: v })} />
        <NumberField
          label="Score mínimo para comprar/vender"
          value={settings.actionThreshold}
          min={0.05}
          max={1}
          step={0.05}
          onSave={(v) => save({ actionThreshold: v })}
        />
      </section>
    </div>
  )
}

function ProviderSection(props: {
  provider: ProviderId
  settings: SettingsView
  active: boolean
  onChange: (s: SettingsView) => void
  onSave: (patch: Partial<SettingsView>) => void
}) {
  const { provider, settings } = props
  const info = KEY_INFO[provider]
  const source = settings.keys[provider]
  const modelField = provider === 'anthropic' ? 'anthropicModel' : 'geminiModel'
  const model = settings[modelField]

  const [key, setKey] = useState('')
  const [status, setStatus] = useState('')
  const [models, setModels] = useState<string[]>(SUGGESTED_MODELS[provider])
  const [loading, setLoading] = useState(false)

  const loadModels = async () => {
    setLoading(true)
    setStatus('')
    try {
      const list = await api.listModels(provider)
      if (list.length) setModels(list)
      setStatus(list.length ? `${list.length} modelos disponíveis na sua conta.` : '')
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  // Carrega a lista real de modelos quando há chave.
  useEffect(() => {
    if (source) loadModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const saveKey = async (value: string | null) => {
    props.onChange(await api.setApiKey(provider, value))
    setKey('')
    setStatus(value ? 'Chave salva.' : 'Chave removida.')
  }

  const options = models.includes(model) ? models : [model, ...models]

  return (
    <section className="card">
      <h2>
        {PROVIDER_LABEL[provider]} {props.active && <span className="badge ia">em uso</span>}
      </h2>
      <p className="muted small">
        Crie uma chave em{' '}
        <a href={info.url} target="_blank" rel="noreferrer">
          {info.site}
        </a>
        . {source === 'ambiente' && `Usando a variável de ambiente ${info.env}.`}
      </p>
      <div className="field">
        <label>Chave de API</label>
        <div className="row">
          <input
            type="password"
            placeholder={source ? '•••••••• (configurada)' : info.placeholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="primary" disabled={!key.trim()} onClick={() => saveKey(key)}>
            Salvar
          </button>
          {source === 'salva' && (
            <button className="danger" onClick={() => saveKey(null)}>
              Remover
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <label>Modelo</label>
        <div className="row">
          <select value={model} onChange={(e) => props.onSave({ [modelField]: e.target.value })}>
            {options.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <button onClick={loadModels} disabled={!source || loading}>
            {loading ? 'Carregando…' : 'Atualizar lista'}
          </button>
        </div>
      </div>
      {status && <p className="small muted">{status}</p>}
    </section>
  )
}

function InstitutionsSection({ settings, onSave }: { settings: SettingsView; onSave: (p: Partial<SettingsView>) => void }) {
  const [draft, setDraft] = useState('')
  const list = settings.trackedInstitutions
  const add = () => {
    const name = draft.trim()
    if (name && !list.some((i) => i.toLowerCase() === name.toLowerCase())) onSave({ trackedInstitutions: [...list, name] })
    setDraft('')
  }
  return (
    <section className="card">
      <h2>Instituições acompanhadas</h2>
      <p className="muted small">A busca automática procura as carteiras recomendadas destas instituições.</p>
      <div className="chips">
        {list.map((i) => (
          <span key={i} className="chip">
            {i}
            <button
              className="link"
              title="Remover"
              onClick={() => onSave({ trackedInstitutions: list.filter((x) => x !== i) })}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          placeholder="Adicionar instituição (ex.: Empiricus)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button onClick={add} disabled={!draft.trim()}>
          Adicionar
        </button>
        <button onClick={() => onSave({ trackedInstitutions: DEFAULT_INSTITUTIONS })}>Restaurar padrão</button>
      </div>
    </section>
  )
}

function NumberField(props: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onSave: (v: number) => void
}) {
  const [draft, setDraft] = useState(String(props.value))
  const commit = () => {
    const n = Number(draft)
    const valid = Number.isFinite(n) && n >= (props.min ?? -Infinity) && n <= (props.max ?? Infinity)
    if (valid && n !== props.value) props.onSave(n)
    else setDraft(String(props.value))
  }
  return (
    <div className="field">
      <label>{props.label}</label>
      <input
        type="number"
        value={draft}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </div>
  )
}
