import type { ProviderId } from '@shared/types'
import { getApiKey, getSettings } from '../store'
import { createAnthropicProvider } from './anthropic'
import { createGeminiProvider } from './gemini'
import type { AIProvider } from './shared'

export { AIError, type AIProvider } from './shared'

/** Instancia um provedor específico (ex.: para listar modelos na tela de configurações). */
export function createProvider(id: ProviderId, model?: string): AIProvider | null {
  const { key } = getApiKey(id)
  if (!key) return null
  const settings = getSettings()
  return id === 'anthropic'
    ? createAnthropicProvider(key, model ?? settings.anthropicModel)
    : createGeminiProvider(key, model ?? settings.geminiModel)
}

/** Provedor escolhido nas configurações, ou null se ele não tiver chave. */
export function activeProvider(): AIProvider | null {
  return createProvider(getSettings().provider)
}
