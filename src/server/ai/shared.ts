import { z } from 'zod'
import type { ProviderId } from '@shared/types'
import { dedupeCalls, type ExtractedReport } from '../extract/common'

/**
 * Tudo que é igual entre os provedores de IA: prompts, JSON Schemas
 * e a validação das respostas. Cada provedor só implementa o transporte.
 */

export class AIError extends Error {}

/** O que todo provedor de IA precisa saber fazer. */
export interface AIProvider {
  id: ProviderId
  /** Lê um relatório (PDF) e devolve as recomendações estruturadas. */
  extractReport(pdf: Buffer, fallbackText: () => Promise<string>): Promise<ExtractedReport>
  /** Pesquisa na web e devolve um texto corrido com o que achou + URLs consultadas. */
  research(prompt: string, onStatus: (msg: string) => void): Promise<ResearchOutput>
  /** Converte texto livre em JSON seguindo o schema (sem acesso à web). */
  structure(system: string, input: string, schema: object): Promise<unknown>
  listModels(): Promise<string[]>
}

export interface ResearchOutput {
  text: string
  /** URLs/títulos que a ferramenta de busca realmente retornou. */
  sources: { url: string; title: string }[]
}

// ---------- Extração de relatórios ----------

export const EXTRACTION_PROMPT = `Você é um analista que lê relatórios de research de bancos e corretoras (BTG Pactual, XP, Itaú BBA, Bradesco BBI, Safra, etc.) e extrai as recomendações de investimento em ações de forma estruturada.

Regras:
- Extraia apenas recomendações EXPLÍCITAS do relatório para ativos específicos (ações, units, BDRs). Não invente recomendações para empresas apenas citadas.
- "rating" é a recomendação normalizada:
  • "compra": Compra, Buy, Outperform, Overweight, Acima da Média/Mercado, inclusão ou permanência em carteira recomendada.
  • "neutro": Neutro, Manter, Hold, Market Perform, Equal Weight, Em Linha, ou ativo REMOVIDO de carteira recomendada.
  • "venda": Venda, Sell, Underperform, Underweight, Abaixo da Média/Mercado, Reduzir.
- "originalRating": o texto exato do rating no relatório (ou "Carteira recomendada" quando for o caso).
- "ticker": código na bolsa em maiúsculas (ex.: PETR4, VALE3, ITUB4). Para ativos estrangeiros use o código da bolsa de origem.
- Preços: use números decimais (ex.: 34.5). "currency" é o código ISO (BRL, USD...). Use null se o relatório não informar.
- "priceAtReport": preço/cotação de referência citada no relatório, se houver.
- "thesis": 1 a 2 frases em português com o principal argumento do analista.
- "institution": nome da instituição que publicou o relatório.
- "reportDate": data de publicação no formato YYYY-MM-DD. Se não houver, use null.
- "summary": 2 a 3 frases em português resumindo o relatório.
- Se o relatório não tiver nenhuma recomendação de ações, retorne "calls" vazio.`

export const EXTRACTION_USER_MESSAGE = 'Extraia as recomendações deste relatório.'

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

export const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['institution', 'reportDate', 'title', 'summary', 'calls'],
  properties: {
    institution: { type: 'string' },
    reportDate: nullable({ type: 'string' }),
    title: { type: 'string' },
    summary: { type: 'string' },
    calls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ticker', 'company', 'rating', 'originalRating', 'targetPrice',
          'priceAtReport', 'currency', 'horizon', 'thesis'
        ],
        properties: {
          ticker: { type: 'string' },
          company: nullable({ type: 'string' }),
          rating: { type: 'string', enum: ['compra', 'neutro', 'venda'] },
          originalRating: { type: 'string' },
          targetPrice: nullable({ type: 'number' }),
          priceAtReport: nullable({ type: 'number' }),
          currency: { type: 'string' },
          horizon: nullable({ type: 'string' }),
          thesis: { type: 'string' }
        }
      }
    }
  }
}

const ExtractionSchema = z.object({
  institution: z.string(),
  reportDate: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  calls: z.array(
    z.object({
      ticker: z.string(),
      company: z.string().nullable(),
      rating: z.enum(['compra', 'neutro', 'venda']),
      originalRating: z.string(),
      targetPrice: z.number().nullable(),
      priceAtReport: z.number().nullable(),
      currency: z.string(),
      horizon: z.string().nullable(),
      thesis: z.string()
    })
  )
})

