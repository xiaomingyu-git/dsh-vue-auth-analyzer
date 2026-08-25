---
name: dsh-vue-auth-analyzer
description: Use when the user asks to analyze button permissions, scan page APIs, map v-auth directives to backend endpoints, audit permission-API coverage, or generate permission documentation for a Vue 3 project. Triggers on keywords like 按钮权限、权限扫描、API映射、v-auth分析、权限审计、button permission, API mapping, auth scan.
---

# Vue Auth-API Analyzer

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → API** 映射报告。

## 工作原理

采用**双轨分析**：
1. **静态 AST 分析**（零成本）：解析 Vue SFC 模板和脚本，追踪 `v-auth` → `@click handler` → `request() 调用` → `URL + method`，同时识别 `router.push` / `window.open` 导航动作
2. **AI 补全**（按需）：对静态分析未覆盖的按钮（跨组件弹窗、非标准触发等），按模块分组后通过 DSH subagent 并发分析源码补全映射

## 使用步骤

### Step 1: 确认项目适配

检查目标项目的以下配置是否匹配默认值，不匹配则修改 `scripts/vue-auth-api-analyzer.mjs` 顶部的 CONFIG：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 翻译文件，设为 `null` 跳过 |
| `excludePatterns` | `["**/components/**", "**/login/**", "**/profile/**"]` | 排除的目录 |

**权限指令名**：默认识别 `v-auth`。如果项目使用其他指令（如 `v-permission`、`v-has`），在脚本中搜索 `prop.name === "auth"` 替换为对应名称。

**API 封装函数**：默认追踪 `request()` 调用。如果项目使用其他封装（如 `http.get`、`axios.request`），修改 `resolveApiCall` 中的判断逻辑。

### Step 2: 运行静态分析

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --static-only --ndjson
```

输出 `dist/auth-mapping.json`。

### Step 3: 准备 AI 任务

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson
```

输出 `dist/ai-tasks.json`，包含按模块分组的待分析任务。每个任务包含：
- `module`: 模块路径（如 `/lov`、`/configs`）
- `buttons`: 该模块下未匹配的按钮列表
- `prompt`: 完整的分析 prompt（含源码），可直接发给 LLM
- `outputFile`: 结果应写入的文件路径

### Step 4: 用 subagent 并发处理 AI 任务

读取 `dist/ai-tasks.json`，对每个 task 启动一个 subagent：

```
对于 ai-tasks.json 中的每个 task:
  1. 启动 subagent，prompt 为 task.prompt
  2. subagent 返回 JSON 数组结果
  3. 将结果写入 task.outputFile（如 dist/ai-results/lov.json）
     格式：{ "results": [...], "module": "<module-name>" }
```

**关键**：所有 subagent 应该**并发启动**（background），不要串行等待。每个 subagent 只负责一个模块的分析。

subagent prompt 模板：
```
你是 Vue 3 代码分析专家。请分析以下源码，找出每个按钮最终调用的后端 API 接口。

{task.prompt}

请将分析结果以 JSON 数组格式写入文件 {task.outputFile}。
格式要求：{ "results": [每个按钮的分析结果], "module": "{task.module}" }
每个结果包含：authId, label, apis[{method, url, apiFunction, note}], confidence(high/medium/low), reasoning
```

### Step 5: 合并 AI 结果

所有 subagent 完成后：

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --merge-ai --ndjson
```

读取 `dist/ai-results/*.json`，合并为 `dist/auth-mapping-ai.json`，然后与静态分析结果合并生成 `dist/auth-mapping-merged.json`。

### Step 6: 解读结果

读取 `dist/auth-mapping-merged.json`，向用户展示：
1. 总体覆盖率统计
2. 每个页面的按钮-权限-API 映射表
3. 低置信度或失败的条目（需要人工确认）
4. 建议：哪些权限标识缺少对应 API、哪些 API 没有被任何按钮触发

## 输出文件

| 文件 | 用途 |
|------|------|
| `dist/auth-mapping-merged.json` | **主报告**：合并后的完整映射 |
| `dist/auth-mapping.json` | 静态分析原始结果（含 trace 调试信息） |
| `dist/auth-mapping-ai.json` | AI 补全结果（含 reasoning 推理过程） |
| `dist/ai-tasks.json` | AI 任务文件（按模块分组的 prompt） |
| `dist/ai-results/*.json` | 各模块的 AI 分析结果 |
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

## 适配其他项目的常见场景

### 使用 v-permission 而非 v-auth
在脚本中搜索 `prop.name === "auth"`，替换为 `prop.name === "permission"`。

### 使用 axios 直接调用而非 request() 封装
修改 `resolveApiCall` 函数，增加对 `axios.get/post/put/delete` 的识别。

### 没有 i18n
设置 `CONFIG.i18nFile = null`。

### 非 Element Plus 项目
脚本不依赖 Element Plus，任何 Vue 3 项目都可用。按钮标签名不影响分析。
