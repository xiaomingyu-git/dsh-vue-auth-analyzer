# Vue Auth-API Analyzer v3 — Cursor Rules

## Architecture (v3 AI-First)

- Static analysis only collects context (template structure, call graph, imports)
- ALL permission + API mapping analysis is done by AI
- No more matched/unmatched distinction — every button goes to AI

## Trigger

Use when the user asks about: 按钮权限, 权限扫描, API映射, v-auth分析, 权限审计, button permission, API mapping, auth scan.

## ⚠️ Mandatory Rule

**You MUST run the script pipeline.** Do NOT manually analyze Vue source code. All analysis is performed by `scripts/vue-auth-api-analyzer.mjs`.

## Installation

```bash
cd <project-root> && npm install --save-dev dsh-vue-auth-analyzer
```

Verify: `npx dsh-vue-auth-analyzer --help`

### LLM Credentials

```bash
echo $OPENAI_API_KEY $ANTHROPIC_API_KEY $AI_API_KEY $DEEPSEEK_API_KEY
```

If empty, set one: `export DEEPSEEK_API_KEY=sk-xxx`

## Execution

### Step 1: Run Analysis (single command)

```bash
cd <project-root> && npx dsh-vue-auth-analyzer --run-ai
```

This handles everything:
1. Context collection (Vue SFC parsing, template structure, call graph, imports)
2. Module grouping and AI task preparation (all buttons included)
3. LLM-powered permission + API analysis for every button
4. Merging AI results into final report

**Do NOT use --ndjson.**

### Step 2: Present Results

```bash
node -e "const d=require('.auth-analyzer/auth-mapping-merged.json'); console.log(JSON.stringify(d.stats, null, 2)); d.pages.forEach(p => { console.log('\n## ' + p.page); p.buttons.forEach(b => { const apis = b.apis.map(a => a.method + ' ' + a.url).join(', ') || '(UI only)'; console.log('  ' + b.authId + ' → ' + apis + ' [ai/' + b.confidence + ']'); }); })"
```

## Forbidden Actions

- ❌ Manually reading Vue files to find permissions or APIs
- ❌ Generating Markdown reports
- ❌ Listing function names as API mappings
- ❌ Running steps separately — use --run-ai
- ❌ Writing custom analysis scripts

## Output Files

| File | Purpose |
|------|---------|
| `auth-mapping-merged.json` | Final merged report |
| `static/<module>.json` | Per-module context |
| `ai-tasks/<module>.json` | AI task files |
| `ai-results/<module>.json` | AI results |
| `.ai-auth-cache.json` | Cache |