import YahooFinance from 'yahoo-finance2'
import type { PricesInfo, Quote } from '@shared/types'
import { getPricesFile, getReports, savePricesFile } from './store'

/**
 * Cotações via Yahoo Finance (a mesma fonte do yfinance do Python, aqui pelo
 * pacote yahoo-finance2 para não exigir Python instalado). Ações da B3 usam o
 * sufixo ".SA" no Yahoo; as cotações costumam ter ~15 minutos de atraso.
 */

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] })
const B3_TICKER = /^[A-Z]{4}(3|4|5|6|11)$/
const BATCH = 50
/** Consultas simultâneas ao Yahoo para o preço-alvo dos analistas (uma por ação). */
const TARGET_CONCURRENCY = 6

/** Preço-alvo médio dos analistas (módulo financialData do Yahoo). Null se não houver. */
async function analystTarget(ticker: string): Promise<Quote['analystTarget']> {
  try {
    const r = await yf.quoteSummary(`${ticker}.SA`, { modules: ['financialData'] })
    const f = r.financialData
    if (typeof f?.targetMeanPrice !== 'number' || !(f.targetMeanPrice > 0)) return null
    return {
      mean: f.targetMeanPrice,
      low: typeof f.targetLowPrice === 'number' ? f.targetLowPrice : null,
      high: typeof f.targetHighPrice === 'number' ? f.targetHighPrice : null,
      analysts: typeof f.numberOfAnalystOpinions === 'number' ? f.numberOfAnalystOpinions : null
    }
  } catch {
    return null
  }
}

/** Roda `fn` para cada item com no máximo `limit` ao mesmo tempo. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

/** Todos os tickers da B3 citados nos relatórios e carteiras salvos. */
function trackedTickers(): string[] {
  const set = new Set<string>()
  for (const r of getReports()) for (const c of r.calls) if (B3_TICKER.test(c.ticker)) set.add(c.ticker)
  return [...set].sort()
}

export function getQuotes(): Record<string, Quote> {
  return getPricesFile().quotes
}

export function pricesInfo(): PricesInfo {
  const f = getPricesFile()
  return { updatedAt: f.updatedAt, count: Object.keys(f.quotes).length, missing: f.missing }
}

let running: Promise<PricesInfo> | null = null

/**
 * Atualiza as cotações. Sem `onlyMissing`, busca todos os tickers acompanhados
 * (botão "Atualizar preços"); com `onlyMissing`, só os que ainda não têm preço
 * (usado depois de importar relatórios ou buscar carteiras).
 */
export async function refreshPrices(onlyMissing = false): Promise<PricesInfo> {
  // Uma atualização por vez: espera a que estiver rodando antes de começar outra.
  if (running) {
    await running.catch(() => {})
    if (onlyMissing) return pricesInfo()
  }
  const current = doRefresh(onlyMissing).finally(() => {
    if (running === current) running = null
  })
  running = current
  return current
}

async function doRefresh(onlyMissing: boolean): Promise<PricesInfo> {
  const file = getPricesFile()
  const tickers = trackedTickers().filter((t) => !onlyMissing || !file.quotes[t])
  if (tickers.length === 0) return pricesInfo()

  const found = new Set<string>()
  const fetchedAt = new Date().toISOString()
  for (let i = 0; i < tickers.length; i += BATCH) {
    const symbols = tickers.slice(i, i + BATCH).map((t) => `${t}.SA`)
    let results
    try {
      results = await yf.quote(symbols)
    } catch (err) {
      throw new Error(`Não foi possível consultar o Yahoo Finance: ${err instanceof Error ? err.message : err}`)
    }
    for (const q of results) {
      const ticker = q.symbol.replace(/\.SA$/, '')
      if (typeof q.regularMarketPrice !== 'number') continue
      found.add(ticker)
      file.quotes[ticker] = {
        price: q.regularMarketPrice,
        currency: q.currency ?? 'BRL',
        changePercent: typeof q.regularMarketChangePercent === 'number' ? q.regularMarketChangePercent / 100 : null,
        time: q.regularMarketTime ? new Date(q.regularMarketTime).toISOString() : null,
        name: q.longName ?? q.shortName ?? null,
        analystTarget: file.quotes[ticker]?.analystTarget ?? null,
        fetchedAt
      }
    }
  }

  // Preço-alvo dos analistas: uma consulta por ação, algumas em paralelo.
  const withQuote = [...found]
  const targets = await mapLimit(withQuote, TARGET_CONCURRENCY, analystTarget)
  withQuote.forEach((t, i) => {
    if (targets[i]) file.quotes[t].analystTarget = targets[i]
  })

  const missing = tickers.filter((t) => !found.has(t))
  savePricesFile({
    quotes: file.quotes,
    updatedAt: onlyMissing ? file.updatedAt : fetchedAt,
    missing: onlyMissing ? [...new Set([...file.missing.filter((t) => !found.has(t)), ...missing])] : missing
  })
  return pricesInfo()
}

/** Busca, em segundo plano, cotações de tickers novos (não trava quem chamou). */
export function refreshMissingInBackground(): void {
  refreshPrices(true).catch((err) => console.error('Cotações:', err instanceof Error ? err.message : err))
}
