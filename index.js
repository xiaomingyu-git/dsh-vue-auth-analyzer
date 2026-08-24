// dsh-vue-auth-analyzer bundle entry point.
//
// Registers the Vue Auth-API Analyzer as an on-demand agent skill.
// The skill body is SKILL.md; its relative references resolve against
// the package directory through the directory resourceBase.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-vue-auth-analyzer'
export const inject = ['skills']

const packageRoot = dirname(fileURLToPath(import.meta.url))

function splitFrontmatter(text) {
  if (!text.startsWith('---\n')) return { description: undefined, body: text }
  const end = text.indexOf('\n---', 4)
  if (end < 0) return { description: undefined, body: text }
  const meta = text.slice(4, end)
  const body = text.slice(end + 4).replace(/^\n+/, '')
  const match = /^description:\s*(.+)$/m.exec(meta)
  return { description: match?.[1]?.trim(), body }
}

export function apply(ctx) {
  const skillPath = join(packageRoot, 'SKILL.md')
  const { description, body } = splitFrontmatter(readFileSync(skillPath, 'utf8'))
  ctx.effect(() =>
    ctx.skills.register({
      name: 'dsh-vue-auth-analyzer',
      source: 'bundled',
      description:
        description
        ?? 'Vue 3 button-permission-API mapping analyzer: static AST analysis + AI completion for generating complete permission-to-API mappings.',
      content: body,
      resourceBase: { kind: 'directory', path: packageRoot },
    }),
  )
}
