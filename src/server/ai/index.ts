import type { ProviderId } from '@shared/types'
import { getApiKey, getSettings } from '../store'
import { createAnthropicProvider } from './anthropic'
import { claudeCodeStatus, createClaudeCodeProvider } from './claudeCode'
import { createGeminiProvider } from './gemini'
import type { AIProvider } from './shared'

export { AIError, type AIProvider } from './shared'

/** Instancia um provedor, ou null se ele não estiver pronto (sem chave / sem login). */
export async function createProvider(id: ProviderId, model?: string): Promise<AIProvider | null> {
  const settings = getSettings()
  if (id === 'claude-code') {
    const status = await claudeCodeStatus(settings.claudeCodePath)
    if (!status.path || !status.loggedIn) return null
    return createClaudeCodeProvider(status.path, model ?? settings.claudeCodeModel)
  }
  const { key } = getApiKey(id)
  if (!key) return null
  return id === 'anthropic'
    ? createAnthropicProvider(key, model ?? settings.anthropicModel)
    : createGeminiProvider(key, model ?? settings.geminiModel)
}

/** Provedor escolhido nas configurações, ou null se ele não estiver pronto. */
export function activeProvider(): Promise<AIProvider | null> {
  return createProvider(getSettings().provider)
}
