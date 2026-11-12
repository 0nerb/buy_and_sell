import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { extractHeuristic } from '../src/server/extract/heuristic'
import { pdfToText } from '../src/server/pdf'

it('lê um PDF real e extrai as recomendações pela heurística', async () => {
  const pdf = readFileSync(join(__dirname, 'fixtures/exemplo-btg.pdf'))
  const { text, pages } = await pdfToText(pdf)
  expect(pages).toBe(1)
  const r = extractHeuristic(text)
  expect(r.institution).toBe('BTG Pactual')
  expect(r.reportDate).toBe('2026-11-10')
  expect(r.calls.map((c) => `${c.ticker}:${c.rating}:${c.targetPrice}`).sort()).toEqual([
    'BBAS3:neutro:30.5',
    'BBDC4:venda:12',
    'ITUB4:compra:45'
  ])
})
