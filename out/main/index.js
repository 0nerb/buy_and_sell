// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
let electron = require("electron");
let node_fs = require("node:fs");
let node_path = require("node:path");
let _anthropic_ai_sdk = require("@anthropic-ai/sdk");
_anthropic_ai_sdk = __toESM(_anthropic_ai_sdk);
let zod = require("zod");
let _google_genai = require("@google/genai");
let node_crypto = require("node:crypto");
let node_fs_promises = require("node:fs/promises");
// src/shared/ratings.ts
/**
* Vocabulário de ratings usado por bancos e corretoras (PT e EN).
* A ordem importa: expressões mais longas primeiro, para "market perform"
* não ser lido como "perform" etc.
*/
var RATING_TERMS = [
	[/\b(strong\s+buy|compra\s+forte)\b/i, "compra"],
	[/\b(market\s*perform|sector\s*perform|equal[-\s]?weight|in[-\s]?line|peer\s*perform)\b/i, "neutro"],
	[/\b(em\s+linha(\s+com\s+o\s+mercado)?|neutr[oa]|neutral|manter|manuten[çc][ãa]o|hold)\b/i, "neutro"],
	[/\b(outperform|overweight|sobreponderar|sobreponderado|acima\s+d[oa]\s+(m[ée]dia|mercado))\b/i, "compra"],
	[/\b(underperform|underweight|subponderar|subponderado|abaixo\s+d[oa]\s+(m[ée]dia|mercado))\b/i, "venda"],
	[/\b(compra|comprar|buy|accumulate|acumular)\b/i, "compra"],
	[/\b(venda|vender|sell|reduzir|reduce)\b(?!s)/i, "venda"]
];
/**
* Encontra o termo de rating mais próximo de `pos` dentro de `text`.
* Usado pela heurística: num parágrafo com vários tickers, o rating
* relevante é o que está mais perto do código.
*/
function nearestRating(text, pos) {
	let best = null;
	for (const [re, rating] of RATING_TERMS) for (const m of text.matchAll(new RegExp(re.source, "gi"))) {
		const start = m.index;
		const end = start + m[0].length;
		const distance = pos < start ? start - pos : pos > end ? pos - end : 0;
		if (!best || distance < best.distance) best = {
			rating,
			term: m[0],
			distance
		};
	}
	return best;
}
function ratingValue(r) {
	return r === "compra" ? 1 : r === "venda" ? -1 : 0;
}
// src/shared/consensus.ts
var DAY_MS$1 = 864e5;
function ageInDays(isoDate, now) {
	const t = Date.parse(isoDate);
	if (Number.isNaN(t)) return 0;
	return Math.max(0, (now.getTime() - t) / DAY_MS$1);
}
function mean(values) {
	if (values.length === 0) return null;
	return values.reduce((a, b) => a + b, 0) / values.length;
}
/**
* Relatórios que valem na data `now`:
*  - descarta os publicados depois de `now` (permite calcular "como estava há 30 dias");
*  - para carteiras recomendadas, mantém só a versão mais recente de cada
*    (instituição, carteira) — quem saiu da carteira deixa de ser recomendado.
*/
function activeReports(reports, now) {
	const cutoff = now.toISOString().slice(0, 10);
	const latestPortfolio = /* @__PURE__ */ new Map();
	const result = [];
	for (const r of reports) {
		if (r.reportDate > cutoff) continue;
		if (!r.portfolioName) {
			result.push(r);
			continue;
		}
		const key = `${r.institution.trim().toLowerCase()}|${r.portfolioName.trim().toLowerCase()}`;
		const cur = latestPortfolio.get(key);
		if (!cur || r.reportDate > cur.reportDate) latestPortfolio.set(key, r);
	}
	return [...result, ...latestPortfolio.values()];
}
/**
* Consolida as recomendações de todos os relatórios em uma lista por ticker.
*
* Regras:
*  - Para cada par (instituição, ticker) vale só a recomendação mais recente —
*    um banco que mudou de "compra" para "neutro" não conta duas vezes.
*  - Recomendações mais antigas que `maxAgeDays` são descartadas.
*  - Cada recomendação pesa 0.5^(idade / halfLifeDays).
*  - score = média ponderada (compra = +1, neutro = 0, venda = -1).
*/
function buildConsensus(reports, settings, now = /* @__PURE__ */ new Date()) {
	const latest = /* @__PURE__ */ new Map();
	for (const report of activeReports(reports, now)) {
		const age = ageInDays(report.reportDate, now);
		if (age > settings.maxAgeDays) continue;
		const weight = Math.pow(.5, age / settings.halfLifeDays);
		const institution = report.institution.trim() || "Desconhecida";
		const instKey = institution.toLowerCase();
		for (const call of report.calls) {
			const ticker = call.ticker.toUpperCase().trim();
			if (!ticker) continue;
			let byInst = latest.get(ticker);
			if (!byInst) latest.set(ticker, byInst = /* @__PURE__ */ new Map());
			const current = byInst.get(instKey);
			if (current && (current.reportDate > report.reportDate || current.reportDate === report.reportDate && ratingValue(current.rating) >= ratingValue(call.rating))) continue;
			byInst.set(instKey, {
				reportId: report.id,
				institution,
				reportDate: report.reportDate,
				rating: call.rating,
				originalRating: call.originalRating,
				targetPrice: call.currency === "BRL" ? call.targetPrice : null,
				priceAtReport: call.currency === "BRL" ? call.priceAtReport : null,
				thesis: call.thesis,
				weight,
				company: call.company
			});
		}
	}
	const result = [];
	for (const [ticker, byInst] of latest) {
		const sources = [...byInst.values()].sort((a, b) => b.reportDate.localeCompare(a.reportDate));
		const totalWeight = sources.reduce((s, x) => s + x.weight, 0);
		const score = totalWeight > 0 ? sources.reduce((s, x) => s + x.weight * ratingValue(x.rating), 0) / totalWeight : 0;
		const action = score >= settings.actionThreshold ? "comprar" : score <= -settings.actionThreshold ? "vender" : "manter";
		const avgTargetPrice = mean(sources.flatMap((s) => s.targetPrice ? [s.targetPrice] : []));
		const referencePrice = sources.find((s) => s.priceAtReport)?.priceAtReport ?? null;
		const upside = avgTargetPrice && referencePrice ? avgTargetPrice / referencePrice - 1 : null;
		result.push({
			ticker,
			company: sources.find((s) => s.company)?.company ?? null,
			action,
			score,
			buyCount: sources.filter((s) => s.rating === "compra").length,
			neutralCount: sources.filter((s) => s.rating === "neutro").length,
			sellCount: sources.filter((s) => s.rating === "venda").length,
			avgTargetPrice,
			referencePrice,
			upside,
			lastUpdate: sources[0].reportDate,
			sources: sources.map(({ company: _c, ...s }) => s)
		});
	}
	return result.sort((a, b) => Math.abs(b.score) * b.sources.length - Math.abs(a.score) * a.sources.length || (b.upside ?? -Infinity) - (a.upside ?? -Infinity));
}
// src/shared/portfolio.ts
var DAY_MS = 864e5;
/** Ações com mais instituições recomendando compra; desempate por score e potencial. */
function rank(consensus, size) {
	return consensus.filter((c) => c.buyCount > 0).sort((a, b) => b.buyCount - a.buyCount || b.score - a.score || (b.upside ?? -Infinity) - (a.upside ?? -Infinity) || a.ticker.localeCompare(b.ticker)).slice(0, size);
}
/**
* Carteira consolidada: as `portfolioSize` ações que mais aparecem como
* compra entre as instituições, com peso proporcional ao nº de indicações.
* Compara com a carteira que o app teria montado 30 dias atrás.
*/
function buildConsolidated(reports, settings, now = /* @__PURE__ */ new Date()) {
	const current = rank(buildConsensus(reports, settings, now), settings.portfolioSize);
	const previous = rank(buildConsensus(reports, settings, /* @__PURE__ */ new Date(now.getTime() - 30 * DAY_MS)), settings.portfolioSize);
	const previousSet = new Set(previous.map((c) => c.ticker));
	const currentSet = new Set(current.map((c) => c.ticker));
	const minDate = (/* @__PURE__ */ new Date(now.getTime() - settings.maxAgeDays * DAY_MS)).toISOString().slice(0, 10);
	const institutions = new Set(activeReports(reports, now).filter((r) => r.reportDate >= minDate).map((r) => r.institution.trim().toLowerCase()));
	const totalVotes = current.reduce((s, c) => s + c.buyCount, 0);
	return {
		institutionsTracked: institutions.size,
		entries: current.map((c) => ({
			ticker: c.ticker,
			company: c.company,
			institutions: c.sources.filter((s) => s.rating === "compra").map((s) => s.institution),
			weight: totalVotes ? c.buyCount / totalVotes : 0,
			score: c.score,
			avgTargetPrice: c.avgTargetPrice,
			upside: c.upside,
			status: previous.length === 0 || previousSet.has(c.ticker) ? "mantido" : "novo"
		})),
		removed: previous.filter((c) => !currentSet.has(c.ticker)).map((c) => ({
			ticker: c.ticker,
			company: c.company
		}))
	};
}
var DEFAULT_SETTINGS = {
	provider: "anthropic",
	anthropicModel: "claude-opus-5-5",
	geminiModel: "gemini-3.8-flash",
	trackedInstitutions: [
		"XP",
		"BTG Pactual",
		"Itaú BBA",
		"Bradesco BBI",
		"Santander",
		"Safra",
		"Genial",
		"BB Investimentos",
		"Ágora",
		"Inter"
	],
	portfolioSize: 10,
	maxAgeDays: 120,
	halfLifeDays: 45,
	actionThreshold: .4
};
// src/main/store.ts
/**
* Persistência simples em JSON dentro da pasta de dados do app
* (macOS: ~/Library/Application Support/Recomendação, Windows: %APPDATA%\Recomendação).
*/
var file = (name) => (0, node_path.join)(electron.app.getPath("userData"), name);
function readJson(name, fallback) {
	try {
		if (!(0, node_fs.existsSync)(file(name))) return fallback;
		return JSON.parse((0, node_fs.readFileSync)(file(name), "utf8"));
	} catch (err) {
		console.error(`Falha ao ler ${name}:`, err);
		return fallback;
	}
}
/** Grava em arquivo temporário e renomeia, para não corromper o JSON se o app fechar no meio. */
function writeJson(name, data) {
	const tmp = file(`${name}.tmp`);
	(0, node_fs.writeFileSync)(tmp, JSON.stringify(data, null, 2), "utf8");
	(0, node_fs.renameSync)(tmp, file(name));
}
var reports = null;
function getReports() {
	reports ??= readJson("reports.json", []);
	return reports;
}
function saveReport(report) {
	const list = getReports().filter((r) => r.id !== report.id);
	list.push(report);
	list.sort((a, b) => b.reportDate.localeCompare(a.reportDate));
	reports = list;
	writeJson("reports.json", list);
}
function deleteReport(id) {
	reports = getReports().filter((r) => r.id !== id);
	writeJson("reports.json", reports);
}
function getSettings() {
	const raw = readJson("settings.json", {});
	if (raw.model && !raw.anthropicModel) raw.anthropicModel = raw.model;
	delete raw.model;
	return {
		...DEFAULT_SETTINGS,
		...raw
	};
}
function saveSettings(patch) {
	const next = {
		...getSettings(),
		...patch
	};
	writeJson("settings.json", next);
	return next;
}
var ENV_VARS = {
	anthropic: ["ANTHROPIC_API_KEY"],
	gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"]
};
/** Chaves digitadas nesta sessão (usadas também quando o SO não tem cofre). */
var sessionKeys = {};
function readSecrets() {
	const s = readJson("secrets.json", {});
	if (s.apiKey && !s.anthropic) s.anthropic = s.apiKey;
	delete s.apiKey;
	return s;
}
function setApiKey(provider, key) {
	const trimmed = key?.trim() || null;
	sessionKeys[provider] = trimmed;
	const secrets = readSecrets();
	if (!trimmed) delete secrets[provider];
	else if (electron.safeStorage.isEncryptionAvailable()) secrets[provider] = electron.safeStorage.encryptString(trimmed).toString("base64");
	writeJson("secrets.json", secrets);
}
function getApiKey(provider) {
	const session = sessionKeys[provider];
	if (session) return {
		key: session,
		source: "salva"
	};
	if (session === void 0) {
		const stored = readSecrets()[provider];
		if (stored && electron.safeStorage.isEncryptionAvailable()) try {
			const key = electron.safeStorage.decryptString(Buffer.from(stored, "base64"));
			sessionKeys[provider] = key;
			return {
				key,
				source: "salva"
			};
		} catch (err) {
			console.error("Não foi possível descriptografar a chave salva:", err);
		}
	}
	for (const name of ENV_VARS[provider]) if (process.env[name]) return {
		key: process.env[name],
		source: "ambiente"
	};
	return {
		key: null,
		source: null
	};
}
function getSettingsView() {
	const settings = getSettings();
	const keys = {
		anthropic: getApiKey("anthropic").source,
		gemini: getApiKey("gemini").source
	};
	return {
		...settings,
		keys,
		aiReady: keys[settings.provider] !== null,
		canPersistKey: electron.safeStorage.isEncryptionAvailable()
	};
}
// src/main/extract/common.ts
/** Ticker da B3: 4 letras + 3/4/5/6/11 (ON, PN, PNA, PNB, units/FIIs/BDRs). */
var B3_TICKER = /\b([A-Z]{4}(?:3|4|5|6|11))\b/g;
function today() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
/** Remove duplicatas mantendo a primeira ocorrência de cada ticker. */
function dedupeCalls(calls) {
	const seen = /* @__PURE__ */ new Set();
	return calls.filter((c) => {
		const key = c.ticker.toUpperCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
// src/main/ai/shared.ts
/**
* Tudo que é igual entre os provedores de IA: prompts, JSON Schemas
* e a validação das respostas. Cada provedor só implementa o transporte.
*/
var AIError = class extends Error {};
var EXTRACTION_PROMPT = `Você é um analista que lê relatórios de research de bancos e corretoras (BTG Pactual, XP, Itaú BBA, Bradesco BBI, Safra, etc.) e extrai as recomendações de investimento em ações de forma estruturada.

Regras:
- Extraia apenas recomendações EXPLÍCITAS do relatório para ativos específicos (ações, units, BDRs). Não invente recomendações para empresas apenas citadas.
- "rating" é a recomendação normalizada:
  • "compra": Compra, Buy, Outperform, Overweight, Acima da Média/Mercado, inclusão ou permanência em carteira recomendada.
  • "neutro": Neutro, Manter, Hold, Market Perform, Equal Weight, Em Linha, ou ativo REMOVIDO de carteira recomendada.
  • "venda": Venda, Sell, Underperform, Underweight, Abaixo da Média/Mercado, Reduzir.
- "originalRating": o texto exato do rating no relatório (ou "Carteira recomendada" quando for o caso).
- "ticker": código na bolsa em maiúsculas (ex.: PETR4, VALE3, ITUB4). Para ativos estrangeiros use o código da bolsa de origem.
- Preços: use números decimais (ex.: 34.5). "currency" é o código ISO (BRL, USD...). Use null se o relatório não informar.
- "priceAtReport": preço/cotação de referência citada no relatório, se houver.
- "thesis": 1 a 2 frases em português com o principal argumento do analista.
- "institution": nome da instituição que publicou o relatório.
- "reportDate": data de publicação no formato YYYY-MM-DD. Se não houver, use null.
- "summary": 2 a 3 frases em português resumindo o relatório.
- Se o relatório não tiver nenhuma recomendação de ações, retorne "calls" vazio.`;
var EXTRACTION_USER_MESSAGE = "Extraia as recomendações deste relatório.";
var nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
var EXTRACTION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: [
		"institution",
		"reportDate",
		"title",
		"summary",
		"calls"
	],
	properties: {
		institution: { type: "string" },
		reportDate: nullable({ type: "string" }),
		title: { type: "string" },
		summary: { type: "string" },
		calls: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"ticker",
					"company",
					"rating",
					"originalRating",
					"targetPrice",
					"priceAtReport",
					"currency",
					"horizon",
					"thesis"
				],
				properties: {
					ticker: { type: "string" },
					company: nullable({ type: "string" }),
					rating: {
						type: "string",
						enum: [
							"compra",
							"neutro",
							"venda"
						]
					},
					originalRating: { type: "string" },
					targetPrice: nullable({ type: "number" }),
					priceAtReport: nullable({ type: "number" }),
					currency: { type: "string" },
					horizon: nullable({ type: "string" }),
					thesis: { type: "string" }
				}
			}
		}
	}
};
var ExtractionSchema = zod.z.object({
	institution: zod.z.string(),
	reportDate: zod.z.string().nullable(),
	title: zod.z.string(),
	summary: zod.z.string(),
	calls: zod.z.array(zod.z.object({
		ticker: zod.z.string(),
		company: zod.z.string().nullable(),
		rating: zod.z.enum([
			"compra",
			"neutro",
			"venda"
		]),
		originalRating: zod.z.string(),
		targetPrice: zod.z.number().nullable(),
		priceAtReport: zod.z.number().nullable(),
		currency: zod.z.string(),
		horizon: zod.z.string().nullable(),
		thesis: zod.z.string()
	}))
});
/** Valida o JSON devolvido por qualquer provedor e normaliza os campos. */
function parseExtraction(raw) {
	let parsed;
	try {
		parsed = ExtractionSchema.parse(JSON.parse(raw));
	} catch {
		throw new AIError("Resposta da IA em formato inesperado.");
	}
	return {
		institution: parsed.institution,
		reportDate: parsed.reportDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.reportDate) ? parsed.reportDate : "",
		title: parsed.title,
		summary: parsed.summary,
		calls: dedupeCalls(parsed.calls.map((c) => ({
			...c,
			ticker: c.ticker.toUpperCase().trim(),
			currency: c.currency.toUpperCase() || "BRL"
		})))
	};
}
var MONTHS$1 = [
	"janeiro",
	"fevereiro",
	"março",
	"abril",
	"maio",
	"junho",
	"julho",
	"agosto",
	"setembro",
	"outubro",
	"novembro",
	"dezembro"
];
function monthLabel(month) {
	const [y, m] = month.split("-").map(Number);
	return `${MONTHS$1[m - 1]} de ${y}`;
}
function researchPrompt(month, institutions) {
	return `Pesquise na web as carteiras recomendadas de AÇÕES BRASILEIRAS (B3) de ${monthLabel(month)} publicadas pelas seguintes instituições:
${institutions.map((i) => `- ${i}`).join("\n")}

Como pesquisar:
- Procure tanto nos sites oficiais das instituições quanto em compilações mensais de imprensa especializada (ex.: InfoMoney, Money Times, Valor Investe, E-Investidor, Exame), que costumam listar as carteiras de várias corretoras de uma vez.
- Considere carteiras de ações em geral (ex.: "Carteira Recomendada", "Top 10", "Carteira Dividendos", "Small Caps"). Ignore carteiras de FIIs, renda fixa, fundos e BDRs.
- Se não encontrar a carteira de ${monthLabel(month)} de alguma instituição, use a mais recente que encontrar e informe a data dela. Se não encontrar nenhuma, diga explicitamente.

Na resposta, para CADA carteira encontrada, informe:
- instituição e nome da carteira;
- mês de referência e data de publicação;
- todos os ativos (ticker, empresa e peso em %, se houver);
- a URL exata da página onde você leu a informação.

Liste apenas o que você leu nas páginas. Nunca complete uma carteira de memória.`;
}
var STRUCTURE_PROMPT = `Você recebe as anotações de uma pesquisa sobre carteiras recomendadas de ações e deve convertê-las em JSON.
Regras:
- Inclua apenas carteiras e ativos que aparecem explicitamente nas anotações. Não acrescente nada.
- "ticker" em maiúsculas no padrão da B3 (ex.: PETR4, ITUB4, TAEE11).
- "weight" é o peso em fração (12,5% -> 0.125); null se não informado.
- "referenceMonth" no formato YYYY-MM; "publishedDate" em YYYY-MM-DD ou null.
- "sourceUrl" deve ser a URL citada nas anotações para aquela carteira; use null se não houver.
- Em "notFound", liste as instituições pedidas para as quais as anotações dizem não ter encontrado carteira.`;
var PORTFOLIOS_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["portfolios", "notFound"],
	properties: {
		portfolios: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: [
					"institution",
					"portfolioName",
					"referenceMonth",
					"publishedDate",
					"sourceUrl",
					"assets"
				],
				properties: {
					institution: { type: "string" },
					portfolioName: { type: "string" },
					referenceMonth: { type: "string" },
					publishedDate: nullable({ type: "string" }),
					sourceUrl: nullable({ type: "string" }),
					assets: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: [
								"ticker",
								"company",
								"weight"
							],
							properties: {
								ticker: { type: "string" },
								company: nullable({ type: "string" }),
								weight: nullable({ type: "number" })
							}
						}
					}
				}
			}
		},
		notFound: {
			type: "array",
			items: { type: "string" }
		}
	}
};
var PortfoliosSchema = zod.z.object({
	portfolios: zod.z.array(zod.z.object({
		institution: zod.z.string(),
		portfolioName: zod.z.string(),
		referenceMonth: zod.z.string(),
		publishedDate: zod.z.string().nullable(),
		sourceUrl: zod.z.string().nullable(),
		assets: zod.z.array(zod.z.object({
			ticker: zod.z.string(),
			company: zod.z.string().nullable(),
			weight: zod.z.number().nullable()
		}))
	})),
	notFound: zod.z.array(zod.z.string())
});
// src/main/ai/anthropic.ts
/** Limite da API é 32 MB por requisição (base64 incha ~33%). */
var MAX_PDF_BYTES$1 = 23068672;
/** Quantas vezes retomamos um turno pausado pelo servidor (pause_turn). */
var MAX_CONTINUATIONS = 6;
/** Se o modelo recusar por política, a API reexecuta em outro modelo automaticamente. */
var FALLBACK = {
	betas: ["server-side-fallback-2026-07-01"],
	fallbacks: "default"
};
function translateError$1(err) {
	if (err instanceof _anthropic_ai_sdk.default.AuthenticationError) throw new AIError("Chave da API da Anthropic inválida.");
	if (err instanceof _anthropic_ai_sdk.default.PermissionDeniedError) throw new AIError("A chave da Anthropic não tem permissão para este modelo.");
	if (err instanceof _anthropic_ai_sdk.default.NotFoundError) throw new AIError("Modelo não encontrado na Anthropic. Escolha outro nas Configurações.");
	if (err instanceof _anthropic_ai_sdk.default.RateLimitError) throw new AIError("Limite de uso da API da Anthropic atingido. Tente novamente em instantes.");
	if (err instanceof _anthropic_ai_sdk.default.BadRequestError) throw new AIError(`Requisição rejeitada pela Anthropic: ${err.message}`);
	if (err instanceof _anthropic_ai_sdk.default.APIConnectionError) throw new AIError("Sem conexão com a API da Anthropic.");
	if (err instanceof _anthropic_ai_sdk.default.APIError) throw new AIError(`Erro da API da Anthropic (${err.status}): ${err.message}`);
	throw err;
}
function checkStop(message) {
	if (message.stop_reason === "refusal") throw new AIError("O modelo se recusou a processar este pedido.");
	if (message.stop_reason === "max_tokens") throw new AIError("A resposta da IA foi cortada por ser longa demais.");
}
var textOf = (message) => message.content.flatMap((b) => b.type === "text" ? [b.text] : []).join("");
function createAnthropicProvider(apiKey, model) {
	const client = new _anthropic_ai_sdk.default({ apiKey });
	return {
		id: "anthropic",
		async extractReport(pdf, fallbackText) {
			const document = pdf.byteLength <= MAX_PDF_BYTES$1 ? {
				type: "document",
				source: {
					type: "base64",
					media_type: "application/pdf",
					data: pdf.toString("base64")
				}
			} : {
				type: "text",
				text: `<relatorio>\n${await fallbackText()}\n</relatorio>`
			};
			let message;
			try {
				message = await client.beta.messages.stream({
					model,
					max_tokens: 32e3,
					...FALLBACK,
					system: EXTRACTION_PROMPT,
					output_config: {
						effort: "medium",
						format: {
							type: "json_schema",
							schema: EXTRACTION_SCHEMA
						}
					},
					messages: [{
						role: "user",
						content: [document, {
							type: "text",
							text: EXTRACTION_USER_MESSAGE
						}]
					}]
				}).finalMessage();
			} catch (err) {
				translateError$1(err);
			}
			checkStop(message);
			return parseExtraction(textOf(message));
		},
		async research(prompt, onStatus) {
			const tools = [{
				type: "web_search_20260209",
				name: "web_search",
				max_uses: 30
			}, {
				type: "web_fetch_20260209",
				name: "web_fetch",
				max_uses: 30
			}];
			const messages = [{
				role: "user",
				content: prompt
			}];
			const sources = /* @__PURE__ */ new Map();
			const texts = [];
			let searches = 0;
			for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
				let message;
				try {
					const stream = client.beta.messages.stream({
						model,
						max_tokens: 64e3,
						...FALLBACK,
						output_config: { effort: "medium" },
						tools,
						messages
					});
					stream.on("contentBlock", (block) => {
						if (block.type === "server_tool_use" && block.name === "web_search") {
							searches++;
							const query = block.input.query;
							onStatus(`Pesquisa ${searches}${query ? `: "${query}"` : ""}`);
						} else if (block.type === "server_tool_use" && block.name === "web_fetch") {
							const url = block.input.url;
							onStatus(`Lendo ${url ?? "página"}`);
						}
					});
					message = await stream.finalMessage();
				} catch (err) {
					translateError$1(err);
				}
				for (const block of message.content) if (block.type === "web_search_tool_result" && Array.isArray(block.content)) for (const r of block.content) sources.set(r.url, r.title);
				else if (block.type === "web_fetch_tool_result" && block.content.type === "web_fetch_result") sources.set(block.content.url, block.content.content.title ?? block.content.url);
				else if (block.type === "text") texts.push(block.text);
				if (message.stop_reason === "pause_turn") {
					messages.push({
						role: "assistant",
						content: message.content
					});
					continue;
				}
				checkStop(message);
				return {
					text: texts.join(""),
					sources: [...sources].map(([url, title]) => ({
						url,
						title
					}))
				};
			}
			throw new AIError("A pesquisa demorou demais e foi interrompida.");
		},
		async structure(system, input, schema) {
			let message;
			try {
				message = await client.beta.messages.stream({
					model,
					max_tokens: 32e3,
					...FALLBACK,
					system,
					output_config: {
						effort: "low",
						format: {
							type: "json_schema",
							schema
						}
					},
					messages: [{
						role: "user",
						content: input
					}]
				}).finalMessage();
			} catch (err) {
				translateError$1(err);
			}
			checkStop(message);
			try {
				return JSON.parse(textOf(message));
			} catch {
				throw new AIError("Resposta da IA em formato inesperado.");
			}
		},
		async listModels() {
			try {
				const ids = [];
				for await (const m of client.models.list()) ids.push(m.id);
				return ids;
			} catch (err) {
				translateError$1(err);
			}
		}
	};
}
// src/main/ai/gemini.ts
/** Dados inline numa requisição do Gemini têm limite de ~20 MB. */
var MAX_PDF_BYTES = 18874368;
function translateError(err) {
	if (err instanceof _google_genai.ApiError) {
		if (err.status === 400 && /api key/i.test(err.message)) throw new AIError("Chave da API do Gemini inválida.");
		if (err.status === 401 || err.status === 403) throw new AIError("A chave do Gemini não tem permissão para este recurso.");
		if (err.status === 404) throw new AIError("Modelo não encontrado no Gemini. Escolha outro nas Configurações.");
		if (err.status === 429) throw new AIError("Cota da API do Gemini esgotada. Tente novamente mais tarde.");
		throw new AIError(`Erro da API do Gemini (${err.status}): ${err.message}`);
	}
	if (err instanceof TypeError && /fetch/i.test(err.message)) throw new AIError("Sem conexão com a API do Gemini.");
	throw err;
}
function checkFinish(res) {
	if (res.promptFeedback?.blockReason) throw new AIError("O Gemini bloqueou este pedido por política de conteúdo.");
	const reason = res.candidates?.[0]?.finishReason;
	if (reason === "MAX_TOKENS") throw new AIError("A resposta da IA foi cortada por ser longa demais.");
	if (reason === "SAFETY" || reason === "RECITATION") throw new AIError("O Gemini interrompeu a resposta por política de conteúdo.");
	const text = res.text;
	if (!text) throw new AIError("O Gemini não retornou resposta.");
	return text;
}
function createGeminiProvider(apiKey, model) {
	const ai = new _google_genai.GoogleGenAI({ apiKey });
	return {
		id: "gemini",
		async extractReport(pdf, fallbackText) {
			const document = pdf.byteLength <= MAX_PDF_BYTES ? { inlineData: {
				mimeType: "application/pdf",
				data: pdf.toString("base64")
			} } : { text: `<relatorio>\n${await fallbackText()}\n</relatorio>` };
			let res;
			try {
				res = await ai.models.generateContent({
					model,
					contents: [{
						role: "user",
						parts: [document, { text: EXTRACTION_USER_MESSAGE }]
					}],
					config: {
						systemInstruction: EXTRACTION_PROMPT,
						responseMimeType: "application/json",
						responseJsonSchema: EXTRACTION_SCHEMA,
						maxOutputTokens: 32e3
					}
				});
			} catch (err) {
				translateError(err);
			}
			return parseExtraction(checkFinish(res));
		},
		async research(prompt, onStatus) {
			onStatus("Pesquisando com Google Search…");
			let res;
			try {
				res = await ai.models.generateContent({
					model,
					contents: prompt,
					config: {
						tools: [{ googleSearch: {} }, { urlContext: {} }],
						maxOutputTokens: 64e3
					}
				});
			} catch (err) {
				translateError(err);
			}
			const text = checkFinish(res);
			const candidate = res.candidates?.[0];
			const sources = /* @__PURE__ */ new Map();
			for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) if (chunk.web?.uri) sources.set(chunk.web.uri, chunk.web.title ?? chunk.web.uri);
			for (const meta of candidate?.urlContextMetadata?.urlMetadata ?? []) if (meta.retrievedUrl) sources.set(meta.retrievedUrl, meta.retrievedUrl);
			return {
				text,
				sources: [...sources].map(([url, title]) => ({
					url,
					title
				}))
			};
		},
		async structure(system, input, schema) {
			let res;
			try {
				res = await ai.models.generateContent({
					model,
					contents: input,
					config: {
						systemInstruction: system,
						responseMimeType: "application/json",
						responseJsonSchema: schema,
						maxOutputTokens: 32e3
					}
				});
			} catch (err) {
				translateError(err);
			}
			try {
				return JSON.parse(checkFinish(res));
			} catch (err) {
				if (err instanceof AIError) throw err;
				throw new AIError("Resposta da IA em formato inesperado.");
			}
		},
		async listModels() {
			try {
				const ids = [];
				for await (const m of await ai.models.list()) {
					const id = m.name?.replace(/^models\//, "");
					if (id?.startsWith("gemini") && (m.supportedActions ?? ["generateContent"]).includes("generateContent")) ids.push(id);
				}
				return ids.sort().reverse();
			} catch (err) {
				translateError(err);
			}
		}
	};
}
// src/main/ai/index.ts
/** Instancia um provedor específico (ex.: para listar modelos na tela de configurações). */
function createProvider(id, model) {
	const { key } = getApiKey(id);
	if (!key) return null;
	const settings = getSettings();
	return id === "anthropic" ? createAnthropicProvider(key, model ?? settings.anthropicModel) : createGeminiProvider(key, model ?? settings.geminiModel);
}
/** Provedor escolhido nas configurações, ou null se ele não tiver chave. */
function activeProvider() {
	return createProvider(getSettings().provider);
}
// src/main/extract/heuristic.ts
/**
* Extrator offline, sem IA. Funciona razoavelmente em relatórios de
* "início de cobertura" e "carteira recomendada", mas erra com layouts em
* tabela complexos. Serve de fallback quando não há chave de API.
*/
var INSTITUTIONS = [
	[/btg\s*pactual|\bbtg\b/i, "BTG Pactual"],
	[/\bxp\s*(investimentos|research)?\b/i, "XP"],
	[/ita[uú]\s*bba/i, "Itaú BBA"],
	[/bradesco\s*bbi/i, "Bradesco BBI"],
	[/\bsafra\b/i, "Safra"],
	[/santander/i, "Santander"],
	[/\bgenial\b/i, "Genial"],
	[/[áa]gora\s*investimentos/i, "Ágora"],
	[/bb\s*investimentos|banco\s+do\s+brasil/i, "BB Investimentos"],
	[/\binter\s*(invest|research)/i, "Inter"],
	[/goldman\s*sachs/i, "Goldman Sachs"],
	[/j\.?\s*p\.?\s*morgan/i, "JPMorgan"],
	[/morgan\s*stanley/i, "Morgan Stanley"],
	[/\bubs\b/i, "UBS"],
	[/bank\s+of\s+america|bofa/i, "BofA"],
	[/citi(group|\s*research)?\b/i, "Citi"],
	[/\bwarren\b/i, "Warren"],
	[/\bnord\s*(research|investimentos)\b/i, "Nord"],
	[/empiricus/i, "Empiricus"],
	[/\bmodal\b/i, "Modal"]
];
var MONTHS = {
	janeiro: 1,
	fevereiro: 2,
	março: 3,
	marco: 3,
	abril: 4,
	maio: 5,
	junho: 6,
	julho: 7,
	agosto: 8,
	setembro: 9,
	outubro: 10,
	novembro: 11,
	dezembro: 12
};
var pad = (n) => String(n).padStart(2, "0");
function detectInstitution(text) {
	const head = text.slice(0, 4e3);
	let best = ["Desconhecida", 0];
	for (const [re, name] of INSTITUTIONS) {
		const count = (head.match(new RegExp(re.source, "gi")) ?? []).length;
		if (count > best[1]) best = [name, count];
	}
	return best[0];
}
function detectDate(text) {
	const head = text.slice(0, 4e3);
	const candidates = [];
	for (const m of head.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
		const [d, mo, y] = [
			Number(m[1]),
			Number(m[2]),
			Number(m[3])
		];
		if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) candidates.push(`${y}-${pad(mo)}-${pad(d)}`);
	}
	for (const m of head.matchAll(/\b(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})\b/gi)) {
		const mo = MONTHS[m[2].toLowerCase()];
		if (mo) candidates.push(`${m[3]}-${pad(mo)}-${pad(Number(m[1]))}`);
	}
	return candidates.filter((c) => c <= today()).sort().at(-1) ?? today();
}
/** "1.234,56" / "34,50" / "34.50" -> número. */
function parseBrazilianNumber(raw) {
	let s = raw.trim();
	if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
	else s = s.replace(/,/g, "");
	const n = Number(s);
	return Number.isFinite(n) && n > 0 ? n : null;
}
var TARGET_RE = /(?:pre[çc]o[-\s]?(?:alvo|justo)|target(?:\s+price)?|\bPA\b|valor\s+justo)\s*(?:12M|de|:|-|\(.*?\))?\s*(?:de\s+)?(?:R\$\s*)?(\d{1,4}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/i;
var PRICE_RE = /(?:pre[çc]o\s+atual|cota[çc][ãa]o|[úu]ltimo\s+pre[çc]o|price)\s*(?:de|:|-)?\s*(?:R\$\s*)?(\d{1,4}(?:[.,]\d{1,2})?)/i;
function extractHeuristic(text) {
	const clean = text.replace(/\s+/g, " ");
	const windows = /* @__PURE__ */ new Map();
	for (const m of clean.matchAll(B3_TICKER)) {
		const start = Math.max(0, m.index - 160);
		const after = clean.slice(m.index + m[0].length, m.index + m[0].length + 220);
		const nextTicker = after.search(new RegExp(B3_TICKER.source));
		const end = m.index + m[0].length + (nextTicker >= 0 ? nextTicker : after.length);
		const list = windows.get(m[1]) ?? [];
		list.push({
			text: clean.slice(start, end),
			pos: m.index - start
		});
		windows.set(m[1], list);
	}
	const calls = [];
	for (const [ticker, wins] of windows) {
		const votes = {
			compra: 0,
			neutro: 0,
			venda: 0
		};
		let original = "";
		let target = null;
		let price = null;
		for (const w of wins) {
			const r = nearestRating(w.text, w.pos);
			if (r) {
				votes[r.rating]++;
				original ||= r.term;
			}
			const forward = w.text.slice(w.pos);
			if (target === null) {
				const t = forward.match(TARGET_RE);
				if (t) target = parseBrazilianNumber(t[1]);
			}
			if (price === null) {
				const p = forward.match(PRICE_RE);
				if (p) price = parseBrazilianNumber(p[1]);
			}
		}
		if (votes.compra + votes.neutro + votes.venda === 0) continue;
		const rating = Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
		calls.push({
			ticker,
			company: null,
			rating,
			originalRating: original,
			targetPrice: target,
			priceAtReport: price,
			currency: "BRL",
			horizon: null,
			thesis: `Leitura automática (sem IA): ${votes.compra} menção(ões) de compra, ${votes.neutro} neutra(s), ${votes.venda} de venda próximas ao ticker.`
		});
	}
	const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 10) ?? "";
	return {
		institution: detectInstitution(text),
		reportDate: detectDate(text),
		title: firstLine.slice(0, 140),
		summary: "",
		calls: dedupeCalls(calls)
	};
}
// src/main/pdf.ts
/** Extrai o texto de todas as páginas de um PDF (usado pela heurística e como fallback). */
async function pdfToText(data) {
	const { extractText, getDocumentProxy } = await import("unpdf");
	const { text, totalPages } = await extractText(await getDocumentProxy(new Uint8Array(data)), { mergePages: true });
	return {
		text,
		pages: totalPages
	};
}
// src/main/importer.ts
async function processFile(filePath, force) {
	const data = await (0, node_fs_promises.readFile)(filePath);
	const id = (0, node_crypto.createHash)("sha256").update(data).digest("hex");
	if (!force && getReports().some((r) => r.id === id)) return "duplicado";
	let textCache = null;
	const getText = () => textCache ??= pdfToText(data).then((r) => r.text);
	const provider = activeProvider();
	let extracted;
	let method;
	if (provider) {
		extracted = await provider.extractReport(data, getText);
		method = "ia";
		if (!extracted.reportDate) extracted.reportDate = extractHeuristic(await getText()).reportDate;
	} else {
		extracted = extractHeuristic(await getText());
		method = "heuristica";
	}
	const report = {
		id,
		fileName: (0, node_path.basename)(filePath),
		filePath,
		institution: extracted.institution || "Desconhecida",
		reportDate: extracted.reportDate || today(),
		title: extracted.title,
		summary: extracted.summary,
		importedAt: (/* @__PURE__ */ new Date()).toISOString(),
		method,
		provider: provider?.id,
		source: "pdf",
		calls: extracted.calls
	};
	saveReport(report);
	return report;
}
async function importFiles(paths, onProgress, force = false) {
	const result = {
		imported: [],
		errors: []
	};
	for (const filePath of paths) {
		const fileName = (0, node_path.basename)(filePath);
		if (!/\.pdf$/i.test(fileName)) {
			result.errors.push({
				fileName,
				message: "Apenas arquivos PDF são suportados."
			});
			onProgress({
				filePath,
				fileName,
				status: "erro",
				message: "Não é PDF"
			});
			continue;
		}
		onProgress({
			filePath,
			fileName,
			status: "processando"
		});
		try {
			const r = await processFile(filePath, force);
			if (r === "duplicado") onProgress({
				filePath,
				fileName,
				status: "duplicado",
				message: "Já importado"
			});
			else {
				result.imported.push(r);
				onProgress({
					filePath,
					fileName,
					status: "ok",
					message: `${r.calls.length} recomendação(ões)`
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			result.errors.push({
				fileName,
				message
			});
			onProgress({
				filePath,
				fileName,
				status: "erro",
				message
			});
		}
	}
	return result;
}
// src/main/search.ts
var TICKER = /^[A-Z]{4}(3|4|5|6|11)$/;
var hostOf = (url) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
};
/**
* Busca na web as carteiras recomendadas do mês e salva cada uma como um
* "relatório" (source = 'web'), que entra no consenso como os PDFs.
*
* Em duas etapas, para funcionar igual em qualquer provedor:
*  1. pesquisa com busca na web → anotações em texto livre com as URLs;
*  2. conversão das anotações em JSON validado (sem web).
*/
async function searchPortfolios(month, onProgress) {
	const provider = activeProvider();
	if (!provider) throw new AIError("Configure a chave de API do provedor de IA nas Configurações.");
	const { trackedInstitutions } = getSettings();
	if (trackedInstitutions.length === 0) throw new AIError("Nenhuma instituição selecionada nas Configurações.");
	onProgress({
		stage: "pesquisando",
		message: `Procurando carteiras de ${monthLabel(month)}…`
	});
	const research = await provider.research(researchPrompt(month, trackedInstitutions), (message) => onProgress({
		stage: "pesquisando",
		message
	}));
	onProgress({
		stage: "organizando",
		message: "Organizando os resultados…"
	});
	const sourcesList = research.sources.map((s) => `- ${s.title} — ${s.url}`).join("\n");
	const raw = await provider.structure(STRUCTURE_PROMPT, `Instituições pedidas: ${trackedInstitutions.join(", ")}\n\n<anotacoes>\n${research.text}\n</anotacoes>\n\n<paginas_consultadas>\n${sourcesList}\n</paginas_consultadas>`, PORTFOLIOS_SCHEMA);
	const parsed = PortfoliosSchema.safeParse(raw);
	if (!parsed.success) throw new AIError("Resposta da IA em formato inesperado.");
	const seenUrls = new Set(research.sources.map((s) => s.url));
	const seenHosts = new Set(research.sources.flatMap((s) => [hostOf(s.url), s.title.replace(/^www\./, "")]));
	const institutions = /* @__PURE__ */ new Set();
	let saved = 0;
	for (const p of parsed.data.portfolios) {
		const calls = [];
		const seen = /* @__PURE__ */ new Set();
		for (const a of p.assets) {
			const ticker = a.ticker.toUpperCase().trim();
			if (!TICKER.test(ticker) || seen.has(ticker)) continue;
			seen.add(ticker);
			calls.push({
				ticker,
				company: a.company,
				rating: "compra",
				originalRating: `Carteira: ${p.portfolioName}${a.weight != null ? ` (${(a.weight * 100).toFixed(1)}%)` : ""}`,
				targetPrice: null,
				priceAtReport: null,
				currency: "BRL",
				horizon: null,
				thesis: ""
			});
		}
		if (calls.length === 0) continue;
		const refMonth = /^\d{4}-\d{2}$/.test(p.referenceMonth) ? p.referenceMonth : month;
		const reportDate = p.publishedDate && /^\d{4}-\d{2}-\d{2}$/.test(p.publishedDate) && p.publishedDate.startsWith(refMonth) ? p.publishedDate : `${refMonth}-01`;
		const verified = !!p.sourceUrl && (seenUrls.has(p.sourceUrl) || seenHosts.has(hostOf(p.sourceUrl)));
		saveReport({
			id: (0, node_crypto.createHash)("sha256").update(`web|${p.institution}|${p.portfolioName}|${refMonth}`.toLowerCase()).digest("hex"),
			fileName: `${p.portfolioName} — ${monthLabel(refMonth)}`,
			filePath: "",
			institution: p.institution,
			reportDate,
			title: p.portfolioName,
			summary: `Carteira encontrada pela busca automática (${calls.length} ativos).`,
			importedAt: (/* @__PURE__ */ new Date()).toISOString(),
			method: "ia",
			provider: provider.id,
			source: "web",
			portfolioName: p.portfolioName,
			sourceUrl: p.sourceUrl,
			sourceVerified: verified,
			calls
		});
		institutions.add(p.institution);
		saved++;
	}
	const result = {
		month,
		portfolios: saved,
		institutions: [...institutions],
		notFound: parsed.data.notFound
	};
	onProgress({
		stage: "ok",
		message: `${saved} carteira(s) de ${institutions.size} instituição(ões) encontradas.`
	});
	return result;
}
// src/main/index.ts
var win = null;
function createWindow() {
	win = new electron.BrowserWindow({
		width: 1280,
		height: 820,
		minWidth: 900,
		minHeight: 600,
		title: "Recomendação",
		backgroundColor: "#0f1115",
		webPreferences: {
			preload: (0, node_path.join)(__dirname, "../preload/index.js"),
			contextIsolation: true,
			sandbox: true
		}
	});
	win.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("https://")) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	if (!electron.app.isPackaged && process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
	else win.loadFile((0, node_path.join)(__dirname, "../renderer/index.html"));
}
function registerIpc() {
	const progress = (p) => win?.webContents.send("import:progress", p);
	electron.ipcMain.handle("reports:list", () => getReports());
	electron.ipcMain.handle("reports:pick", async () => {
		const res = await electron.dialog.showOpenDialog(win, {
			title: "Selecionar relatórios",
			filters: [{
				name: "PDF",
				extensions: ["pdf"]
			}],
			properties: ["openFile", "multiSelections"]
		});
		if (res.canceled) return {
			imported: [],
			errors: []
		};
		return importFiles(res.filePaths, progress);
	});
	electron.ipcMain.handle("reports:import", (_e, paths) => importFiles(paths, progress));
	electron.ipcMain.handle("reports:reprocess", async (_e, id) => {
		const report = getReports().find((r) => r.id === id);
		if (!report) throw new Error("Relatório não encontrado.");
		if (!(0, node_fs.existsSync)(report.filePath)) throw new Error(`O arquivo original não está mais em ${report.filePath}. Importe-o novamente.`);
		return importFiles([report.filePath], progress, true);
	});
	electron.ipcMain.handle("reports:update", (_e, id, patch) => {
		const report = getReports().find((r) => r.id === id);
		if (!report) throw new Error("Relatório não encontrado.");
		saveReport({
			...report,
			institution: patch.institution,
			reportDate: patch.reportDate
		});
	});
	electron.ipcMain.handle("reports:delete", (_e, id) => deleteReport(id));
	electron.ipcMain.handle("reports:open", async (_e, id) => {
		const report = getReports().find((r) => r.id === id);
		if (report?.sourceUrl?.startsWith("https://") || report?.sourceUrl?.startsWith("http://")) {
			await electron.shell.openExternal(report.sourceUrl);
			return "";
		}
		if (report?.filePath && (0, node_fs.existsSync)(report.filePath)) return electron.shell.openPath(report.filePath);
		return "Arquivo não encontrado.";
	});
	electron.ipcMain.handle("consensus:get", () => buildConsensus(getReports(), getSettings()));
	electron.ipcMain.handle("portfolio:get", () => buildConsolidated(getReports(), getSettings()));
	let searching = false;
	electron.ipcMain.handle("search:run", async (_e, month) => {
		if (searching) throw new Error("Já existe uma busca em andamento.");
		searching = true;
		try {
			return await searchPortfolios(month, (p) => win?.webContents.send("search:progress", p));
		} catch (err) {
			const message = err instanceof AIError ? err.message : `Falha na busca: ${err instanceof Error ? err.message : err}`;
			win?.webContents.send("search:progress", {
				stage: "erro",
				message
			});
			throw new Error(message);
		} finally {
			searching = false;
		}
	});
	electron.ipcMain.handle("models:list", async (_e, provider) => {
		const p = createProvider(provider);
		if (!p) return [];
		return p.listModels();
	});
	electron.ipcMain.handle("settings:get", () => getSettingsView());
	electron.ipcMain.handle("settings:save", (_e, patch) => {
		saveSettings(patch);
		return getSettingsView();
	});
	electron.ipcMain.handle("settings:setApiKey", (_e, provider, key) => {
		setApiKey(provider, key);
		return getSettingsView();
	});
}
electron.app.whenReady().then(() => {
	registerIpc();
	createWindow();
	electron.app.on("activate", () => {
		if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") electron.app.quit();
});
