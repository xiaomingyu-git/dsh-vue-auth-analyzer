// dsh-vue-auth-analyzer bundle entry point.
//
// Registers:
// 1. Agent skill (SKILL.md) for AI-driven analysis
// 2. Settings namespace for GUI configuration of analyzer options

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-vue-auth-analyzer'
export const inject = ['skills', 'settings']

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

// ─── Settings schema (Schemastery) ──────────────────────
function createSettingsSchema(z) {
  return z.object({
    viewsDir: z.string().default('src/views')
      .description('Vue pages directory relative to project root'),
    authDirectiveName: z.string().default('auth')
      .description('Permission directive name (e.g. "auth" for v-auth, "permission" for v-permission)'),
    i18nFile: z.string().default('')
      .description('i18n translation file path (leave empty to skip i18n resolution)'),
    excludePatterns: z.string().default('**/components/**,**/login/**,**/profile/**')
      .description('Comma-separated glob patterns to exclude from scanning'),
    aiEnabled: z.boolean().default(true)
      .description('Enable AI completion for unmatched buttons'),
    aiModel: z.string().default('qwen3.7-max')
      .description('LLM model name for AI completion'),
    aiBaseUrl: z.string().default('https://llm-ad4bzaba67piv4fj.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')
      .description('LLM API base URL'),
    aiApiKey: z.string().role('secret').default('')
      .description('LLM API key (leave empty to auto-detect from ~/.dsh/.credentials.yaml)'),
    aiTemperature: z.number().default(0.1).min(0).max(1).step(0.05)
      .description('LLM temperature (lower = more deterministic)'),
    aiMaxRetries: z.natural().default(3)
      .description('Max retry attempts for failed LLM calls'),
  })
}

// ─── Write config back to script CONFIG ─────────────────
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
  const patternsStr = patterns.map(p => '"' + p + '"').join(', ')
  code = code.replace(
    /excludePatterns:\s*\[[^\]]*\]/,
    `excludePatterns: [${patternsStr}]`
  )

  writeFileSync(scriptPath, code, 'utf8')
}

// ─── Plugin entry ───────────────────────────────────────
export function apply(ctx) {
  // Register skill
  const skillPath = join(packageRoot, 'SKILL.md')
  const { description, body } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
  ctx.effect(() =>
    ctx.skills.register({
      name: 'dsh-vue-auth-analyzer',
      source: 'bundled',
      description:
        description
        ?? 'Vue 3 button-permission-API mapping analyzer with static AST analysis and AI completion.',
      content: body,
      resourceBase: { kind: 'directory', path: packageRoot },
    }),
  )

  // Register settings (graceful degradation if settings service unavailable)
  try {
    const z = require('@deepseek-ai/schemastery')
    const { installSettingsSection, settingsNamespace } = require('@deepseek-ai/dsh-settings')

    const ns = settingsNamespace('dsh-vue-auth-analyzer')
    const schema = createSettingsSchema(z)

    const base = {}
    try {
      const scriptCode = readFileSync(join(packageRoot, 'scripts', 'vue-auth-api-analyzer.mjs'), 'utf8')
      const viewsMatch = scriptCode.match(/viewsDir:\s*"([^"]*)"/)
      if (viewsMatch) base.viewsDir = viewsMatch[1]
      const authMatch = scriptCode.match(/authDirectiveName:\s*"([^"]*)"/)
      if (authMatch) base.authDirectiveName = authMatch[1]
    } catch {}

    installSettingsSection(ctx, ns, schema, base, {
      onChange: () => {
        try {
          const resolved = ctx.settings.get(ns)
          if (resolved) syncConfigToFile(resolved)
        } catch {}
      },
    })
  } catch {
    // Settings packages not available - skill-only mode
  }
}
