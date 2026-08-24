# dsh-vue-auth-analyzer

**Vue 3 Button-Permission-API Mapping Analyzer** — a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that scans your Vue project and generates a complete mapping of buttons → permission directives → backend API endpoints.

[中文文档](README.zh.md)

## What It Does

Given a Vue 3 project with permission directives (e.g. `v-auth`), this tool:

1. **Static AST Analysis** — Parses Vue SFC templates and scripts to trace `v-auth` → `@click handler` → `request()` → `URL + method`. Also detects `router.push` / `window.open` navigation actions. Zero cost, no AI needed.
2. **AI Completion** — For buttons the static analysis can't resolve (cross-component dialogs, non-standard triggers), calls an LLM to analyze source code and fill in the gaps.
3. **Merged Report** — Combines both into a single `auth-mapping-merged.json` with coverage stats.

### Example Output

```json
{
  "stats": {
    "totalButtons": 92,
    "staticMatched": 71,
    "aiMatched": 15,
    "uiOnly": 6,
    "coverage": "93.5%"
  }
}
```

## Installation

### As a DSH Plugin

```bash
dsh plugin --profile web add github:<your-org>/dsh-vue-auth-analyzer
```

Then ask DSH: *"Scan my project's button permissions and API mappings"*

### Standalone (without DSH)

```bash
git clone https://github.com/<your-org>/dsh-vue-auth-analyzer.git
cd dsh-vue-auth-analyzer
npm install
node scripts/vue-auth-api-analyzer.mjs --static-only
```

## Configuration

Edit the `CONFIG` object at the top of `scripts/vue-auth-api-analyzer.mjs`:

| Key | Default | Description |
|-----|---------|-------------|
| `viewsDir` | `src/views` | Vue pages directory |
| `authDirectiveName` | `auth` | Permission directive name (`v-auth`, `v-permission`, etc.) |
| `i18nFile` | `null` | i18n translation file path for label resolution |
| `excludePatterns` | `["**/components/**", ...]` | Glob patterns to exclude |
| `ai.enabled` | `true` | Enable AI completion |
| `ai.model` | `qwen3.7-max` | LLM model name |
| `ai.apiKey` | `""` | API key (or set `AI_API_KEY` env var) |

## CLI Usage

```bash
node scripts/vue-auth-api-analyzer.mjs                  # Full analysis (static + AI)
node scripts/vue-auth-api-analyzer.mjs --static-only     # Static only (no AI)
node scripts/vue-auth-api-analyzer.mjs --ai-only         # AI completion only
node scripts/vue-auth-api-analyzer.mjs --no-cache        # Clear AI cache
node scripts/vue-auth-api-analyzer.mjs --help            # Show help
```

## Output Files

| File | Description |
|------|-------------|
| `dist/auth-mapping-merged.json` | **Primary output**: merged results with coverage stats |
| `dist/auth-mapping.json` | Raw static analysis results with trace info |
| `dist/auth-mapping-ai.json` | AI completion results with reasoning |
| `dist/.ai-auth-cache.json` | Incremental AI cache |

## Action Types

| Method | Meaning |
|--------|---------|
| GET/POST/PUT/DELETE/PATCH | HTTP API call |
| NAVIGATE | Page navigation (router.push / window.open) |
| *(empty apis array)* | Pure frontend UI action (dialog, local validation) |

## Adapting to Your Project

- **Different directive**: Change `CONFIG.authDirectiveName` to `"permission"`, `"has"`, etc.
- **Different HTTP wrapper**: Modify `resolveApiCall()` to recognize your wrapper function
- **No i18n**: Leave `CONFIG.i18nFile = null`
- **Non-Element Plus**: Works with any Vue 3 UI framework

## Requirements

- Node.js ≥ 22
- Dependencies: `@babel/parser`, `@vue/compiler-sfc`, `@vue/compiler-dom`, `fast-glob`

## License

MIT
