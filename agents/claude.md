# Vue Auth-API Analyzer v3 — Claude Code Instructions

## Trigger

Use when the user asks about: 按钮权限, 权限扫描, API映射, v-auth分析, 权限审计, button permission, API mapping, auth scan.

## ⚠️ Mandatory Rule

**You MUST run the script pipeline.** Do NOT manually analyze Vue source code. All analysis is performed by `scripts/vue-auth-api-analyzer.mjs`.

## Architecture (v3 AI-First)

- Static analysis only collects context (template structure, call graph, imports)
- ALL permission + API mapping analysis is done by AI
- No more matched/unmatched distinction — every button goes to AI

## Installation

Before running analysis, check if the tool is installed. **If not, install it for the user:**

```bash
cd <project-root>
npm install --save-dev vue-auth-analyzer
```

Verify installation:

```bash
npx vue-auth-analyzer --help
```

Alternative — run without installing (auto-downloads on first use):

```bash
npx vue-auth-analyzer --run-ai
```

### LLM Credentials

Check if API credentials are available:

```bash
echo $OPENAI_API_KEY $ANTHROPIC_API_KEY $AI_API_KEY $DEEPSEEK_API_KEY
```

If all empty, prompt the user to set one:

```bash
export OPENAI_API_KEY=sk-xxx      # OpenAI
export ANTHROPIC_API_KEY=sk-ant-xxx  # Anthropic
export DEEPSEEK_API_KEY=sk-xxx    # DeepSeek
export AI_API_KEY=sk-xxx          # Generic
```

## Finding the Tool

After installation, locate vue-auth-analyzer in this order:
1. `npx vue-auth-analyzer --help` — works if npm-installed
2. `node_modules/vue-auth-analyzer/scripts/vue-auth-api-analyzer.mjs`
3. User-provided path

Store as `<tool-dir>` for subsequent commands.

## Execution Steps

### Step 1: Run Analysis (single command)

```bash
cd <project-root> && node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --run-ai
```

Or via npx:

```bash
cd <project-root> && npx vue-auth-analyzer --run-ai
```

This handles everything automatically:
1. Context collection (Vue SFC parsing, template structure, call graph, imports)
2. Module grouping and AI task preparation (all buttons included)
3. LLM-powered permission + API analysis for every button
4. Merging AI results into final report

**Do NOT use --ndjson** — let progress output stream naturally.

Credentials are auto-detected from environment variables or config files.

### Step 2: Present Results

Read the report using bash (not the Read tool, which adds line numbers):

```bash
node -e "const d=require('.auth-analyzer/auth-mapping-merged.json'); console.log(JSON.stringify(d.stats, null, 2)); d.pages.forEach(p => { console.log('\n## ' + p.page); p.buttons.forEach(b => { const apis = b.apis.map(a => a.method + ' ' + a.url).join(', ') || '(UI only)'; console.log('  ' + b.authId + ' → ' + apis + ' [ai/' + b.confidence + ']'); }); })"
```

Present:
1. Coverage statistics
2. Per-page button-permission-API mapping table
3. Low-confidence entries
4. Recommendations

## Forbidden Actions

- ❌ Manually reading Vue files to find permissions or APIs
- ❌ Generating Markdown reports (all output is script-generated JSON)
- ❌ Listing function names as API mappings ("app.getAppsList" ≠ "GET /iam/apps")
- ❌ Running --static-only / --prepare-ai / --merge-ai separately
- ❌ Writing custom analysis or merge scripts

## Output Files

All in `.auth-analyzer/` under the project root:

| File | Purpose |
|------|---------|
| `auth-mapping-merged.json` | Final merged report (AI analysis) |
| `static/<module>.json` | Per-module context (structure, imports, call graph) |
| `ai-tasks/<module>.json` | Per-module AI task files (with prompts) |
| `ai-results/<module>.json` | Per-module AI analysis results |
| `.ai-auth-cache.json` | Incremental cache |

## Configuration

Modify `CONFIG` in `scripts/vue-auth-api-analyzer.mjs`:

| Setting | Default | Description |
|---------|---------|-------------|
| `viewsDir` | `src/views` | Vue pages directory |
| `authDirectiveName` | `auth` | Use `permission` for v-permission |
| `i18nFile` | `src/lang/package/zh-cn.ts` | Set `null` to skip i18n |
| `excludePatterns` | `["**/components/**", ...]` | Directories to exclude |
