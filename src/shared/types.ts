/** Recomendação normalizada, independente do vocabulário de cada banco. */
export type Rating = 'compra' | 'neutro' | 'venda'

/** Ação final sugerida pelo consenso. */
export type Action = 'comprar' | 'manter' | 'vender'

/** Uma recomendação sobre um ativo, extraída de um relatório. */
export interface StockCall {
  ticker: string
  company: string | null
  rating: Rating
  /** Texto do rating como aparece no relatório (ex.: "Outperform", "Compra"). */
  originalRating: string
  targetPrice: number | null
  /** Preço citado no relatório na data da publicação. */
  priceAtReport: number | null
  currency: string
  horizon: string | null
  /** Resumo curto da tese do analista. */
  thesis: string
}

export type ExtractionMethod = 'ia' | 'heuristica'

/**
 * Fornecedores de IA suportados.
 *  - claude-code: usa a assinatura Claude (Pro/Max) pelo Claude Code instalado neste computador;
 *  - anthropic / gemini: chave de API, cobrança por uso.
 */
export type ProviderId = 'claude-code' | 'anthropic' | 'gemini'

/** Provedores que usam chave de API. */
export type ApiProviderId = Exclude<ProviderId, 'claude-code'>

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  'claude-code': 'Claude — assinatura Pro/Max',
  anthropic: 'Claude — chave de API',
  gemini: 'Gemini — chave de API'
}

/** Origem do relatório: PDF importado ou carteira encontrada pela busca na web. */
export type ReportSource = 'pdf' | 'web'

export interface Report {
  /** SHA-256 do arquivo — evita importar o mesmo PDF duas vezes. */
  id: string
  fileName: string
  /** Cópia do PDF na pasta de dados ('' para carteiras da web). */
  filePath: string
  institution: string
  /** Data de publicação (YYYY-MM-DD). */
  reportDate: string
  title: string
  summary: string
  importedAt: string
  method: ExtractionMethod
  /** Qual IA leu o relatório (quando method = 'ia'). */
  provider?: ProviderId
  /** Ausente em relatórios antigos = 'pdf'. */
  source?: ReportSource
  /**
   * Nome da carteira recomendada (ex.: "Carteira Dividendos").
   * Quando preenchido, só a versão mais recente dessa carteira conta:
   * um ativo que saiu da carteira deixa de ser recomendado.
   */
  portfolioName?: string | null
  sourceUrl?: string | null
  /** true quando a URL apareceu de fato nos resultados da busca. */
  sourceVerified?: boolean
  calls: StockCall[]
}

export interface ConsensusSource {
  reportId: string
  institution: string
  reportDate: string
  rating: Rating
  originalRating: string
  targetPrice: number | null
  priceAtReport: number | null
  thesis: string
  weight: number
}

export interface Consensus {
  ticker: string
  company: string | null
  action: Action
  /** -1 (venda unânime) a +1 (compra unânime), ponderado pela recência. */
  score: number
  buyCount: number
  neutralCount: number
  sellCount: number
  avgTargetPrice: number | null
  /** Preço mais recente citado nos relatórios (não é cotação em tempo real). */
  referencePrice: number | null
  upside: number | null
  lastUpdate: string
  sources: ConsensusSource[]
}

export interface Settings {
  provider: ProviderId
  /** Alias do Claude Code: opus, sonnet ou haiku. */
  claudeCodeModel: string
  /** Caminho do executável do Claude Code ('' = detectar automaticamente). */
  claudeCodePath: string
  anthropicModel: string
  geminiModel: string
  /** Instituições cujas carteiras recomendadas a busca automática procura. */
  trackedInstitutions: string[]
  /** Quantas ações entram na carteira consolidada. */
  portfolioSize: number
  /** Relatórios mais antigos que isso são ignorados no consenso. */
  maxAgeDays: number
  /** Meia-vida (dias) do peso de cada recomendação. */
  halfLifeDays: number
  /** Score mínimo (em módulo) para sugerir comprar/vender. */
  actionThreshold: number
}

export const DEFAULT_INSTITUTIONS = [
  'XP',
  'BTG Pactual',
  'Itaú BBA',
  'Bradesco BBI',
  'Santander',
  'Safra',
  'Genial',
  'BB Investimentos',
  'Ágora',
  'Inter'
]

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude-code',
  claudeCodeModel: 'opus',
  claudeCodePath: '',
  anthropicModel: 'claude-opus-5-5',
  geminiModel: 'gemini-3.8-flash',
  trackedInstitutions: DEFAULT_INSTITUTIONS,
  portfolioSize: 10,
  maxAgeDays: 120,
  halfLifeDays: 45,
  actionThreshold: 0.4
}

export type ApiKeySource = 'salva' | 'ambiente' | 'login' | null

/** Situação do Claude Code neste computador. */
export interface ClaudeCodeStatus {
  /** Caminho do executável encontrado (null = não instalado/não encontrado). */
  path: string | null
  version: string | null
  loggedIn: boolean
  email: string | null
  /** Plano da assinatura (pro, max…) ou o método de login. */
  plan: string | null
  /** Uso da assinatura na última chamada (0..1), se disponível. */
  usage: { fiveHour: number | null; sevenDay: number | null; resetsAt: string | null } | null
  error: string | null
}

export interface SettingsView extends Settings {
  /** Fonte da chave de cada fornecedor (null = não configurada). */
  keys: Record<ProviderId, ApiKeySource>
  /** true quando o fornecedor ativo tem chave — ou seja, dá para usar IA. */
  aiReady: boolean
  claudeCode: ClaudeCodeStatus
}

export interface ImportProgress {
  /** Identificador local do arquivo na fila de importação. */
  key: string
  fileName: string
  status: 'processando' | 'ok' | 'duplicado' | 'erro'
  message?: string
}

export type ImportResult = { status: 'ok'; report: Report } | { status: 'duplicado' }

export interface SearchProgress {
  stage: 'pesquisando' | 'organizando' | 'ok' | 'erro'
  message: string
}

export interface SearchResult {
  month: string
  portfolios: number
  institutions: string[]
  notFound: string[]
}

export interface ConsolidatedEntry {
  ticker: string
  company: string | null
  /** Instituições que recomendam compra atualmente. */
  institutions: string[]
  /** Peso sugerido (0..1), proporcional ao nº de indicações. */
  weight: number
  score: number
  avgTargetPrice: number | null
  upside: number | null
  /** "novo" = não estava na carteira consolidada de 30 dias atrás. */
  status: 'novo' | 'mantido'
}

export interface ConsolidatedPortfolio {
  /** Nº de instituições com relatórios dentro da janela de tempo. */
  institutionsTracked: number
  entries: ConsolidatedEntry[]
  /** Estavam na carteira de 30 dias atrás e saíram. */
  removed: { ticker: string; company: string | null }[]
}
