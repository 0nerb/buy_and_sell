import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { ClaudeCodeStatus } from '@shared/types'
import {
  AIError,
  EXTRACTION_PROMPT,
  EXTRACTION_SCHEMA,
  parseExtraction,
  type AIProvider,
  type ResearchOutput
} from './shared'

/**
 * Provedor que usa a ASSINATURA Claude (Pro/Max) da pessoa, sem chave de API.
 *
 * Não falamos com a API diretamente: rodamos o Claude Code (o CLI oficial da
 * Anthropic) em modo não interativo. Ele já está logado com a conta da pessoa
 * (`claude` → /login), então o uso entra na cota da assinatura.
 *
 * Isso vale para uso pessoal, no computador de quem tem a assinatura. Se o app
 * um dia for oferecido a outras pessoas, cada uma precisa usar a própria chave de API.
 *
 * Segurança: cada execução roda numa pasta temporária vazia, só com as
 * ferramentas necessárias (Read para o PDF; WebSearch/WebFetch para a busca),
 * sem MCP, sem hooks e sem as configurações pessoais do Claude Code.
 */

const EXE = process.platform === 'win32' ? 'claude.exe' : 'claude'

/** Procura o executável: caminho configurado → PATH → extensão do VS Code/Cursor. */
export function findClaudeBinary(customPath: string): string | null {
  if (customPath) return existsSync(customPath) ? customPath : null

  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, EXE))) return join(dir, EXE)
  }
  const home = homedir()
  for (const p of [join(home, '.local', 'bin', EXE), join(home, '.claude', 'local', EXE)]) {
    if (existsSync(p)) return p
  }
  // A extensão do VS Code traz o binário junto; usamos a versão mais nova instalada.
  for (const base of ['.vscode', '.vscode-server', '.cursor', '.cursor-server', '.windsurf']) {
    const dir = join(home, base, 'extensions')
    if (!existsSync(dir)) continue
    const found = readdirSync(dir)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((d) => join(dir, d, 'resources', 'native-binary', EXE))
      .find(existsSync)
    if (found) return found
  }
  return null
}

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(
  bin: string,
  args: string[],
  opts: { cwd: string; stdin?: string; timeoutMs: number; onLine?: (line: string) => void }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let pending = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new AIError('O Claude demorou demais para responder e a execução foi interrompida.'))
    }, opts.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (!opts.onLine) return
      pending += chunk
      let nl: number
      while ((nl = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, nl).trim()
        pending = pending.slice(nl + 1)
        if (line) opts.onLine(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(new AIError(`Não foi possível executar o Claude Code: ${err.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (opts.onLine && pending.trim()) opts.onLine(pending.trim())
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(opts.stdin ?? '')
  })
}

// ---------- Situação do login (com cache curto) ----------

let lastUsage: ClaudeCodeStatus['usage'] = null
let statusCache: { at: number; path: string; status: ClaudeCodeStatus } | null = null

export async function claudeCodeStatus(customPath: string, force = false): Promise<ClaudeCodeStatus> {
  const path = findClaudeBinary(customPath)
  if (!force && statusCache && statusCache.path === (path ?? '') && Date.now() - statusCache.at < 30_000) {
    return { ...statusCache.status, usage: lastUsage }
  }
  const status: ClaudeCodeStatus = {
    path, version: null, loggedIn: false, email: null, plan: null, usage: lastUsage,
    error: path ? null : customPath ? 'Executável não encontrado no caminho informado.' : 'Claude Code não encontrado neste computador.'
  }
  if (path) {
    try {
      const [ver, auth] = await Promise.all([
        run(path, ['--version'], { cwd: tmpdir(), timeoutMs: 20_000 }),
        run(path, ['auth', 'status', '--json'], { cwd: tmpdir(), timeoutMs: 20_000 })
      ])
      status.version = ver.stdout.trim().split(/\s/)[0] || null
      const info = JSON.parse(auth.stdout) as { loggedIn?: boolean; email?: string; subscriptionType?: string; authMethod?: string }
      status.loggedIn = !!info.loggedIn
      status.email = info.email ?? null
      status.plan = info.subscriptionType ?? info.authMethod ?? null
      if (!status.loggedIn) status.error = 'O Claude Code está instalado, mas não está logado.'
    } catch (err) {
      status.error = `Não foi possível consultar o Claude Code: ${err instanceof Error ? err.message : err}`
    }
  }
  statusCache = { at: Date.now(), path: path ?? '', status }
  return status
}

// ---------- Execução ----------

interface CliResult {
  type: 'result'
  subtype: string
  is_error: boolean
  result?: string
  structured_output?: unknown
  api_error_status?: number | null
}

interface RateLimitInfo {
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number }>
  resetsAt?: number
}

function trackUsage(info: RateLimitInfo): void {
  const w = info.unifiedWindows ?? {}
  const reset = w.five_hour?.resetsAt ?? info.resetsAt
  lastUsage = {
    fiveHour: w.five_hour?.utilization ?? null,
    sevenDay: w.seven_day?.utilization ?? null,
    resetsAt: reset ? new Date(reset * 1000).toISOString() : null
  }
}

function lastJson(stdout: string): CliResult | null {
  const lines = stdout.trim().split('\n').reverse()
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj?.type === 'result') return obj as CliResult
    } catch {
      // linha que não é JSON
    }
  }
  return null
}

function resultOrThrow(res: RunResult, parsed: CliResult | null): CliResult {
  if (!parsed) {
    const detail = res.stderr.trim().split('\n').slice(-3).join(' ') || `código ${res.code}`
    throw new AIError(`O Claude Code falhou: ${detail}`)
  }
  if (parsed.is_error || parsed.subtype !== 'success') {
    if (/unrecognized_model/.test(res.stderr)) {
      throw new AIError('Modelo não reconhecido pelo Claude Code. Escolha outro nas Configurações.')
    }
    const text = parsed.result?.trim() || res.stderr.trim()
    if (/usage limit|rate limit|limit reached|resets/i.test(text)) {
      throw new AIError(`O limite de uso da sua assinatura Claude foi atingido. ${text}`)
    }
    if (/log ?in|authenticat|oauth/i.test(text)) {
      throw new AIError('O Claude Code não está logado. Abra um terminal, rode "claude" e use /login.')
    }
    throw new AIError(`O Claude Code retornou um erro: ${text || parsed.subtype}`)
  }
  return parsed
}

export function createClaudeCodeProvider(bin: string, model: string): AIProvider {
  const baseArgs = (system: string, tools: string[]) => [
    '-p',
    '--model', model,
    '--system-prompt', system,
    '--tools', tools.join(','),
    ...(tools.length ? ['--allowedTools', tools.join(',')] : []),
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence'
  ]

  /** Roda numa pasta temporária vazia, apagada no final. */
  async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'recomendacao-'))
    try {
      return await fn(dir)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async function structured(system: string, prompt: string, schema: object, tools: string[], cwd: string, effort: string) {
    const args = [...baseArgs(system, tools), '--effort', effort, '--output-format', 'json', '--json-schema', JSON.stringify(schema)]
    const res = await run(bin, args, { cwd, stdin: prompt, timeoutMs: 10 * 60_000 })
    const parsed = resultOrThrow(res, lastJson(res.stdout))
    if (parsed.structured_output === undefined) throw new AIError('Resposta da IA em formato inesperado.')
    return parsed.structured_output
  }

  return {
    id: 'claude-code',

    extractReport: (pdf) =>
      inTempDir(async (dir) => {
        await writeFile(join(dir, 'relatorio.pdf'), pdf)
        const out = await structured(
          EXTRACTION_PROMPT,
          'Leia o arquivo relatorio.pdf (todas as páginas) e extraia as recomendações dele.',
          EXTRACTION_SCHEMA,
          ['Read'],
          dir,
          'medium'
        )
        return parseExtraction(JSON.stringify(out))
      }),

    research: (prompt, { onStatus, onText, onSource }) =>
      inTempDir(async (dir): Promise<ResearchOutput> => {
        const sources = new Map<string, string>()
        let searches = 0
        const args = [
          ...baseArgs(
            'Você é um pesquisador de mercado financeiro brasileiro. Use as ferramentas de busca e leitura da web para responder com precisão, citando as URLs.',
            ['WebSearch', 'WebFetch']
          ),
          '--effort', 'medium',
          '--output-format', 'stream-json',
          '--verbose'
        ]
        const res = await run(bin, args, {
          cwd: dir,
          stdin: prompt,
          timeoutMs: 30 * 60_000,
          onLine: (line) => {
            let ev: { type?: string; message?: { content?: unknown }; rate_limit_info?: RateLimitInfo }
            try {
              ev = JSON.parse(line)
            } catch {
              return
            }
            if (ev.type === 'rate_limit_event' && ev.rate_limit_info) trackUsage(ev.rate_limit_info)
            const content = Array.isArray(ev.message?.content) ? (ev.message!.content as Record<string, unknown>[]) : []
            for (const block of content) {
              if (ev.type === 'assistant' && block.type === 'tool_use') {
                const input = block.input as { query?: string; url?: string }
                if (block.name === 'WebSearch') onStatus(`Pesquisa ${++searches}: "${input.query ?? ''}"`)
                if (block.name === 'WebFetch' && input.url) {
                  onStatus(`Lendo ${input.url}`)
                  sources.set(input.url, input.url)
                  onSource(input.url, input.url)
                }
              }
              // Texto entre uma ferramenta e outra: é aqui que chegam os blocos <carteira>.
              if (ev.type === 'assistant' && block.type === 'text' && typeof block.text === 'string') {
                onText(block.text + '\n')
              }
              if (ev.type === 'user' && block.type === 'tool_result') {
                // Resultado do WebSearch: "Links: [{"title": ..., "url": ...}, ...]"
                const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
                for (const m of text.matchAll(/"title":\s*"((?:[^"\\]|\\.)*)",\s*"url":\s*"([^"]+)"/g)) {
                  const title = JSON.parse(`"${m[1]}"`)
                  sources.set(m[2], title)
                  onSource(m[2], title)
                }
              }
            }
          }
        })
        const parsed = resultOrThrow(res, lastJson(res.stdout))
        return { text: parsed.result ?? '', sources: [...sources].map(([url, title]) => ({ url, title })) }
      }),

    structure: (system, input, schema) => inTempDir((dir) => structured(system, input, schema, [], dir, 'low')),

    // Aliases: o Claude Code resolve para a versão mais nova de cada família.
    listModels: async () => ['opus', 'sonnet', 'haiku']
  }
}
