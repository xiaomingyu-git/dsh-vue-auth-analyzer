# vue-auth-analyzer

> Vue 3 按钮-权限-API 映射分析器 · 静态 AST 分析 + AI 补全

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → HTTP API** 映射报告。

## 快速开始

```bash
# 在你的 Vue 3 项目根目录下运行
npx vue-auth-analyzer --run-ai
```

一条命令完成全部工作：
1. 静态 AST 分析（解析 Vue SFC，追踪 v-auth → @click → request() → HTTP method + URL）
2. 按模块分组，准备 AI 任务文件
3. 调用 LLM 分析未匹配的按钮（已有结果的模块自动跳过）
4. 合并静态结果 + AI 结果为最终报告

输出在 `.auth-analyzer/auth-mapping-merged.json`。

## 安装

### npm 安装（推荐）

```bash
npm install vue-auth-analyzer
# 或全局安装
npm install -g vue-auth-analyzer
```

### 从源码使用

```bash
git clone https://github.com/xiaomingyu-git/dsh-vue-auth-analyzer.git
cd dsh-vue-auth-analyzer
npm install
```

## CLI 用法

```bash
vue-auth-analyzer [options]
# 或
node node_modules/vue-auth-analyzer/scripts/vue-auth-api-analyzer.mjs [options]
```

| 命令 | 说明 | 输出 |
|------|------|------|
| `--run-ai` | **完整分析**（静态 + AI + 合并，推荐） | `auth-mapping-merged.json` |
| `--static-only` | 仅静态 AST 分析 | `.auth-analyzer/static/` |
| `--prepare-ai` | 准备 AI 任务文件 | `.auth-analyzer/ai-tasks/` |
| `--merge-ai` | 合并 AI 结果 + 静态结果 | `auth-mapping-merged.json` |
| `--no-cache` | 清除缓存后重新分析 | （配合其他命令使用） |
| `--ndjson` | 输出 NDJSON 进度事件 | （配合任意命令使用） |
| `-h, --help` | 显示帮助 | — |

### 分步执行（高级用法）

```bash
# Step 1: 静态分析
vue-auth-analyzer --static-only --ndjson

# Step 2: 准备 AI 任务
vue-auth-analyzer --prepare-ai --ndjson

# Step 3: AI 分析（由 agent 或 --run-ai 执行）
vue-auth-analyzer --run-ai --ndjson

# Step 4: 合并结果
vue-auth-analyzer --merge-ai --ndjson
```

## Agent 平台集成

本工具提供多个 agent 平台的指令文件，位于 `agents/` 目录：

### OpenAI Codex / ChatGPT

将 `agents/codex.md` 的内容添加到你的 Codex 指令或 ChatGPT 自定义指令中。

### Cursor

将 `agents/cursor.md` 的内容添加到项目的 `.cursorrules` 文件中。

### Claude Code

将 `agents/claude.md` 的内容添加到项目的 `CLAUDE.md` 文件中。

### Pi (Native Skill)

Pi 原生支持 Agent Skills 标准，可以一键安装：

```bash
# 全局安装（所有项目可用）
git clone https://github.com/xiaomingyu-git/dsh-vue-auth-analyzer.git /tmp/vue-auth-analyzer
cp -r /tmp/vue-auth-analyzer/pi-skill/vue-auth-analyzer ~/.pi/agent/skills/vue-auth-analyzer
cd ~/.pi/agent/skills/vue-auth-analyzer && npm install
rm -rf /tmp/vue-auth-analyzer
```

安装后在 Pi 中使用 `/skill:vue-auth-analyzer` 或直接说「分析按钮权限」即可自动触发。

也可以将 `agents/pi.md` 的内容手动添加到 Pi 的指令配置中。

### DeepSeek Harness (DSH)

作为 DSH 插件安装：

```bash
dsh plugin --profile web add github:xiaomingyu-git/dsh-vue-auth-analyzer
```

DSH 适配层在 `dsh/` 子目录中，包含 GUI 配置面板、skill 热加载和 HTTP API。

## 工作原理

