# dsh-vue-auth-analyzer

**Vue 3 按钮-权限-API 映射分析器** — [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，扫描 Vue 项目生成完整的 按钮 → 权限指令 → 后端 API 映射报告。

[English](README.md)

## 功能

1. **静态 AST 分析**（零成本）：解析 Vue SFC，追踪 `v-auth` → `@click` → `request()` → URL + method，识别 `router.push` / `window.open` 导航
2. **AI 补全**（按需）：对静态分析未覆盖的按钮，调用 LLM 分析源码补全
3. **合并报告**：输出统一的 `auth-mapping-merged.json`，含覆盖率统计

### 示例输出

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

## 安装

### 作为 DSH 插件

```bash
dsh plugin --profile web add github:<your-org>/dsh-vue-auth-analyzer
```

然后对 DSH 说：*"扫描我项目的按钮权限和 API 映射"*

### 独立使用（不需要 DSH）

```bash
git clone https://github.com/<your-org>/dsh-vue-auth-analyzer.git
cd dsh-vue-auth-analyzer
npm install
node scripts/vue-auth-api-analyzer.mjs --static-only
```

## 配置

编辑 `scripts/vue-auth-api-analyzer.mjs` 顶部的 `CONFIG`：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `authDirectiveName` | `auth` | 权限指令名（`v-auth`、`v-permission` 等） |
| `i18nFile` | `null` | i18n 翻译文件路径，用于解析按钮文本 |
| `excludePatterns` | `["**/components/**", ...]` | 排除的目录模式 |
| `ai.enabled` | `true` | 是否启用 AI 补全 |
| `ai.model` | `qwen3.7-max` | LLM 模型 |
| `ai.apiKey` | `""` | API Key（或设置环境变量 `AI_API_KEY`） |

## 命令行用法

```bash
node scripts/vue-auth-api-analyzer.mjs                  # 完整分析（静态 + AI）
node scripts/vue-auth-api-analyzer.mjs --static-only     # 仅静态分析
node scripts/vue-auth-api-analyzer.mjs --ai-only         # 仅 AI 补全
node scripts/vue-auth-api-analyzer.mjs --no-cache        # 清除 AI 缓存
node scripts/vue-auth-api-analyzer.mjs --help            # 帮助
```

## 输出文件

| 文件 | 说明 |
|------|------|
| `dist/auth-mapping-merged.json` | **主报告**：合并结果 + 覆盖率 |
| `dist/auth-mapping.json` | 静态分析原始结果 |
| `dist/auth-mapping-ai.json` | AI 补全结果（含推理过程） |
| `dist/.ai-auth-cache.json` | AI 增量缓存 |

## 动作类型

| Method | 含义 |
|--------|------|
| GET/POST/PUT/DELETE/PATCH | HTTP API 调用 |
| NAVIGATE | 页面跳转（router.push / window.open） |
| （空 apis 数组） | 纯前端 UI 操作 |

## 适配你的项目

- **不同指令名**：修改 `CONFIG.authDirectiveName`
- **不同 HTTP 封装**：修改 `resolveApiCall()` 中的判断逻辑
- **没有 i18n**：保持 `CONFIG.i18nFile = null`
- **非 Element Plus**：兼容任何 Vue 3 UI 框架

## 环境要求

- Node.js ≥ 22
- 依赖：`@babel/parser`、`@vue/compiler-sfc`、`@vue/compiler-dom`、`fast-glob`

## License

MIT
