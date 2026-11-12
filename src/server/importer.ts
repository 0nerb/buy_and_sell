import { createHash } from 'node:crypto'
import { canonicalInstitution } from '@shared/institutions'
import type { ImportResult, Report } from '@shared/types'
import { activeProvider } from './ai'
import { today, type ExtractedReport } from './extract/common'
import { extractHeuristic } from './extract/heuristic'
import { pdfToText } from './pdf'
import { getReports, saveReport } from './store'

export class ImportError extends Error {}

const isPdf = (data: Buffer) => data.subarray(0, 5).toString('latin1') === '%PDF-'

/**
 * Lê um PDF enviado pelo navegador, extrai as informações e salva SÓ elas:
 * instituição, data, resumo, pontos principais, recomendações e o link do
 * relatório. O arquivo em si não é guardado — fica só em memória durante a leitura.
 *
 * Com `force`, relê um PDF já importado (substitui o que foi extraído antes,
 * preservando o que a pessoa editou: instituição, data e link).
 */
export async function importPdf(fileName: string, data: Buffer, force = false): Promise<ImportResult> {
  if (!isPdf(data)) throw new ImportError('O arquivo não é um PDF válido.')
  const id = createHash('sha256').update(data).digest('hex')
  const existing = getReports().find((r) => r.id === id)
  if (existing && !force) return { status: 'duplicado' }

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
    institution: canonicalInstitution(extracted.institution) || 'Desconhecida',
    reportDate: extracted.reportDate || today(),
    title: extracted.title,
    summary: extracted.summary,
    keyPoints: extracted.keyPoints,
    importedAt: new Date().toISOString(),
    method,
    provider: provider?.id,
    source: 'pdf',
    sourceUrl: extracted.sourceUrl,
    calls: extracted.calls
  }
  // Releitura: mantém as correções feitas à mão.
  if (existing && force) {
    report.institution = existing.institution
    report.reportDate = existing.reportDate
    report.sourceUrl = existing.sourceUrl || report.sourceUrl
  }
  saveReport(report)
  return { status: 'ok', report }
}
