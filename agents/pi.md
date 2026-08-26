# Vue Auth-API Analyzer — Pi Agent Instructions

## When to Use

Trigger this tool when the user asks about:
- 按钮权限 / 权限扫描 / API映射 / v-auth分析 / 权限审计
- button permission / API mapping / auth scan / permission audit

## ⚠️ Critical Constraint

**MUST use the script pipeline.** Never manually analyze Vue source code, grep for permissions, or guess API endpoints. The script handles all analysis.

## Installation

### Quick start (no install needed)

Just run directly in your Vue project:

```bash
npx vue-auth-analyzer --run-ai
```

### Install as Pi Skill (optional, for auto-discovery)

If you want Pi to automatically discover and load this tool when you mention permissions or API mapping:

```bash
mkdir -p ~/.pi/agent/skills/vue-auth-analyzer/scripts && curl -sL https://raw.githubusercontent.com/xiaomingyu-git/dsh-vue-auth-analyzer/main/pi-skill/vue-auth-analyzer/SKILL.md -o ~/.pi/agent/skills/vue-auth-analyzer/SKILL.md && curl -sL https://raw.githubusercontent.com/xiaomingyu-git/dsh-vue-auth-analyzer/main/pi-skill/vue-auth-analyzer/package.json -o ~/.pi/agent/skills/vue-auth-analyzer/package.json && cd ~/.pi/agent/skills/vue-auth-analyzer && npm install
```

Then use `/skill:vue-auth-analyzer` in Pi, or just say "analyze button permissions".

### LLM Credentials

Check and set if missing:

```bash
echo $OPENAI_API_KEY $AI_API_KEY $DEEPSEEK_API_KEY
# If empty:
export OPENAI_API_KEY=sk-xxx
```

## Tool Discovery

After installation, find vue-auth-analyzer in priority order:
1. `npx vue-auth-analyzer --help`
2. `node_modules/vue-auth-analyzer/scripts/vue-auth-api-analyzer.mjs`
3. Path provided by user or environment variable `VUE_AUTH_ANALYZER_DIR`

## How to Run

### Single Command (Recommended)

```bash
cd <project-root> && npx vue-auth-analyzer --run-ai
```

Or with explicit path:

```bash
cd <project-root> && node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --run-ai
```

This automatically:
1. Runs static AST analysis on Vue SFC files
2. Prepares AI tasks for unmatched buttons
3. Calls LLM to analyze remaining buttons
4. Merges all results into final report

Do NOT add `--ndjson`. Let progress stream naturally.

### Reading Results

```bash
node -e "const d=require('.auth-analyzer/auth-mapping-merged.json'); console.log(JSON.stringify(d.stats, null, 2)); d.pages.forEach(p => { console.log('\n## ' + p.page); p.buttons.forEach(b => { const apis = b.apis.map(a => a.method + ' ' + a.url).join(', ') || '(UI only)'; console.log('  ' + b.authId + ' → ' + apis + ' [' + b.source + '/' + b.confidence + ']'); }); })"
```

Present: coverage stats, per-page mapping table, low-confidence entries, recommendations.

## What NOT to Do

- ❌ Read Vue files manually to find permissions
- ❌ Write Markdown reports (script outputs JSON)
- ❌ List function names as APIs (must be HTTP method + URL)
- ❌ Split pipeline into separate steps
- ❌ Write custom analysis scripts

## Output Location

All output in `.auth-analyzer/` under project root. Key file: `auth-mapping-merged.json`.

## Customization

Edit `CONFIG` in `scripts/vue-auth-api-analyzer.mjs`:
- `viewsDir` (default: `src/views`)
- `authDirectiveName` (default: `auth`; use `permission` for v-permission)
- `i18nFile` (default: `src/lang/package/zh-cn.ts`; set `null` to skip)
- `excludePatterns` (glob patterns to exclude from scanning)
