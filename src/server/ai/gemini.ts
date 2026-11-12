import { ApiError, GoogleGenAI, type GenerateContentResponse, type Part } from '@google/genai'
import {
  AIError,
  EXTRACTION_PROMPT,
  EXTRACTION_SCHEMA,
  EXTRACTION_USER_MESSAGE,
  parseExtraction,
  type AIProvider,
  type ResearchOutput
} from './shared'

/** Dados inline numa requisição do Gemini têm limite de ~20 MB. */
const MAX_PDF_BYTES = 18 * 1024 * 1024

function translateError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status === 400 && /api key/i.test(err.message)) throw new AIError('Chave da API do Gemini inválida.')
    if (err.status === 401 || err.status === 403) throw new AIError('A chave do Gemini não tem permissão para este recurso.')
    if (err.status === 404) throw new AIError('Modelo não encontrado no Gemini. Escolha outro nas Configurações.')
    if (err.status === 429) throw new AIError('Cota da API do Gemini esgotada. Tente novamente mais tarde.')
    throw new AIError(`Erro da API do Gemini (${err.status}): ${err.message}`)
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) throw new AIError('Sem conexão com a API do Gemini.')
  throw err
}

function checkFinish(res: GenerateContentResponse): string {
  if (res.promptFeedback?.blockReason) throw new AIError('O Gemini bloqueou este pedido por política de conteúdo.')
  const reason = res.candidates?.[0]?.finishReason
  if (reason === 'MAX_TOKENS') throw new AIError('A resposta da IA foi cortada por ser longa demais.')
  if (reason === 'SAFETY' || reason === 'RECITATION') throw new AIError('O Gemini interrompeu a resposta por política de conteúdo.')
  const text = res.text
  if (!text) throw new AIError('O Gemini não retornou resposta.')
  return text
}

export function createGeminiProvider(apiKey: string, model: string): AIProvider {
  const ai = new GoogleGenAI({ apiKey })

  return {
    id: 'gemini',

    async extractReport(pdf, fallbackText) {
      const document: Part =
        pdf.byteLength <= MAX_PDF_BYTES
          ? { inlineData: { mimeType: 'application/pdf', data: pdf.toString('base64') } }
          : { text: `<relatorio>\n${await fallbackText()}\n</relatorio>` }
      let res: GenerateContentResponse
      try {
        res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [document, { text: EXTRACTION_USER_MESSAGE }] }],
          config: {
            systemInstruction: EXTRACTION_PROMPT,
            responseMimeType: 'application/json',
            responseJsonSchema: EXTRACTION_SCHEMA,
            maxOutputTokens: 32000
          }
        })
      } catch (err) {
        translateError(err)
      }
      return parseExtraction(checkFinish(res))
    },

    async research(prompt, { onStatus, onText, onSource }): Promise<ResearchOutput> {
      onStatus('Pesquisando com Google Search…')
      const sources = new Map<string, string>()
      let text = ''
      let last: GenerateContentResponse | null = null
      try {
        // Em streaming: cada carteira é gravada assim que o Gemini termina de escrevê-la.
        const stream = await ai.models.generateContentStream({
          model,
          contents: prompt,
          config: { tools: [{ googleSearch: {} }, { urlContext: {} }], maxOutputTokens: 64000 }
        })
        for await (const chunk of stream) {
          last = chunk
          if (chunk.promptFeedback?.blockReason) throw new AIError('O Gemini bloqueou este pedido por política de conteúdo.')
          const candidate = chunk.candidates?.[0]
          for (const g of candidate?.groundingMetadata?.groundingChunks ?? []) {
            if (g.web?.uri && !sources.has(g.web.uri)) {
              sources.set(g.web.uri, g.web.title ?? g.web.uri)
              onSource(g.web.uri, g.web.title ?? g.web.uri)
            }
          }
          for (const meta of candidate?.urlContextMetadata?.urlMetadata ?? []) {
            if (meta.retrievedUrl && !sources.has(meta.retrievedUrl)) {
              sources.set(meta.retrievedUrl, meta.retrievedUrl)
              onSource(meta.retrievedUrl, meta.retrievedUrl)
              onStatus(`Lendo ${meta.retrievedUrl}`)
            }
          }
          const piece = chunk.text
          if (piece) {
            text += piece
            onText(piece)
          }
        }
      } catch (err) {
        if (err instanceof AIError) throw err
        translateError(err)
      }
      const reason = last?.candidates?.[0]?.finishReason
      if (reason === 'MAX_TOKENS') throw new AIError('A resposta da IA foi cortada por ser longa demais.')
      if (reason === 'SAFETY' || reason === 'RECITATION') throw new AIError('O Gemini interrompeu a resposta por política de conteúdo.')
      if (!text) throw new AIError('O Gemini não retornou resposta.')
      return { text, sources: [...sources].map(([url, title]) => ({ url, title })) }
    },

    async structure(system, input, schema) {
      let res: GenerateContentResponse
      try {
        res = await ai.models.generateContent({
          model,
          contents: input,
          config: {
            systemInstruction: system,
            responseMimeType: 'application/json',
            responseJsonSchema: schema,
            maxOutputTokens: 32000
          }
        })
      } catch (err) {
        translateError(err)
      }
      try {
        return JSON.parse(checkFinish(res))
      } catch (err) {
        if (err instanceof AIError) throw err
        throw new AIError('Resposta da IA em formato inesperado.')
      }
    },

    async listModels() {
      try {
        const ids: string[] = []
        for await (const m of await ai.models.list()) {
          const id = m.name?.replace(/^models\//, '')
          if (id?.startsWith('gemini') && (m.supportedActions ?? ['generateContent']).includes('generateContent')) {
            ids.push(id)
          }
        }
        return ids.sort().reverse()
      } catch (err) {
        translateError(err)
      }
    }
  }
}
