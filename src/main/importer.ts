import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ImportProgress, ImportResult, Report } from '@shared/types'
import { activeProvider } from './ai'
import { today, type ExtractedReport } from './extract/common'
import { extractHeuristic } from './extract/heuristic'
import { pdfToText } from './pdf'
import { getReports, saveReport } from './store'

async function processFile(filePath: string, force: boolean): Promise<Report | 'duplicado'> {
  const data = await readFile(filePath)
  const id = createHash('sha256').update(data).digest('hex')
  if (!force && getReports().some((r) => r.id === id)) return 'duplicado'

  // pdf.js pode ser lento em PDFs grandes; só extraímos o texto quando precisarmos dele.
  let textCache: Promise<string> | null = null
  const getText = () => (textCache ??= pdfToText(data).then((r) => r.text))

  const provider = activeProvider()
  let extracted: ExtractedReport
  let method: Report['method']
  if (provider) {
    extracted = await provider.extractReport(data, getText)
    method = 'ia'
    // A IA às vezes não acha a data; a heurística costuma achar no cabeçalho.
    if (!extracted.reportDate) extracted.reportDate = extractHeuristic(await getText()).reportDate
  } else {
    extracted = extractHeuristic(await getText())
    method = 'heuristica'
  }

  const report: Report = {
    id,
    fileName: basename(filePath),
    filePath,
    institution: extracted.institution || 'Desconhecida',
    reportDate: extracted.reportDate || today(),
    title: extracted.title,
    summary: extracted.summary,
    importedAt: new Date().toISOString(),
    method,
    provider: provider?.id,
    source: 'pdf',
    calls: extracted.calls
  }
  saveReport(report)
  return report
}

export async function importFiles(
  paths: string[],
  onProgress: (p: ImportProgress) => void,
  force = false
): Promise<ImportResult> {
  const result: ImportResult = { imported: [], errors: [] }
  for (const filePath of paths) {
    const fileName = basename(filePath)
    if (!/\.pdf$/i.test(fileName)) {
      result.errors.push({ fileName, message: 'Apenas arquivos PDF são suportados.' })
      onProgress({ filePath, fileName, status: 'erro', message: 'Não é PDF' })
      continue
    }
    onProgress({ filePath, fileName, status: 'processando' })
    try {
      const r = await processFile(filePath, force)
      if (r === 'duplicado') {
        onProgress({ filePath, fileName, status: 'duplicado', message: 'Já importado' })
      } else {
        result.imported.push(r)
        onProgress({ filePath, fileName, status: 'ok', message: `${r.calls.length} recomendação(ões)` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push({ fileName, message })
      onProgress({ filePath, fileName, status: 'erro', message })
    }
  }
  return result
}
