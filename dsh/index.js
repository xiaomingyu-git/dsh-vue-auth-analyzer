// dsh-vue-auth-analyzer DSH adapter — bundle entry point.
// Registers agent skill + Settings namespace + HTTP routes for GUI.
// This file lives in dsh/; the core script and metadata are one level up.

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-vue-auth-analyzer'

const packageRoot = dirname(fileURLToPath(import.meta.url))
const parentRoot = join(packageRoot, '..')

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

// ─── Settings schema (generated from metadata.json) ─────
let _meta;
try { _meta = JSON.parse(readFileSync(join(parentRoot, 'metadata.json'), 'utf-8')); } catch {}
const AnalyzerSettings = z.object(Object.fromEntries(
  (_meta?.config || []).map(c => {
    const schema = c.type === 'boolean' ? z.boolean().default(c.default)
      : c.type === 'number' ? z.number().default(c.default)
      : z.string().default(c.default);
    return [c.key, schema.description(c.enHint)];
  })
))

const SETTINGS_NS = settingsNamespace('dsh-vue-auth-analyzer')

// ─── Sync settings to script CONFIG ─────────────────────
function syncConfigToFile(settings) {
  const scriptPath = join(parentRoot, 'scripts', 'vue-auth-api-analyzer.mjs')
  if (!existsSync(scriptPath)) return
  let code = readFileSync(scriptPath, 'utf8')

  // Build replacements from metadata.json config entries
  const meta = _meta || { config: [] }
  for (const c of meta.config) {
    const val = settings[c.key]
    if (val === undefined) continue
    if (c.key === 'excludePatterns') {
      const patterns = (val || '').split(',').map(p => p.trim()).filter(Boolean)
      code = code.replace(/excludePatterns:\s*\[[^\]]*\]/, `excludePatterns: [${patterns.map(p => '"' + p + '"').join(', ')}]`)
    } else if (c.key === 'i18nFile') {
      code = code.replace(/i18nFile:\s*(?:null|"[^"]*")/, `i18nFile: ${val ? '"' + val + '"' : 'null'}`)
    } else if (c.type === 'boolean') {
      const pattern = c.key === 'aiEnabled' ? /ai\.enabled:\s*(?:true|false)/ : new RegExp(c.key + ':\\s*(?:true|false)')
      const target = c.key === 'aiEnabled' ? 'ai.enabled' : c.key
      code = code.replace(pattern, `${target}: ${val}`)
    } else if (c.key.startsWith('ai') && c.key !== 'aiEnabled') {
      // Map aiApiKey → ai.apiKey, aiBaseUrl → ai.baseUrl, etc.
      const configKey = 'ai.' + c.key.charAt(2).toLowerCase() + c.key.slice(3)
      if (c.type === 'number') {
        code = code.replace(new RegExp(configKey.replace('.', '\\.') + ':\\s*\\d+'), `${configKey}: ${val}`)
      } else {
        code = code.replace(new RegExp(configKey.replace('.', '\\.') + ':\\s*"[^"]*"' ), `${configKey}: "${val}"`)
      }
    } else {
      code = code.replace(new RegExp(c.key + ':\\s*"[^"]*"' ), `${c.key}: "${val}"`)
    }
  }
  writeFileSync(scriptPath, code, 'utf8')
}

// ─── Active run state (for cancel/status) ───────────────
let activeRun = null // { child, abortController }

// ─── Live progress state (for overlay) ──────────────────
let liveProgress = {
  running: false,
  phase: "",
  current: 0,
  total: 0,
  logs: [],       // last N log lines
  stats: null,
}

// ─── Plugin entry ───────────────────────────────────────
export function apply(ctx) {
  // Register skill with hot-reload: re-reads SKILL.md on file change
  ctx.inject(['skills'], (sctx) => {
    const skillPath = join(parentRoot, 'agents', 'SKILL.md')
    let dispose = null

    function registerSkill() {
      try {
        const { description, body } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
        // Dispose previous registration (invalidates cache)
        if (dispose) dispose()
        dispose = sctx.skills.register({
          name: 'dsh-vue-auth-analyzer',
          source: 'bundled',
          description: description ?? 'Vue 3 button-permission-API mapping analyzer.',
          content: body,
          resourceBase: { kind: 'directory', path: packageRoot },
        })
      } catch (e) {
        console.error('[dsh-vue-auth-analyzer] Skill registration failed:', e?.message)
      }
    }

    // Initial registration
    registerSkill()

    // Watch for SKILL.md changes (poll every 5s, low overhead)
    let lastMtime = 0
    const watchTimer = setInterval(() => {
      try {
        const { mtimeMs } = statSync(skillPath)
        if (mtimeMs !== lastMtime) {
          lastMtime = mtimeMs
          registerSkill()
          console.log('[dsh-vue-auth-analyzer] SKILL.md reloaded')
        }
      } catch {}
    }, 5000)

    // Cleanup on plugin unload
    sctx.effect(() => () => {
      clearInterval(watchTimer)
      if (dispose) dispose()
    })
  })

  // Register settings via dynamic inject (graceful if settings service unavailable)
  ctx.inject(['settings'], (sctx) => {
    const base = {}
    try {
      const scriptCode = readFileSync(join(parentRoot, 'scripts', 'vue-auth-api-analyzer.mjs'), 'utf8')
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
    const scriptPath = join(parentRoot, 'scripts', 'vue-auth-api-analyzer.mjs')

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
        if (opts.runAi) args.push('--run-ai')
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

        // Reset progress state
        liveProgress = { running: true, phase: '', current: 0, total: 0, logs: [], stats: null }

        child.stdout.on('data', (chunk) => {
          response.write(chunk)
          // Parse NDJSON events to update live progress
          const text = chunk.toString()
          for (const line of text.split('\n')) {
            if (!line.trim()) continue
            try {
              const evt = JSON.parse(line)
              if (evt.type === 'phase') liveProgress.phase = evt.label
              if (evt.type === 'ai-start') { liveProgress.total = evt.total; liveProgress.current = 0 }
              if (evt.type === 'ai-progress') { liveProgress.current = evt.current; liveProgress.total = evt.total }
              if (evt.type === 'ai-done') liveProgress.stats = evt.stats
              // Keep last 50 log entries
              liveProgress.logs.push(evt)
              if (liveProgress.logs.length > 50) liveProgress.logs.shift()
            } catch {}
          }
        })

        child.stderr.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(l => l.trim())
          for (const line of lines) {
            response.write(JSON.stringify({ type: 'stderr', message: line }) + '\n')
          }
        })

        child.on('close', (code) => {
          activeRun = null
          liveProgress.running = false
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

    // GET /dsh-vue-auth-analyzer/progress — live progress for overlay
    host.register({
      kind: 'exact',
      path: '/dsh-vue-auth-analyzer/progress',
      handler: (request, response) => {
        response.writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        })
        response.end(JSON.stringify(liveProgress))
      },
    })
  })
}
