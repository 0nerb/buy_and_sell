import Anthropic from '@anthropic-ai/sdk'
import {
  AIError,
  EXTRACTION_PROMPT,
  EXTRACTION_SCHEMA,
  EXTRACTION_USER_MESSAGE,
  parseExtraction,
  type AIProvider,
  type ResearchOutput
} from './shared'

/** Limite da API é 32 MB por requisição (base64 incha ~33%). */
const MAX_PDF_BYTES = 22 * 1024 * 1024
/** Quantas vezes retomamos um turno pausado pelo servidor (pause_turn). */
const MAX_CONTINUATIONS = 6
/** Se o modelo recusar por política, a API reexecuta em outro modelo automaticamente. */
const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default'
}

function translateError(err: unknown): never {
  if (err instanceof Anthropic.AuthenticationError) throw new AIError('Chave da API da Anthropic inválida.')
  if (err instanceof Anthropic.PermissionDeniedError) throw new AIError('A chave da Anthropic não tem permissão para este modelo.')
  if (err instanceof Anthropic.NotFoundError) throw new AIError('Modelo não encontrado na Anthropic. Escolha outro nas Configurações.')
  if (err instanceof Anthropic.RateLimitError) throw new AIError('Limite de uso da API da Anthropic atingido. Tente novamente em instantes.')
  if (err instanceof Anthropic.BadRequestError) throw new AIError(`Requisição rejeitada pela Anthropic: ${err.message}`)
  if (err instanceof Anthropic.APIConnectionError) throw new AIError('Sem conexão com a API da Anthropic.')
  if (err instanceof Anthropic.APIError) throw new AIError(`Erro da API da Anthropic (${err.status}): ${err.message}`)
  throw err
}

function checkStop(message: Anthropic.Beta.BetaMessage): void {
  if (message.stop_reason === 'refusal') throw new AIError('O modelo se recusou a processar este pedido.')
  if (message.stop_reason === 'max_tokens') throw new AIError('A resposta da IA foi cortada por ser longa demais.')
}

const textOf = (message: Anthropic.Beta.BetaMessage) =>
  message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')

export function createAnthropicProvider(apiKey: string, model: string): AIProvider {
  const client = new Anthropic({ apiKey })

  return {
    id: 'anthropic',

    async extractReport(pdf, fallbackText) {
      const document: Anthropic.Beta.BetaContentBlockParam =
        pdf.byteLength <= MAX_PDF_BYTES
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } }
          : { type: 'text', text: `<relatorio>\n${await fallbackText()}\n</relatorio>` }

      let message: Anthropic.Beta.BetaMessage
      try {
        message = await client.beta.messages
          .stream({
            model,
            max_tokens: 32000,
            ...FALLBACK,
            system: EXTRACTION_PROMPT,
            output_config: { effort: 'medium', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
            messages: [{ role: 'user', content: [document, { type: 'text', text: EXTRACTION_USER_MESSAGE }] }]
          })
          .finalMessage()
      } catch (err) {
        translateError(err)
      }
      checkStop(message)
      return parseExtraction(textOf(message))
    },

    async research(prompt, onStatus): Promise<ResearchOutput> {
      const tools: Anthropic.Beta.BetaToolUnion[] = [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 30 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 30 }
      ]
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
      const sources = new Map<string, string>()
      const texts: string[] = []
      let searches = 0

      for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
        let message: Anthropic.Beta.BetaMessage
        try {
          const stream = client.beta.messages.stream({
            model,
            max_tokens: 64000,
            ...FALLBACK,
            output_config: { effort: 'medium' },
            tools,
            messages
          })
          stream.on('contentBlock', (block) => {
            if (block.type === 'server_tool_use' && block.name === 'web_search') {
              searches++
              const query = (block.input as { query?: string }).query
              onStatus(`Pesquisa ${searches}${query ? `: "${query}"` : ''}`)
            } else if (block.type === 'server_tool_use' && block.name === 'web_fetch') {
              const url = (block.input as { url?: string }).url
              onStatus(`Lendo ${url ?? 'página'}`)
            }
          })
          message = await stream.finalMessage()
        } catch (err) {
          translateError(err)
        }

        for (const block of message.content) {
          if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
            for (const r of block.content) sources.set(r.url, r.title)
          } else if (block.type === 'web_fetch_tool_result' && block.content.type === 'web_fetch_result') {
            sources.set(block.content.url, block.content.content.title ?? block.content.url)
          } else if (block.type === 'text') {
            texts.push(block.text)
          }
        }

        if (message.stop_reason === 'pause_turn') {
          // O servidor pausou o loop de ferramentas: reenviamos o turno e ele continua de onde parou.
          messages.push({ role: 'assistant', content: message.content })
          continue
        }
        checkStop(message)
        return { text: texts.join(''), sources: [...sources].map(([url, title]) => ({ url, title })) }
      }
      throw new AIError('A pesquisa demorou demais e foi interrompida.')
    },

    async structure(system, input, schema) {
      let message: Anthropic.Beta.BetaMessage
      try {
        message = await client.beta.messages
          .stream({
            model,
            max_tokens: 32000,
            ...FALLBACK,
            system,
            output_config: { effort: 'low', format: { type: 'json_schema', schema: schema as Record<string, unknown> } },
            messages: [{ role: 'user', content: input }]
          })
          .finalMessage()
      } catch (err) {
        translateError(err)
      }
      checkStop(message)
      try {
        return JSON.parse(textOf(message))
      } catch {
        throw new AIError('Resposta da IA em formato inesperado.')
      }
    },

    async listModels() {
      try {
        const ids: string[] = []
        for await (const m of client.models.list()) ids.push(m.id)
        return ids
      } catch (err) {
        translateError(err)
      }
    }
  }
}
