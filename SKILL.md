---
name: dsh-vue-auth-analyzer
description: ⚠️ MUST run script pipeline (node scripts/vue-auth-api-analyzer.mjs), do NOT manually analyze source. For 按钮权限、权限扫描、API映射、v-auth分析、权限审计、button permission、API mapping、auth scan.
---

# Vue Auth-API Analyzer

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → HTTP API** 映射报告。

## ⛔ 禁止事项（违反则结果无效）

- **禁止自己手动分析源码** — 不要自己读 Vue 文件、grep 权限码、猜测 API
- **禁止生成 Markdown 报告** — 不要写 .md 文件，所有输出由脚本生成 JSON
- **禁止只列函数名** — "app.getAppsList" 不是 API 映射，必须是 "GET /iam/apps"
- **禁止跳过任何步骤** — 必须按 Step 1→2→3→4→5 顺序执行
- **禁止自己写合并/分析脚本** — 只用本插件提供的脚本命令

## ✅ 你必须做的

使用本插件的脚本工具完成分析。脚本会：
1. AST 解析 Vue SFC，精确追踪 @click → handler → request() → HTTP method + URL
2. 按模块分组，通过 subagent 并发补全静态分析未覆盖的按钮
3. 自动合并生成结构化 JSON 报告

## 执行流程（严格按顺序，不可跳过）

### Step 1: 静态分析

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --static-only --ndjson
```

输出 `.auth-analyzer/auth-mapping.json` + `.auth-analyzer/static/<module>.json`。
**只产出静态结果，不做合并。**

### Step 2: 准备 AI 任务

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson
```

输出 `.auth-analyzer/ai-tasks/index.json` + 每模块任务文件。
**只产出任务文件，不做合并。**

读取 `.auth-analyzer/ai-tasks/index.json`，检查 `pendingModules`：
- **0** → 跳到 Step 5
- **> 0** → 继续 Step 3

### Step 3: AI 分析（一条命令搞定）

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --run-ai --ndjson
```

这条命令会自动完成：准备任务 → 调 LLM 分析 → 写入结果 → 合并报告。
凭证自动从 `~/.dsh/.credentials.yaml` 读取，无需手动配置。
已有结果的模块自动跳过，不会浪费 token。

**不要自己读任务文件、不要自己启动 subagent、不要自己写合并脚本。**

### Step 4: 汇报


### Step 5: 汇报

读取 `.auth-analyzer/auth-mapping-merged.json`，向用户展示：
1. 覆盖率统计
2. 每页按钮-权限-API 映射表（包含 HTTP method + URL）
3. 低置信度/失败条目
4. 建议

## 输出文件

| 文件 | 用途 |
|------|------|
| `.auth-analyzer/static/index.json` | 静态分析索引（小文件） |
| `.auth-analyzer/static/<module>.json` | 每模块静态分析结果 |
| `.auth-analyzer/auth-mapping-merged.json` | **最终合并报告** |
| `.auth-analyzer/auth-mapping-ai.json` | AI 补全汇总 |
| `.auth-analyzer/ai-tasks/index.json` | AI 任务索引（小文件） |
| `.auth-analyzer/ai-tasks/<module>.json` | 每模块 AI 任务（含 prompt） |
| `.auth-analyzer/ai-results/<module>.json` | 每模块 AI 结果 |
| `.auth-analyzer/.ai-auth-cache.json` | 增量缓存 |

## 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 文件，`null` 跳过 |
| `excludePatterns` | `["**/components/**", ...]` | 排除目录 |

## 适配

- **v-permission**: 搜索 `prop.name === "auth"` 替换为 `"permission"`
- **非 request()**: 修改 `resolveApiCall` 识别你的封装函数
- **无 i18n**: `CONFIG.i18nFile = null`

## 开发者文档

如果你需要**修改本插件本身**（而非使用它分析项目），请阅读 `AGENTS.md`。

关键规则：
- **`metadata.json` 是文档单一数据源**。CLI flags、配置字段、输出文件列表、版本号都由它驱动
- `printHelp()` 和 `index.js` schema 从 metadata.json 动态生成，不要硬编码
- 新增 flag → 改 metadata.json + parseArgs() + main()，printHelp 自动更新
- 新增配置 → 改 metadata.json + CONFIG + client locale/DEFAULTS/表单，schema 自动更新
- 升版本 → 改 metadata.json + package.json