/** Valida o JSON devolvido por qualquer provedor e normaliza os campos. */
export function parseExtraction(raw: string): ExtractedReport {
  let parsed: z.infer<typeof ExtractionSchema>
  try {
    parsed = ExtractionSchema.parse(JSON.parse(raw))
  } catch {
    throw new AIError('Resposta da IA em formato inesperado.')
  }
  return {
    institution: parsed.institution,
    reportDate: parsed.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.reportDate) ? parsed.reportDate : '',
    title: parsed.title,
    summary: parsed.summary,
    calls: dedupeCalls(
      parsed.calls.map((c) => ({
        ...c,
        ticker: c.ticker.toUpperCase().trim(),
        currency: c.currency.toUpperCase() || 'BRL'
      }))
    )
  }
}

// ---------- Busca de carteiras recomendadas ----------

const MONTHS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
]

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} de ${y}`
}

export function researchPrompt(month: string, institutions: string[]): string {
  return `Pesquise na web as carteiras recomendadas de AÇÕES BRASILEIRAS (B3) de ${monthLabel(month)} publicadas pelas seguintes instituições:
${institutions.map((i) => `- ${i}`).join('\n')}

Como pesquisar:
- Procure tanto nos sites oficiais das instituições quanto em compilações mensais de imprensa especializada (ex.: InfoMoney, Money Times, Valor Investe, E-Investidor, Exame), que costumam listar as carteiras de várias corretoras de uma vez.
- Considere carteiras de ações em geral (ex.: "Carteira Recomendada", "Top 10", "Carteira Dividendos", "Small Caps"). Ignore carteiras de FIIs, renda fixa, fundos e BDRs.
- Se não encontrar a carteira de ${monthLabel(month)} de alguma instituição, use a mais recente que encontrar e informe a data dela. Se não encontrar nenhuma, diga explicitamente.

Na resposta, para CADA carteira encontrada, informe:
- instituição e nome da carteira;
- mês de referência e data de publicação;
- todos os ativos (ticker, empresa e peso em %, se houver);
- a URL exata da página onde você leu a informação.

Liste apenas o que você leu nas páginas. Nunca complete uma carteira de memória.`
}

export const STRUCTURE_PROMPT = `Você recebe as anotações de uma pesquisa sobre carteiras recomendadas de ações e deve convertê-las em JSON.
Regras:
- Inclua apenas carteiras e ativos que aparecem explicitamente nas anotações. Não acrescente nada.
- "ticker" em maiúsculas no padrão da B3 (ex.: PETR4, ITUB4, TAEE11).
- "weight" é o peso em fração (12,5% -> 0.125); null se não informado.
- "referenceMonth" no formato YYYY-MM; "publishedDate" em YYYY-MM-DD ou null.
- "sourceUrl" deve ser a URL citada nas anotações para aquela carteira; use null se não houver.
- Em "notFound", liste as instituições pedidas para as quais as anotações dizem não ter encontrado carteira.`

export const PORTFOLIOS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['portfolios', 'notFound'],
  properties: {
    portfolios: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['institution', 'portfolioName', 'referenceMonth', 'publishedDate', 'sourceUrl', 'assets'],
        properties: {
          institution: { type: 'string' },
          portfolioName: { type: 'string' },
          referenceMonth: { type: 'string' },
          publishedDate: nullable({ type: 'string' }),
          sourceUrl: nullable({ type: 'string' }),
          assets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['ticker', 'company', 'weight'],
              properties: {
                ticker: { type: 'string' },
                company: nullable({ type: 'string' }),
                weight: nullable({ type: 'number' })
              }
            }
          }
        }
      }
    },
    notFound: { type: 'array', items: { type: 'string' } }
  }
}

export const PortfoliosSchema = z.object({
  portfolios: z.array(
    z.object({
      institution: z.string(),
      portfolioName: z.string(),
      referenceMonth: z.string(),
      publishedDate: z.string().nullable(),
      sourceUrl: z.string().nullable(),
      assets: z.array(z.object({ ticker: z.string(), company: z.string().nullable(), weight: z.number().nullable() }))
    })
  ),
  notFound: z.array(z.string())
})

export type FoundPortfolios = z.infer<typeof PortfoliosSchema>
