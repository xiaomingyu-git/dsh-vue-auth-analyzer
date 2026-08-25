# dsh-vue-auth-analyzer

> Vue 3 按钮-权限-API 映射分析器 · [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → HTTP API** 映射报告。

## 工作原理

采用**双轨分析**架构：

```
┌─────────────────────────────────────────────────────────┐
│  Step 1: 静态 AST 分析（零 AI 成本）                      │
│  解析 Vue SFC 模板 + 脚本                                 │
│  追踪 v-auth → @click → handler → request() → URL+method │
│  输出: .auth-analyzer/static/<module>.json                │
└──────────────────────┬──────────────────────────────────┘
                       │ 未匹配的按钮
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: 准备 AI 任务                                     │
│  按模块分组，每个模块生成一个任务文件                        │
│  包含：完整源码 + 已确认按钮作为参考锚点                    │
│  输出: .auth-analyzer/ai-tasks/<module>.json              │
└──────────────────────┬──────────────────────────────────┘
                       │ 每批 2 个任务
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: DSH Subagent 并发分析                            │
│  Agent 分批启动 subagent（每批 ≤2 个，避免 429 限流）      │
│  每个 subagent 分析一个模块，穿透弹窗/抽屉追踪到实际 API    │
│  输出: .auth-analyzer/ai-results/<module>.json            │
└──────────────────────┬──────────────────────────────────┘
                       │ 全部完成后
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: 合并结果                                         │
│  静态结果 + AI 结果 → 统一映射表                           │
│  静态优先（已确认的不被 AI 覆盖）                           │
│  输出: .auth-analyzer/auth-mapping-merged.json            │
└─────────────────────────────────────────────────────────┘
```

### 核心特性

- **静态 AST 分析**：精确追踪 `@click` → handler → `request()` → HTTP method + URL，含跨组件弹窗/抽屉穿透
- **AI 补全**：对静态分析未覆盖的按钮，通过 DSH subagent 并发分析源码补全映射
- **Plan A 全模块上下文**：AI 收到模块内所有按钮（已确认 ✅ + 待分析 ❓），已确认按钮作为推理锚点
- **增量缓存**：已分析的模块自动跳过，支持 `--no-cache` 强制重分析
- **Per-module 文件结构**：所有中间产物按模块拆分，避免单文件过大导致 agent 解析失败
- **GUI 配置面板**：DSH 设置页面中可直接配置参数、运行分析、查看进度、取消/重试
- **SKILL.md 热加载**：更新 SKILL.md 后无需重启 DSH，5 秒内自动生效

## 安装

### 作为 DSH 插件

```bash
dsh plugin --profile web add github:xiaomingyu-git/dsh-vue-auth-analyzer
```

安装后在 DSH 对话中说「分析按钮权限」或「扫描 API 映射」即可触发。

### 独立使用（不依赖 DSH）

```bash
git clone https://github.com/xiaomingyu-git/dsh-vue-auth-analyzer.git
cd dsh-vue-auth-analyzer
npm install
```

## CLI 用法

```bash
# 在项目根目录下运行
node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs [options]
```

| 命令 | 说明 | 输出 |
|------|------|------|
| `--static-only` | 仅静态 AST 分析 | `.auth-analyzer/static/` + `auth-mapping.json` |
| `--prepare-ai` | 准备 AI 任务文件 | `.auth-analyzer/ai-tasks/` |
| `--merge-ai` | 合并 AI 结果 + 静态结果 | `auth-mapping-merged.json` |
| `--no-cache` | 清除缓存后重新准备任务 | （配合 `--prepare-ai` 使用） |
| `--ndjson` | 输出 NDJSON 进度事件 | （配合任意命令使用） |

### 完整流程示例

```bash
# Step 1: 静态分析
node scripts/vue-auth-api-analyzer.mjs --static-only --ndjson

# Step 2: 准备 AI 任务
node scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson

# Step 3: (由 DSH agent 通过 subagent 并发执行，手动使用时跳过此步)

# Step 4: 合并结果
node scripts/vue-auth-api-analyzer.mjs --merge-ai --ndjson
```

## 输出文件

所有输出默认在项目根目录的 `.auth-analyzer/` 下（不会被项目构建清理）：

| 文件 | 说明 |
|------|------|
| `static/index.json` | 静态分析索引（小文件，页面列表 + 按钮统计） |
| `static/<module>.json` | 每模块静态分析结果（含 trace 调用链） |
| `auth-mapping.json` | 静态分析单体文件（向后兼容） |
| `ai-tasks/index.json` | AI 任务索引（小文件，模块列表 + 分批计划） |
| `ai-tasks/<module>.json` | 每模块 AI 任务（含完整 prompt + 源码） |
| `ai-results/<module>.json` | 每模块 AI 分析结果（subagent 写入） |
| `auth-mapping-ai.json` | AI 补全汇总 |
| `auth-mapping-merged.json` | **最终合并报告**（静态 + AI） |
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
| `ai` | AI subagent 分析匹配 |
| `unresolved` | 未匹配到任何 API |

### API method 说明

| Method | 含义 |
|--------|------|
| GET/POST/PUT/DELETE/PATCH | HTTP API 调用 |
| NAVIGATE | 页面跳转（router.push / window.open） |
| *(空 apis 数组)* | 纯前端 UI 操作（只读预览弹窗等） |

## GUI 使用

安装为 DSH 插件后，在 **设置 → 插件 → Auth Analyzer** 面板中可以：

- 配置分析参数（页面目录、权限指令名、i18n 文件、排除模式）
- 点击「静态分析」运行 AST 分析
- 点击「全量分析」运行静态 + 准备 AI 任务
- 点击「合并结果」合并 AI 结果
- 实时查看进度、取消运行、重试

## 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录（相对于项目根目录） |
| `authDirectiveName` | `auth` | 权限指令名（`v-auth` 中的 `auth`） |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 翻译文件路径，留空跳过 |
| `excludePatterns` | `**/components/**,**/login/**,**/profile/**` | 排除的 glob 模式 |
| `ai.enabled` | `true` | 是否启用 AI 补全 |
| `outputDir` | `.auth-analyzer` | 输出目录 |

## 适配其他项目

### 使用 v-permission 而非 v-auth

在脚本中搜索 `prop.name === "auth"` 替换为 `prop.name === "permission"`。

### 使用 axios 直接调用而非 request()

修改 `resolveApiCall` 函数，增加对 `axios.get/post/put/delete` 的识别。

### 没有 i18n

设置 `CONFIG.i18nFile = null` 或在 GUI 面板中清空 i18n 文件路径。

### 非 Element Plus 项目

脚本不依赖 Element Plus，任何 Vue 3 项目都可用。按钮标签名不影响分析。

## 技术栈

- **运行时**: Node.js ≥ 22
- **AST 解析**: @babel/parser + @vue/compiler-sfc + @vue/compiler-dom
- **文件匹配**: fast-glob
- **平台集成**: DeepSeek Harness (Cordis) 插件体系
- **AI 执行**: DSH subagent 并发（非脚本直接调用 LLM）

## License

MIT
