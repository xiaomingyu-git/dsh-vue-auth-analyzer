# Vue Auth-API Analyzer — Cursor Rules

## Description

When the user asks about button permissions, API mapping, v-auth analysis, permission auditing, or auth scanning in a Vue 3 project, use the vue-auth-analyzer tool.

## ⚠️ Critical Rule

You MUST use the script pipeline. Do NOT manually analyze Vue source code, grep for permission codes, or guess API endpoints.

## Installation

If the tool is not yet installed, **install it automatically for the user:**

```bash
cd <project-root>
npm install --save-dev vue-auth-analyzer
```

Verify:

```bash
npx vue-auth-analyzer --help
```

Or run without installing (auto-downloads):

```bash
npx vue-auth-analyzer --run-ai
```

### LLM Credentials

If `--run-ai` fails with credential errors, check and set:

```bash
echo $OPENAI_API_KEY $AI_API_KEY $DEEPSEEK_API_KEY
# If empty, set one:
export OPENAI_API_KEY=sk-xxx
```

## Tool Location

After installation, find the tool at one of these locations (in priority order):
1. `npx vue-auth-analyzer` (if installed globally or via npx)
2. `node_modules/vue-auth-analyzer/scripts/vue-auth-api-analyzer.mjs`
3. Path provided by the user in conversation

## Workflow

### 1. Run Full Analysis

```bash
cd <project-root> && npx vue-auth-analyzer --run-ai
```

This single command performs:
- Static AST analysis (Vue SFC → v-auth → @click → handler → request() → HTTP URL)
- AI completion for unmatched buttons
- Result merging

Do NOT add `--ndjson`. Let progress stream to the conversation.

### 2. Present Results

```bash
node -e "const d=require('.auth-analyzer/auth-mapping-merged.json'); console.log(JSON.stringify(d.stats, null, 2)); d.pages.forEach(p => { console.log('\n## ' + p.page); p.buttons.forEach(b => { const apis = b.apis.map(a => a.method + ' ' + a.url).join(', ') || '(UI only)'; console.log('  ' + b.authId + ' → ' + apis + ' [' + b.source + '/' + b.confidence + ']'); }); })"
```

Show: coverage stats, per-page mapping table, low-confidence entries, recommendations.

## Prohibited Actions

- ❌ Reading Vue files manually to find permissions
- ❌ Generating Markdown reports (script generates JSON)
- ❌ Listing function names instead of HTTP APIs
- ❌ Running pipeline steps separately (use --run-ai)
- ❌ Writing custom analysis scripts

## Output

All output in `.auth-analyzer/` directory. Final report: `auth-mapping-merged.json`.

## Configuration

Key settings in `scripts/vue-auth-api-analyzer.mjs` CONFIG:
- `viewsDir`: Vue pages directory (default: `src/views`)
- `authDirectiveName`: Directive name (default: `auth`, use `permission` for v-permission)
- `i18nFile`: i18n translation file (default: `src/lang/package/zh-cn.ts`, set null to skip)
