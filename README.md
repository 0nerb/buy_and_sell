# Recomendação

App web local que lê relatórios de research de bancos e corretoras — BTG Pactual, XP, Itaú BBA, Bradesco BBI, Safra etc. — e consolida tudo em uma lista de ações para **comprar**, **manter** ou **vender**.

> Ferramenta pessoal de organização. Não é recomendação de investimento.

## Como funciona

O app tem duas formas de coletar recomendações, e as duas alimentam o mesmo consenso.

### 1. Busca automática de carteiras recomendadas (aba *Carteira consolidada*)

Um clique em **Buscar carteiras** faz a IA pesquisar na web as carteiras recomendadas do mês das instituições acompanhadas (XP, BTG, Itaú BBA, Bradesco BBI, Santander, Safra, Genial, BB Investimentos, Ágora e Inter por padrão — editável nas Configurações). Ela procura nos sites oficiais e nas compilações mensais da imprensa (InfoMoney, Money Times etc.).

Cada carteira é **gravada no banco assim que a IA termina de lê-la** ([src/server/search.ts](src/server/search.ts)): depois de ler cada página, o modelo escreve um bloco `<carteira>{...}</carteira>` (instituição, carteira, mês, ativos, pesos, URL), que é validado e salvo enquanto a pesquisa continua. A tela atualiza a cada carteira salva e, se a busca cair no meio, o que já foi lido fica guardado. A busca roda no servidor: dá para trocar de aba ou recarregar a página sem interrompê-la.

Cada carteira vira um "relatório" do tipo *Web*. Se a URL citada não apareceu nos resultados reais da busca, o relatório ganha um ⚠ para você conferir.

A **carteira consolidada** mostra as N ações (10 por padrão) com mais instituições recomendando compra, com peso proporcional ao número de indicações, e destaca o que entrou e saiu em relação a 30 dias atrás.

### 2. Importação de PDFs (aba *Relatórios*)

Para relatórios da área logada dos bancos: arraste os PDFs para a janela. O app guarda só as recomendações extraídas; o mesmo arquivo não é importado duas vezes.
- **Com chave de API:** o PDF inteiro vai para a IA, que devolve ticker, rating, preço-alvo, tese, instituição e data.
- **Sem chave:** uma heurística local procura tickers da B3 e o rating mais próximo. Serve para relatórios simples, mas erra com facilidade.

### Provedores de IA