采用**双轨分析**架构：

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: 静态 AST 分析（零 AI 成本）                      │
│  解析 Vue SFC 模板 + 脚本                                 │
│  追踪 v-auth → @click → handler → request() → URL+method │
│  输出: .auth-analyzer/static/<module>.json                │
└──────────────────────┬──────────────────────────────────┘
                       │ 未匹配 + 部分解析的按钮
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: 准备 AI 任务                                     │
│  按模块分组，每个模块生成一个任务文件                        │
│  包含：完整源码 + 已确认按钮作为参考锚点                    │
│  ⚠️ 部分解析按钮附带 import 路径/函数名作为线索             │
│  输出: .auth-analyzer/ai-tasks/<module>.json              │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: AI 分析                                         │
│  --run-ai 模式：脚本直接调 LLM（支持并发控制）              │
│  或由各 agent 平台读取 task 文件执行                       │
│  输出: .auth-analyzer/ai-results/<module>.json            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: 合并结果                                         │
│  静态结果 + AI 结果 → 统一映射表                           │
│  静态优先；partial + AI → source: "static+ai"             │
│  输出: .auth-analyzer/auth-mapping-merged.json            │
└─────────────────────────────────────────────────────────┘
```

### 核心特性

- **静态 AST 分析**：精确追踪 `@click` → handler → `request()` → HTTP method + URL，含跨组件弹窗/抽屉穿透
- **Partial match 补全**：静态追踪到 import 路径但未解析出 HTTP URL 的按钮，标记为 ⚠️ 部分解析，交由 AI 利用线索补全
- **AI 补全**：对静态分析未覆盖的按钮，通过 LLM 分析源码补全映射
- **Plan A 全模块上下文**：AI 收到模块内所有按钮（✅已确认 + ⚠️部分解析 + ❓待分析），已确认按钮作为推理锚点
- **增量缓存**：已分析的模块自动跳过，支持 `--no-cache` 强制重分析
- **Per-module 文件结构**：所有中间产物按模块拆分，避免单文件过大
- **多平台支持**：CLI / Codex / Cursor / Claude Code / Pi / DSH

## 输出文件

所有输出默认在项目根目录的 `.auth-analyzer/` 下：

| 文件 | 说明 |
|------|------|
| `auth-mapping-merged.json` | **最终合并报告**（静态 + AI） |
| `static/index.json` | 静态分析索引 |
| `static/<module>.json` | 每模块静态分析结果（含 trace 调用链） |
| `ai-tasks/index.json` | AI 任务索引 |
| `ai-tasks/<module>.json` | 每模块 AI 任务（含完整 prompt + 源码） |
| `ai-results/<module>.json` | 每模块 AI 分析结果 |
| `auth-mapping-ai.json` | AI 补全汇总 |
| `.ai-auth-cache.json` | 增量缓存 |

### merged.json 结构

```json
{
  "stats": {
    "totalButtons": 403,
    "staticMatched": 271,
    "aiMatched": 39,
    "uiOnly": 35,
    "coverage": "76.9%"
  },
  "pages": [
    {
      "page": "/apps",
      "buttons": [
        {
          "authId": "iam.app.add",
          "label": "新建",
          "apis": [{"method": "POST", "url": "/iam/apps", "apiFunction": "saveAppRecord"}],
          "source": "ai",
          "confidence": "high",
          "reasoning": "新建按钮 → 打开 AddModal → 确认按钮 → handleSubmit → POST /iam/apps"
        }
      ]
    }
  ]
}
```

### source 字段说明

| 值 | 含义 |
|----|------|
| `static` | 静态 AST 分析匹配（高置信度） |
| `ai` | AI 分析匹配 |
| `static+ai` | 静态追踪到 import 路径，AI 补全了真实 HTTP URL |
| `unresolved` | 未匹配到任何 API |

## 凭证配置

`--run-ai` 模式需要 LLM API 凭证，按以下优先级自动检测：

1. **CONFIG 配置**：编辑 `scripts/vue-auth-api-analyzer.mjs` 中的 `CONFIG.ai`
2. **环境变量**：`AI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY`
3. **配置文件**：
   - `~/.config/vue-auth-analyzer/credentials.yaml`
   - `~/.dsh/.credentials.yaml`（向后兼容）

Base URL 和模型也会根据检测到的凭证类型自动设置。

## 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录（相对于项目根目录） |
| `authDirectiveName` | `auth` | 权限指令名（`v-auth` 中的 `auth`） |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 翻译文件路径，留空跳过 |
| `excludePatterns` | `**/components/**,**/login/**,**/profile/**` | 排除的 glob 模式 |
| `ai.enabled` | `true` | 是否启用 AI 补全 |
| `ai.concurrency` | `2` | `--run-ai` 模式下最大并发 LLM 调用数 |

## 适配其他项目

### 使用 v-permission 而非 v-auth

在脚本中搜索 `prop.name === "auth"` 替换为 `prop.name === "permission"`。

### 使用 axios 直接调用而非 request()

修改 `resolveApiCall` 函数，增加对 `axios.get/post/put/delete` 的识别。

### 没有 i18n

设置 `CONFIG.i18nFile = null`。

### 非 Element Plus 项目

脚本不依赖 Element Plus，任何 Vue 3 项目都可用。

## 技术栈

- **运行时**: Node.js ≥ 22
- **AST 解析**: @babel/parser + @vue/compiler-sfc + @vue/compiler-dom
- **文件匹配**: fast-glob
- **AI 执行**: 脚本直调 OpenAI 兼容 API（--run-ai 模式）

## License

MIT
