// dsh-vue-auth-analyzer bundle entry point.
// Registers agent skill + Settings namespace + HTTP routes for GUI.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-vue-auth-analyzer'

const packageRoot = dirname(fileURLToPath(import.meta.url))

// ─── SKILL.md frontmatter parser ────────────────────────
function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { description: undefined, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { description: undefined, body: text }
  const meta = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n+/, '')
  const match = /^description:\s*(.+)$/m.exec(meta)
  return { description: match?.[1]?.trim(), body }
}

// ─── Settings schema ────────────────────────────────────
const AnalyzerSettings = z.object({
  viewsDir: z.string().default('src/views')
    .description('Vue pages directory relative to project root'),
  authDirectiveName: z.string().default('auth')
    .description('Permission directive name (e.g. "auth" for v-auth, "permission" for v-permission)'),
  i18nFile: z.string().default('src/lang/package/zh-cn.ts')
    .description('i18n translation file path (leave empty to skip)'),
  excludePatterns: z.string().default('**/components/**,**/login/**,**/profile/**')
    .description('Comma-separated glob patterns to exclude'),
  aiEnabled: z.boolean().default(true)
    .description('Enable AI completion for unmatched buttons'),
  aiModel: z.string().default('qwen3.7-max')
    .description('LLM model name'),
  aiBaseUrl: z.string().default('')
    .description('LLM API base URL (OpenAI-compatible endpoint)'),
  aiApiKey: z.string().role('secret').default('')
    .description('LLM API key (auto-detect from ~/.dsh/.credentials.yaml if empty)'),
  aiTemperature: z.number().default(0.1).min(0).max(1).step(0.05)
    .description('LLM temperature (lower = more deterministic)'),
  aiMaxRetries: z.natural().default(3)
    .description('Max retry attempts for failed LLM calls'),
})

const SETTINGS_NS = settingsNamespace('dsh-vue-auth-analyzer')

// ─── Sync settings to script CONFIG ─────────────────────
function syncConfigToFile(settings) {
  const scriptPath = join(packageRoot, 'scripts', 'vue-auth-api-analyzer.mjs')
  if (!existsSync(scriptPath)) return
  let code = readFileSync(scriptPath, 'utf8')

  const replacements = [
    [/viewsDir:\s*"[^"]*"/, `viewsDir: "${settings.viewsDir}"`],
    [/authDirectiveName:\s*"[^"]*"/, `authDirectiveName: "${settings.authDirectiveName}"`],
    [/i18nFile:\s*(?:null|"[^"]*")/, `i18nFile: ${settings.i18nFile ? '"' + settings.i18nFile + '"' : 'null'}`],
    [/ai\.enabled:\s*(?:true|false)/, `ai.enabled: ${settings.aiEnabled}`],
    [/model:\s*"[^"]*"/, `model: "${settings.aiModel}"`],
    [/baseUrl:\s*"[^"]*"/, `baseUrl: "${settings.aiBaseUrl}"`],
    [/temperature:\s*[\d.]+/, `temperature: ${settings.aiTemperature}`],
    [/maxRetries:\s*\d+/, `maxRetries: ${settings.aiMaxRetries}`],
  ]
  for (const [pattern, replacement] of replacements) {
    code = code.replace(pattern, replacement)
  }
  if (settings.aiApiKey) {
    code = code.replace(/apiKey:\s*"[^"]*"/, `apiKey: "${settings.aiApiKey}"`)
  }
  const patterns = settings.excludePatterns.split(',').map(p => p.trim()).filter(Boolean)
  code = code.replace(
    /excludePatterns:\s*\[[^\]]*\]/,
    `excludePatterns: [${patterns.map(p => '"' + p + '"').join(', ')}]`
  )
  writeFileSync(scriptPath, code, 'utf8')
}

// ─── Active run state (for cancel/status) ───────────────
let activeRun = null // { child, abortController }