| Provedor | Precisa de | Custo |
|---|---|---|
| **Claude — assinatura Pro/Max** (padrão) | [Claude Code](https://claude.com/claude-code) instalado e logado neste computador | Entra na cota da sua assinatura |
| Claude — chave de API | Chave em [console.anthropic.com](https://console.anthropic.com/settings/keys) ou `ANTHROPIC_API_KEY` | Por uso |
| Gemini — chave de API | Chave em [aistudio.google.com](https://aistudio.google.com/apikey) ou `GEMINI_API_KEY` | Por uso |

**Como funciona o modo assinatura** ([src/server/ai/claudeCode.ts](src/server/ai/claudeCode.ts)): o app não usa chave nem guarda nenhum token. Ele executa o Claude Code em modo não interativo (`claude -p`), e o Claude Code usa o login que você já fez nele (`claude` → `/login`). Cada execução roda numa pasta temporária vazia, só com as ferramentas necessárias (`Read` para o PDF, `WebSearch`/`WebFetch` para a busca), sem MCP, hooks ou configurações pessoais. O app encontra o executável no PATH ou dentro da extensão do VS Code/Cursor, e dá para informar o caminho manualmente nas Configurações. A tela mostra quanto da janela de 5 horas e da cota semanal a última busca usou.

Isso é para **uso pessoal**, no computador de quem tem a assinatura. Se o app um dia for usado por outras pessoas, cada uma precisa usar a própria chave de API: a assinatura é individual.

Para adicionar outro provedor, basta implementar a interface `AIProvider` de [src/server/ai/shared.ts](src/server/ai/shared.ts).

### Cotações e preço-alvo ([src/server/prices.ts](src/server/prices.ts))

O botão **↻ Atualizar preços** (abas Carteira e Recomendações) busca no **Yahoo Finance** — a mesma fonte do `yfinance` do Python, aqui pelo pacote [`yahoo-finance2`](https://github.com/gadicc/yahoo-finance2), para não exigir Python instalado — a cotação atual de todas as ações (sufixo `.SA`; costuma ter ~15 min de atraso) e o consenso de preço-alvo dos analistas. Ações novas, vindas de PDFs ou da busca, ganham cotação automaticamente. As cotações ficam em `data/prices.json`.

- **Preço-alvo médio:** média dos preços-alvo dos relatórios e carteiras coletados; se nenhum informar, o consenso de analistas do Yahoo Finance (indicado na tabela com o número de analistas).
- **Potencial:** preço-alvo médio ÷ cotação atual − 1. Sem cotação, usa o preço citado no relatório (marcado com `*`).

### Consenso ([src/shared/consensus.ts](src/shared/consensus.ts))

- Para cada par (banco, ticker), vale só a recomendação **mais recente**.
- De cada carteira recomendada vale só a versão mais recente — quem saiu da carteira deixa de contar.
- Relatórios com mais de 120 dias são ignorados; cada recomendação pesa `0,5^(idade/45 dias)`.
- Score = média ponderada (compra = +1, neutro = 0, venda = −1). ≥ 0,4 → **Comprar**; ≤ −0,4 → **Vender**; senão **Manter**.

## Como rodar

Requer [Node.js](https://nodejs.org) 22 ou mais novo (Mac, Windows ou Linux).

```bash
npm install
npm start          # gera a interface e abre o servidor em http://localhost:3000
```

Depois é só abrir **http://localhost:3000** no navegador. O servidor escuta apenas em `127.0.0.1`: ninguém na sua rede consegue acessar.

Se você tem Claude Pro/Max e o Claude Code instalado e logado, não precisa configurar mais nada. As chaves de API (opcionais) podem ser coladas em **Configurações** (ficam em `data/secrets.json`, legível só pelo seu usuário) ou definidas num arquivo `.env` na raiz do projeto:

```bash
ANTHROPIC_API_KEY=sk-ant-...
GEMINI_API_KEY=AIza...
# PORT=3000                       # porta do servidor
# RECOMENDACAO_DATA_DIR=./data    # onde ficam relatórios, PDFs e configurações
```

### Desenvolvimento

```bash
npm run dev        # servidor com reload + interface com hot reload em http://localhost:5173
npm test           # testes (vitest)
npm run typecheck
```

O GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) roda typecheck, testes e build a cada push.

## Estrutura

```
src/
  server/          servidor local (Node + Hono)
    index.ts       rotas HTTP /api + interface compilada
    importer.ts    pipeline de importação de um PDF
    pdf.ts         extração de texto (unpdf / pdf.js)
    search.ts      busca mensal de carteiras recomendadas
    store.ts       persistência em JSON + chaves de API criptografadas
    ai/
      shared.ts    interface AIProvider, prompts e schemas
      claudeCode.ts provedor Claude por assinatura (via Claude Code)
      anthropic.ts  provedor Claude por chave de API
      gemini.ts     provedor Gemini
    extract/
      heuristic.ts extração offline por regex
  web/             interface React (Vite)
    src/api.ts     cliente HTTP da API local
  shared/          tipos, ratings, consenso e carteira consolidada
tests/             testes (vitest) + PDF de exemplo
```

Os dados ficam na pasta `data/` (fora do git): `reports.json`, `settings.json`, `secrets.json` e as cópias dos PDFs importados em `data/pdfs/`. Para fazer backup, basta copiar essa pasta.

## Ideias para as próximas versões

- Cotação atual (ex.: brapi.dev) para calcular o potencial real em vez do preço citado no relatório
- Busca automática agendada (ex.: todo dia 5)
- Pasta monitorada: novos PDFs salvos nela são importados sozinhos
- Histórico de mudanças de rating por ação (upgrade/downgrade)
- Cruzar com a sua carteira atual e destacar o que vender
- Exportar a lista para CSV/Excel
- Hospedar num servidor (com login) para acessar de qualquer lugar
