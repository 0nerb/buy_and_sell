import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Pasta de dados temporária e provedor sem chave: o teste usa a heurística, sem chamar IA.
const dataDir = mkdtempSync(join(tmpdir(), 'recomendacao-teste-'))
process.env.RECOMENDACAO_DATA_DIR = dataDir
delete process.env.ANTHROPIC_API_KEY
writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ provider: 'anthropic' }))

const pdf = readFileSync(join(__dirname, 'fixtures/exemplo-btg.pdf'))

describe('importação de PDF', () => {
  it('salva só as informações extraídas, sem guardar o arquivo', async () => {
    const { importPdf } = await import('../src/server/importer')
    const result = await importPdf('exemplo-btg.pdf', pdf)
    expect(result.status).toBe('ok')

    const files = readdirSync(dataDir, { recursive: true }).map(String)
    expect(files.filter((f) => !f.endsWith('.json'))).toEqual([])
    expect(files.some((f) => f.endsWith('.pdf'))).toBe(false)

    const [saved] = JSON.parse(readFileSync(join(dataDir, 'reports.json'), 'utf8'))
    expect(saved.fileName).toBe('exemplo-btg.pdf')
    expect(saved).not.toHaveProperty('filePath')
    expect(saved.calls.map((c: { ticker: string }) => c.ticker).sort()).toEqual(['BBAS3', 'BBDC4', 'ITUB4'])
  })

  it('ao reler, mantém instituição, data e link corrigidos à mão', async () => {
    const { importPdf } = await import('../src/server/importer')
    const { getReports, saveReport } = await import('../src/server/store')
    const [r] = getReports()
    saveReport({ ...r, institution: 'Banco X', reportDate: '2026-11-01', sourceUrl: 'https://exemplo.com/relatorio' })

    await importPdf('exemplo-btg.pdf', pdf, true)
    const [again] = getReports()
    expect(again.institution).toBe('Banco X')
    expect(again.reportDate).toBe('2026-11-01')
    expect(again.sourceUrl).toBe('https://exemplo.com/relatorio')
  })
})
