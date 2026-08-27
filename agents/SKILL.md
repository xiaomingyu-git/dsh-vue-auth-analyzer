---
name: vue-auth-analyzer
description: ⚠️ MUST run script pipeline (node scripts/vue-auth-api-analyzer.mjs), do NOT manually analyze source. For 按钮权限、权限扫描、API映射、v-auth分析、权限审计、button permission、API mapping、auth scan.
---

# Vue Auth-API Analyzer v3 (AI-First)

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`) 的按钮，通过 **静态上下文收集 + AI 全量分析**，生成完整的 **按钮 → 权限标识 → HTTP API** 映射报告。

## 核心架构（v3）

- **静态分析仅收集上下文**：解析模板结构、构建调用图骨架、收集导入关系和文件内容
- **AI 负责全部权限+API分析**：所有按钮都交由 AI 分析，不再区分"已匹配/未匹配"
- 静态分析不再尝试解析 HTTP URL，只提供结构化上下文给 AI 作为推理依据

## ⛔ 禁止事项（违反则结果无效）

- **禁止自己手动分析源码** — 不要自己读 Vue 文件、grep 权限码、猜测 API
- **禁止生成 Markdown 报告** — 不要写 .md 文件，所有输出由脚本生成 JSON
- **禁止只列函数名** — "app.getAppsList" 不是 API 映射，必须是 "GET /iam/apps"
- **禁止跳过步骤** — 必须按 Step 1→2 顺序执行
- **禁止自己写合并/分析脚本** — 只用本工具提供的脚本命令
- **禁止分步运行 --static-only / --prepare-ai / --merge-ai** — 用 --run-ai 一条命令搞定

## 安装（首次使用时自动执行）

在执行分析前，先确认工具已安装。如果未安装，**主动帮用户安装**：

```bash
# 在用户的 Vue 项目根目录下执行
npm install --save-dev vue-auth-analyzer
```

安装完成后验证：

```bash
npx vue-auth-analyzer --help
```

如果用户不想修改 package.json，也可以用 npx 免安装运行（首次会自动下载）：

```bash
npx vue-auth-analyzer --run-ai
```

### LLM 凭证配置

`--run-ai` 模式需要 LLM API 凭证。检查是否已配置：

```bash
echo $OPENAI_API_KEY $AI_API_KEY $DEEPSEEK_API_KEY
```

如果都为空，提示用户设置环境变量（任选一个）：

```bash
export OPENAI_API_KEY=sk-xxx    # OpenAI
export DEEPSEEK_API_KEY=sk-xxx  # DeepSeek
export AI_API_KEY=sk-xxx        # 通用
```

## 定位工具路径

安装后按以下优先级查找工具：

1. `npx vue-auth-analyzer --help` — 如果可用，直接用 npx
2. `node_modules/vue-auth-analyzer/scripts/vue-auth-api-analyzer.mjs` — npm 安装
3. 环境变量 `VUE_AUTH_ANALYZER_DIR` 指向的安装目录
4. 当前对话上下文中提供的路径

找到后记为 `<tool-dir>`。

## 执行流程

### Step 1: 运行分析（一条命令完成全部工作）

```bash
cd <project-root> && node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --run-ai
```

或者如果通过 npx 安装：

```bash
cd <project-root> && npx vue-auth-analyzer --run-ai
```

**不要加 --ndjson**，让进度直接输出到对话中，用户可以实时看到。

这条命令自动完成以下所有工作：
1. **上下文收集**：解析 Vue SFC 模板结构、构建函数调用图、收集导入关系和相关文件
2. 按模块分组，准备 AI 任务文件（所有按钮都包含在内）
3. 调用 LLM 分析每个按钮的权限-API 映射
4. 合并 AI 结果为最终报告

凭证自动从环境变量或配置文件读取，无需手动配置。

**不要自己读任务文件、不要自己启动 subagent、不要自己写合并脚本、不要分步执行。**

### Step 2: 汇报

**用 bash 读取报告**（不要用 read tool，它会加行号导致 JSON 解析失败）：

```bash
node -e "const d=require('.auth-analyzer/auth-mapping-merged.json'); console.log(JSON.stringify(d.stats, null, 2)); d.pages.forEach(p => { console.log('\n## ' + p.page); p.buttons.forEach(b => { const apis = b.apis.map(a => a.method + ' ' + a.url).join(', ') || '(纯UI)'; console.log('  ' + b.authId + ' → ' + apis + ' [ai/' + b.confidence + ']'); }); })"
```

向用户展示：
1. 覆盖率统计
2. 每页按钮-权限-API 映射表（包含 HTTP method + URL）
3. 低置信度条目
4. 建议

## 输出文件

| 文件 | 用途 |
|------|------|
| `.auth-analyzer/auth-mapping-merged.json` | **最终合并报告** |
| `.auth-analyzer/static/index.json` | 上下文收集索引 |
| `.auth-analyzer/static/<module>.json` | 每模块上下文（模板结构、导入、调用图） |
| `.auth-analyzer/ai-tasks/index.json` | AI 任务索引 |
| `.auth-analyzer/ai-tasks/<module>.json` | 每模块 AI 任务（含 prompt） |
| `.auth-analyzer/ai-results/<module>.json` | 每模块 AI 结果 |
| `.auth-analyzer/auth-mapping-ai.json` | AI 分析汇总 |
| `.auth-analyzer/.ai-auth-cache.json` | 增量缓存 |

## 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 文件，`null` 跳过 |
| `excludePatterns` | `["**/components/**", ...]` | 排除目录 |

## 适配

- **v-permission**: 搜索 `prop.name === "auth"` 替换为 `"permission"`
- **无 i18n**: `CONFIG.i18nFile = null`

## 开发者文档

如果你需要**修改本工具本身**（而非使用它分析项目），请阅读 `AGENTS.md`。
