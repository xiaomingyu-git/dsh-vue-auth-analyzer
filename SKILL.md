---
name: dsh-vue-auth-analyzer
description: Use when the user asks to analyze button permissions, scan page APIs, map v-auth directives to backend endpoints, audit permission-API coverage, or generate permission documentation for a Vue 3 project. Triggers on keywords like 按钮权限、权限扫描、API映射、v-auth分析、权限审计、button permission, API mapping, auth scan.
---

# Vue Auth-API Analyzer

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → API** 映射报告。

## 工作原理

采用**双轨分析**：
1. **静态 AST 分析**（零成本）：解析 Vue SFC 模板和脚本，追踪 `v-auth` → `@click handler` → `request() 调用` → `URL + method`，同时识别 `router.push` / `window.open` 导航动作
2. **AI 补全**（按需）：对静态分析未覆盖的按钮（跨组件弹窗、非标准触发等），调用 LLM 分析源码补全映射

## 使用步骤

### Step 1: 确认项目适配

检查目标项目的以下配置是否匹配默认值，不匹配则修改 `scripts/vue-auth-api-analyzer.mjs` 顶部的 CONFIG：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 翻译文件，设为 `null` 跳过 |
| `excludePatterns` | `["**/components/**", "**/login/**", "**/profile/**"]` | 排除的目录 |
| `ai.enabled` | `true` | 是否启用 AI 补全 |
| `ai.model` | `qwen3.7-max` | LLM 模型 |

**权限指令名**：默认识别 `v-auth`。如果项目使用其他指令（如 `v-permission`、`v-has`），在脚本中搜索 `prop.name === "auth"` 替换为对应名称。

**API 封装函数**：默认追踪 `request()` 调用。如果项目使用其他封装（如 `http.get`、`axios.request`），修改 `resolveApiCall` 中的判断逻辑。

### Step 2: 安装依赖

```bash
cd <plugin-dir> && npm install
```

或在目标项目中直接运行（插件自带依赖）。

### Step 3: 运行分析

```bash
# 完整分析（静态 + AI + 合并）
node scripts/vue-auth-api-analyzer.mjs

# 仅静态分析（零 AI 调用，适合 CI/快速预览）
node scripts/vue-auth-api-analyzer.mjs --static-only

# 仅 AI 补全（需先有静态分析结果）
node scripts/vue-auth-api-analyzer.mjs --ai-only

# 清除 AI 缓存重新分析
node scripts/vue-auth-api-analyzer.mjs --no-cache
```

### Step 4: 解读结果

分析完成后输出以下文件：

| 文件 | 用途 |
|------|------|
| `dist/auth-mapping-merged.json` | **主报告**：合并后的完整映射 |
| `dist/auth-mapping.json` | 静态分析原始结果（含 trace 调试信息） |
| `dist/auth-mapping-ai.json` | AI 补全结果（含 reasoning 推理过程） |
| `dist/.ai-auth-cache.json` | AI 增量缓存 |

#### merged.json 结构

```json
{
  "stats": {
    "totalButtons": 92,
    "staticMatched": 71,
    "aiMatched": 15,
    "uiOnly": 6,
    "coverage": "93.5%"
  },
  "pages": [
    {
      "page": "/bulletin",
      "buttons": [
        {
          "authId": "base.bulletin.add",
          "label": "新建",
          "apis": [{ "method": "POST", "url": "/base/bulletin" }],
          "source": "static",
          "confidence": "high"
        },
        {
          "authId": "base.config.history.query",
          "label": "查看历史",
          "apis": [{ "method": "NAVIGATE", "url": "/configs/:id/versions" }],
          "source": "static",
          "confidence": "high"
        }
      ]
    }
  ]
}
```

#### action 类型说明

| method | 含义 |
|--------|------|
| GET/POST/PUT/DELETE/PATCH | HTTP API 调用 |
| NAVIGATE | 页面跳转（router.push / window.open） |
| （空 apis 数组） | 纯前端 UI 操作（弹窗展示、本地校验等） |

### Step 5: 向用户汇报

读取 `dist/auth-mapping-merged.json`，向用户展示：
1. 总体覆盖率统计
2. 每个页面的按钮-权限-API 映射表
3. 低置信度或失败的条目（需要人工确认）
4. 建议：哪些权限标识缺少对应 API、哪些 API 没有被任何按钮触发

## AI API Key 配置

AI 补全需要 LLM API Key，按以下优先级自动查找：
1. 环境变量 `AI_API_KEY`
2. `~/.dsh/.credentials.yaml` 中的 `QWEN_TOKEN_PLAN_CN_API_KEY` 或 `DEEPSEEK_API_KEY`
3. 环境变量 `AI_BASE_URL` / `AI_MODEL` 可覆盖默认的模型和端点

如果未找到 Key 且 `ai.enabled=true`，AI 阶段会报错但不影响静态分析结果。

## 适配其他项目的常见场景

### 使用 v-permission 而非 v-auth
在脚本中搜索 `prop.name === "auth"`，替换为 `prop.name === "permission"`。

### 使用 axios 直接调用而非 request() 封装
修改 `resolveApiCall` 函数，增加对 `axios.get/post/put/delete` 的识别。

### 没有 i18n
设置 `CONFIG.i18nFile = null`。

### 非 Element Plus 项目
脚本不依赖 Element Plus，任何 Vue 3 项目都可用。按钮标签名不影响分析。
