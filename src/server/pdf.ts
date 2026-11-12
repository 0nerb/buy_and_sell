/** Extrai o texto de todas as páginas de um PDF (usado pela heurística e como fallback). */
export async function pdfToText(data: Buffer): Promise<{ text: string; pages: number }> {
  // unpdf é ESM puro; o main é CJS, então carregamos com import() dinâmico.
  const { extractText, getDocumentProxy } = await import('unpdf')
  // pdf.js transfere o buffer para um worker; passamos uma cópia para não invalidar `data`.
  const pdf = await getDocumentProxy(new Uint8Array(data))
  const { text, totalPages } = await extractText(pdf, { mergePages: true })
  return { text, pages: totalPages }
}
