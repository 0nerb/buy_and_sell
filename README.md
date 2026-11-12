# Recomendação

App desktop (macOS e Windows) que lê relatórios de research de bancos e corretoras — BTG Pactual, XP, Itaú BBA, Bradesco BBI, Safra etc. — e consolida tudo em uma lista de ações para **comprar**, **manter** ou **vender**.

> Ferramenta pessoal de organização. Não é recomendação de investimento.

## Como funciona

O app tem duas formas de coletar recomendações, e as duas alimentam o mesmo consenso.

### 1. Busca automática de carteiras recomendadas (aba *Carteira consolidada*)

Um clique em **Buscar carteiras** faz a IA pesquisar na web as carteiras recomendadas do mês das instituições acompanhadas (XP, BTG, Itaú BBA, Bradesco BBI, Santander, Safra, Genial, BB Investimentos, Ágora e Inter por padrão — editável nas Configurações). Ela procura nos sites oficiais e nas compilações mensais da imprensa (InfoMoney, Money Times etc.).

Funciona em duas etapas, iguais para qualquer provedor ([src/main/search.ts](src/main/search.ts)):
1. **Pesquisa:** o modelo usa a busca na web (Claude: `web_search`/`web_fetch`; Gemini: Google Search + URL context) e escreve anotações com as carteiras e as URLs.
2. **Estruturação:** as anotações viram um JSON validado (instituição, carteira, mês, ativos, pesos, URL).

Cada carteira vira um "relatório" do tipo *Web*. Se a URL citada não apareceu nos resultados reais da busca, o relatório ganha um ⚠ para você conferir.

A **carteira consolidada** mostra as N ações (10 por padrão) com mais instituições recomendando compra, com peso proporcional ao número de indicações, e destaca o que entrou e saiu em relação a 30 dias atrás.

### 2. Importação de PDFs (aba *Relatórios*)

Para relatórios da área logada dos bancos: arraste os PDFs para a janela. O app guarda só as recomendações extraídas; o mesmo arquivo não é importado duas vezes.
- **Com chave de API:** o PDF inteiro vai para a IA, que devolve ticker, rating, preço-alvo, tese, instituição e data.
- **Sem chave:** uma heurística local procura tickers da B3 e o rating mais próximo. Serve para relatórios simples, mas erra com facilidade.

### Provedores de IA

| Provedor | Onde criar a chave | Variável de ambiente |
|---|---|---|
| Claude (Anthropic) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | `ANTHROPIC_API_KEY` |
| Gemini (Google) | [aistudio.google.com](https://aistudio.google.com/apikey) | `GEMINI_API_KEY` |

As duas chaves podem ficar cadastradas e você alterna o provedor nas Configurações. A lista de modelos é carregada da própria API. Para adicionar outro provedor, basta implementar a interface `AIProvider` de [src/main/ai/shared.ts](src/main/ai/shared.ts).

### Consenso ([src/shared/consensus.ts](src/shared/consensus.ts))

- Para cada par (banco, ticker), vale só a recomendação **mais recente**.
- De cada carteira recomendada vale só a versão mais recente — quem saiu da carteira deixa de contar.
- Relatórios com mais de 120 dias são ignorados; cada recomendação pesa `0,5^(idade/45 dias)`.
- Score = média ponderada (compra = +1, neutro = 0, venda = −1). ≥ 0,4 → **Comprar**; ≤ −0,4 → **Vender**; senão **Manter**.

## Desenvolvimento

Requer Node.js 22+ (testado com 24).

```bash
npm install
npm run dev        # abre o app com hot reload
npm test           # testes unitários (vitest)
npm run typecheck
```

As chaves de API são coladas em **Configurações** (ficam criptografadas pelo Keychain no macOS ou pela DPAPI no Windows) ou vêm das variáveis de ambiente da tabela acima.

**No WSL/Linux**, o Electron precisa de algumas bibliotecas do sistema:

```bash
sudo apt install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libgbm1 libasound2t64
```

## Gerando os instaladores

```bash
npm run dist:mac   # .dmg (arm64 e x64) — precisa rodar em um Mac
npm run dist:win   # instalador .exe (NSIS) — mais fácil rodar no Windows
```

Os arquivos saem em `dist/`. O workflow [.github/workflows/build.yml](.github/workflows/build.yml) gera os dois automaticamente no GitHub Actions a cada push na `main` (baixe em *Actions → execução → Artifacts*).

O app ainda **não é assinado**. No macOS, abra pela primeira vez com botão direito → *Abrir*. No Windows, o SmartScreen vai avisar; clique em *Mais informações → Executar assim mesmo*.

## Estrutura

```
src/
  main/            processo principal do Electron (Node)
    index.ts       janela + handlers IPC
    importer.ts    pipeline de importação de um PDF
    pdf.ts         extração de texto (unpdf / pdf.js)
    search.ts      busca mensal de carteiras recomendadas
    store.ts       persistência em JSON + chaves de API criptografadas
    ai/
      shared.ts    interface AIProvider, prompts e schemas
      anthropic.ts provedor Claude
      gemini.ts    provedor Gemini
    extract/
      heuristic.ts extração offline por regex
  preload/         ponte segura main ↔ interface (window.api)
  renderer/        interface React
  shared/          tipos, ratings, consenso e carteira consolidada
tests/             testes (vitest) + PDF de exemplo
```

Os dados ficam em `reports.json`, `settings.json` e `secrets.json` dentro da pasta de dados do app (`~/Library/Application Support/Recomendação` no macOS, `%APPDATA%\Recomendação` no Windows).

## Ideias para as próximas versões

- Cotação atual (ex.: brapi.dev) para calcular o potencial real em vez do preço citado no relatório
- Busca automática agendada (ex.: todo dia 5)
- Pasta monitorada: novos PDFs salvos nela são importados sozinhos
- Histórico de mudanças de rating por ação (upgrade/downgrade)
- Cruzar com a sua carteira atual e destacar o que vender
- Exportar a lista para CSV/Excel
- Assinatura de código (Apple Developer ID / certificado Windows) e atualização automática
