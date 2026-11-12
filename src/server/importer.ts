import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalInstitution } from '@shared/institutions'
import type { ImportResult, Report } from '@shared/types'
import { activeProvider } from './ai'
import { today, type ExtractedReport } from './extract/common'
import { extractHeuristic } from './extract/heuristic'
import { pdfToText } from './pdf'
import { getReports, PDF_DIR, saveReport } from './store'

export class ImportError extends Error {}

const isPdf = (data: Buffer) => data.subarray(0, 5).toString('latin1') === '%PDF-'

/**
 * Lê um PDF enviado pelo navegador, extrai as recomendações e salva.
 * Uma cópia do arquivo fica em data/pdfs/ para "Abrir" e "Reprocessar".
 */
export async function importPdf(fileName: string, data: Buffer, force = false): Promise<ImportResult> {
  if (!isPdf(data)) throw new ImportError('O arquivo não é um PDF válido.')
  const id = createHash('sha256').update(data).digest('hex')
  const existing = getReports().find((r) => r.id === id)
  if (existing && !force) return { status: 'duplicado' }

  const filePath = join(PDF_DIR, `${id}.pdf`)
  await writeFile(filePath, data)

  // pdf.js pode ser lento em PDFs grandes; só extraímos o texto quando precisarmos dele.
  let textCache: Promise<string> | null = null
  const getText = () => (textCache ??= pdfToText(data).then((r) => r.text))

  const provider = await activeProvider()
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
    fileName: existing?.fileName ?? fileName,
    filePath,
    institution: canonicalInstitution(extracted.institution) || 'Desconhecida',
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
  return { status: 'ok', report }
}
