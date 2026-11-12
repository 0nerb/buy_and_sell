import { claudeCodeStatus } from './ai/claudeCode'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type ApiKeySource,
  type ApiProviderId,
  type ProviderId,
  type Quote,
  type Report,
  type Settings,
  type SettingsView
} from '@shared/types'

/**
 * Persistência simples em JSON na pasta de dados (padrão: ./data,
 * ou a variável de ambiente RECOMENDACAO_DATA_DIR).
 */

export const DATA_DIR = resolve(process.env.RECOMENDACAO_DATA_DIR ?? 'data')
export const PDF_DIR = join(DATA_DIR, 'pdfs')
mkdirSync(PDF_DIR, { recursive: true })

const file = (name: string) => join(DATA_DIR, name)

function readJson<T>(name: string, fallback: T): T {
  try {
    if (!existsSync(file(name))) return fallback
    return JSON.parse(readFileSync(file(name), 'utf8')) as T
  } catch (err) {
    console.error(`Falha ao ler ${name}:`, err)
    return fallback
  }
}

/** Grava em arquivo temporário e renomeia, para não corromper o JSON se o app fechar no meio. */
function writeJson(name: string, data: unknown, mode = 0o644): void {
  const tmp = file(`${name}.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode })
  renameSync(tmp, file(name))
  chmodSync(file(name), mode)
}

// ---------- Relatórios ----------

let reports: Report[] | null = null

export function getReports(): Report[] {
  reports ??= readJson<Report[]>('reports.json', [])
  return reports
}

export function saveReport(report: Report): void {
  const list = getReports().filter((r) => r.id !== report.id)
  list.push(report)
  list.sort((a, b) => b.reportDate.localeCompare(a.reportDate))
  reports = list
  writeJson('reports.json', list)
}

export function deleteReport(id: string): void {
  reports = getReports().filter((r) => r.id !== id)
  writeJson('reports.json', reports)
}

// ---------- Configurações ----------

export function getSettings(): Settings {
  const raw = readJson<Partial<Settings> & { model?: string }>('settings.json', {})
  // v0.1 guardava só "model" (sempre um modelo Claude).
  if (raw.model && !raw.anthropicModel) raw.anthropicModel = raw.model
  delete raw.model
  return { ...DEFAULT_SETTINGS, ...raw }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  writeJson('settings.json', next)
  return next
}

// ---------- Chaves de API ----------
// Ficam em data/secrets.json, legível só pelo seu usuário (chmod 600).
// O servidor só escuta em 127.0.0.1, então elas nunca chegam ao navegador.

type Secrets = Partial<Record<ApiProviderId, string>>

const ENV_VARS: Record<ApiProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
}

export function setApiKey(provider: ApiProviderId, key: string | null): void {
  const secrets = readJson<Secrets>('secrets.json', {})
  const trimmed = key?.trim()
  if (trimmed) secrets[provider] = trimmed
  else delete secrets[provider]
  writeJson('secrets.json', secrets, 0o600)
}

export function getApiKey(provider: ApiProviderId): { key: string | null; source: ApiKeySource } {
  const stored = readJson<Secrets>('secrets.json', {})[provider]
  if (stored) return { key: stored, source: 'salva' }
  for (const name of ENV_VARS[provider]) {
    if (process.env[name]) return { key: process.env[name]!, source: 'ambiente' }
  }
  return { key: null, source: null }
}

export async function getSettingsView(forceStatus = false): Promise<SettingsView> {
  const settings = getSettings()
  const claudeCode = await claudeCodeStatus(settings.claudeCodePath, forceStatus)
  const keys = {
    'claude-code': claudeCode.path && claudeCode.loggedIn ? ('login' as const) : null,
    anthropic: getApiKey('anthropic').source,
    gemini: getApiKey('gemini').source
  }
  return { ...settings, keys, aiReady: keys[settings.provider] !== null, claudeCode }
}

// ---------- Cotações ----------

interface PricesFile {
  updatedAt: string | null
  missing: string[]
  quotes: Record<string, Quote>
}

export function getPricesFile(): PricesFile {
  return { updatedAt: null, missing: [], quotes: {}, ...readJson<Partial<PricesFile>>('prices.json', {}) }
}

export function savePricesFile(data: PricesFile): void {
  writeJson('prices.json', data)
}
