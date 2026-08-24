// dsh-vue-auth-analyzer bundle entry point.
// Registers agent skill + Settings namespace for GUI configuration.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

export const name = 'dsh-vue-auth-analyzer'
// No top-level inject: use ctx.inject() dynamically like dshmarket does.
// This ensures graceful degradation when services aren't available yet.

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
  aiBaseUrl: z.string().default('https://llm-ad4bzaba67piv4fj.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
    .description('LLM API base URL'),
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
}
