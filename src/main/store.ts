import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_SETTINGS,
  type ApiKeySource,
  type ProviderId,
  type Report,
  type Settings,
  type SettingsView
} from '@shared/types'

/**
 * Persistência simples em JSON dentro da pasta de dados do app
 * (macOS: ~/Library/Application Support/Recomendação, Windows: %APPDATA%\Recomendação).
 */

const file = (name: string) => join(app.getPath('userData'), name)

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
function writeJson(name: string, data: unknown): void {
  const tmp = file(`${name}.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file(name))
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
// Criptografadas com o cofre do SO (Keychain no macOS, DPAPI no Windows).

type Secrets = Partial<Record<ProviderId, string>> & { apiKey?: string }

const ENV_VARS: Record<ProviderId, string[]> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
}

/** Chaves digitadas nesta sessão (usadas também quando o SO não tem cofre). */
const sessionKeys: Partial<Record<ProviderId, string | null>> = {}

function readSecrets(): Secrets {
  const s = readJson<Secrets>('secrets.json', {})
  // v0.1 tinha uma única chave (Anthropic) em "apiKey".
  if (s.apiKey && !s.anthropic) s.anthropic = s.apiKey
  delete s.apiKey
  return s
}

export function setApiKey(provider: ProviderId, key: string | null): void {
  const trimmed = key?.trim() || null
  sessionKeys[provider] = trimmed
  const secrets = readSecrets()
  if (!trimmed) delete secrets[provider]
  else if (safeStorage.isEncryptionAvailable()) {
    secrets[provider] = safeStorage.encryptString(trimmed).toString('base64')
  }
  writeJson('secrets.json', secrets)
}

export function getApiKey(provider: ProviderId): { key: string | null; source: ApiKeySource } {
  const session = sessionKeys[provider]
  if (session) return { key: session, source: 'salva' }
  if (session === undefined) {
    const stored = readSecrets()[provider]
    if (stored && safeStorage.isEncryptionAvailable()) {
      try {
        const key = safeStorage.decryptString(Buffer.from(stored, 'base64'))
        sessionKeys[provider] = key
        return { key, source: 'salva' }
      } catch (err) {
        console.error('Não foi possível descriptografar a chave salva:', err)
      }
    }
  }
  for (const name of ENV_VARS[provider]) {
    if (process.env[name]) return { key: process.env[name]!, source: 'ambiente' }
  }
  return { key: null, source: null }
}

export function getSettingsView(): SettingsView {
  const settings = getSettings()
  const keys = {
    anthropic: getApiKey('anthropic').source,
    gemini: getApiKey('gemini').source
  }
  return {
    ...settings,
    keys,
    aiReady: keys[settings.provider] !== null,
    canPersistKey: safeStorage.isEncryptionAvailable()
  }
}