// ─── Plugin entry ───────────────────────────────────────
export function apply(ctx) {
  // Register skill via dynamic inject (graceful if skills service unavailable)
  ctx.inject(['skills'], (sctx) => {
    const skillPath = join(packageRoot, 'SKILL.md')
    const { description, body } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
    sctx.effect(() =>
      sctx.skills.register({
        name: 'dsh-vue-auth-analyzer',
        source: 'bundled',
        description: description ?? 'Vue 3 button-permission-API mapping analyzer.',
        content: body,
        resourceBase: { kind: 'directory', path: packageRoot },
      }),
    )
  })

  // Register settings via dynamic inject (graceful if settings service unavailable)
  ctx.inject(['settings'], (sctx) => {
    const base = {}
    try {
      const scriptCode = readFileSync(join(packageRoot, 'scripts', 'vue-auth-api-analyzer.mjs'), 'utf8')
      const vm = scriptCode.match(/viewsDir:\s*"([^"]*)"/)
      if (vm) base.viewsDir = vm[1]
      const am = scriptCode.match(/authDirectiveName:\s*"([^"]*)"/)
      if (am) base.authDirectiveName = am[1]
    } catch {}

    let source = () => base
    installSettingsSection(sctx, SETTINGS_NS, AnalyzerSettings, base, {
      setSource: (current) => { source = current },
      onChange: () => {
        try {
          const resolved = source()
          if (resolved) syncConfigToFile(resolved)
        } catch (e) {
          console.error('[dsh-vue-auth-analyzer] Config sync failed:', e?.message)
        }
      },
    })
  })

  // Register HTTP routes via dynamic inject (graceful if webServer unavailable)
  ctx.inject(['webServer'], (host) => {
    const scriptPath = join(packageRoot, 'scripts', 'vue-auth-api-analyzer.mjs')

    // POST /dsh-vue-auth-analyzer/run — start analysis with NDJSON streaming
    host.register({
      kind: 'exact',
      path: '/dsh-vue-auth-analyzer/run',
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }

        // Cancel any existing run
        if (activeRun) {
          activeRun.child.kill('SIGINT')
          activeRun = null
        }

        let body = ''
        for await (const chunk of request) body += chunk
        let opts = {}
        try { opts = JSON.parse(body || '{}') } catch {}

        const args = ['--ndjson']
        if (opts.staticOnly) args.push('--static-only')
        if (opts.noCache) args.push('--no-cache')

        // Determine working directory (project root)
        const cwd = opts.cwd || process.cwd()

        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })

        const child = spawn(process.execPath, [scriptPath, ...args], {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env },
        })

        activeRun = { child }

        child.stdout.on('data', (chunk) => {
          response.write(chunk)
        })

        child.stderr.on('data', (chunk) => {
          // Forward stderr as error events
          const lines = chunk.toString().split('\n').filter(l => l.trim())
          for (const line of lines) {
            response.write(JSON.stringify({ type: 'stderr', message: line }) + '\n')
          }
        })

        child.on('close', (code) => {
          activeRun = null
          response.write(JSON.stringify({ type: 'exit', code }) + '\n')
          response.end()
        })

        child.on('error', (err) => {
          activeRun = null
          response.write(JSON.stringify({ type: 'error', message: err.message }) + '\n')
          response.end()
        })

        // If client disconnects, kill the child
        request.on('close', () => {
          if (activeRun && activeRun.child === child) {
            child.kill('SIGINT')
            activeRun = null
          }
        })
      },
    })

    // POST /dsh-vue-auth-analyzer/cancel — cancel active run
    host.register({
      kind: 'exact',
      path: '/dsh-vue-auth-analyzer/cancel',
      handler: (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }
        if (activeRun) {
          activeRun.child.kill('SIGINT')
          activeRun = null
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: true }))
        } else {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: true, message: 'no active run' }))
        }
      },
    })

    // POST /dsh-vue-auth-analyzer/merge — merge AI results from subagents
    host.register({
      kind: 'exact',
      path: '/dsh-vue-auth-analyzer/merge',
      handler: async (request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405, { allow: 'POST' })
          response.end()
          return
        }

        let body = ''
        for await (const chunk of request) body += chunk
        let opts = {}
        try { opts = JSON.parse(body || '{}') } catch {}

        const cwd = opts.cwd || process.cwd()
        const args = ['--merge-ai', '--ndjson']

        response.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'cache-control': 'no-store',
        })

        const child = spawn(process.execPath, [scriptPath, ...args], {
          cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
        })

        child.stdout.on('data', (chunk) => { response.write(chunk) })
        child.stderr.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(l => l.trim())
          for (const line of lines) {
            response.write(JSON.stringify({ type: 'stderr', message: line }) + '\n')
          }
        })
        child.on('close', (code) => {
          response.write(JSON.stringify({ type: 'exit', code }) + '\n')
          response.end()
        })
        child.on('error', (err) => {
          response.write(JSON.stringify({ type: 'error', message: err.message }) + '\n')
          response.end()
        })
      },
    })

    // GET /dsh-vue-auth-analyzer/status — check if running
    host.register({
      kind: 'exact',
      path: '/dsh-vue-auth-analyzer/status',
      handler: (request, response) => {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ running: activeRun !== null }))
      },
    })
  })
}
