import { describe, expect, it } from 'vitest'
import { PortfolioStreamParser, type FoundPortfolio } from '../src/server/ai/shared'

const bloco = (institution: string, tickers: string[]) =>
  `<carteira>${JSON.stringify({
    institution, portfolioName: 'Top 10', referenceMonth: '2026-11', publishedDate: null,
    sourceUrl: `https://exemplo.com/${institution}`,
    assets: tickers.map((ticker) => ({ ticker, company: null, weight: null }))
  })}</carteira>`

describe('PortfolioStreamParser', () => {
  it('entrega cada carteira assim que o bloco fecha, mesmo com o texto picotado', () => {
    const texto =
      `Li a página da XP.\n${bloco('XP', ['PETR4', 'VALE3'])}\nAgora a do BTG...\n${bloco('BTG Pactual', ['ITUB4'])}\n` +
      `<nao_encontradas>["Safra"]</nao_encontradas>`
    const recebidas: string[] = []
    const parser = new PortfolioStreamParser((p: FoundPortfolio) => recebidas.push(p.institution))

    // Manda de 7 em 7 caracteres e confere que a XP chega antes do texto do BTG terminar.
    const fimXP = texto.indexOf('</carteira>') + '</carteira>'.length
    for (let i = 0; i < texto.length; i += 7) {
      parser.push(texto.slice(i, i + 7))
      if (i + 7 >= fimXP && i + 7 < texto.lastIndexOf('</carteira>')) expect(recebidas).toEqual(['XP'])
    }
    expect(recebidas).toEqual(['XP', 'BTG Pactual'])
    expect(parser.notFound).toEqual(['Safra'])
  })

  it('ignora bloco com JSON inválido e continua com os próximos', () => {
    const recebidas: string[] = []
    const parser = new PortfolioStreamParser((p) => recebidas.push(p.institution))
    parser.push(`<carteira>{"institution": "XP", quebrado</carteira>${bloco('Safra', ['TAEE11'])}`)
    expect(recebidas).toEqual(['Safra'])
    expect(parser.invalid).toBe(1)
  })
})
