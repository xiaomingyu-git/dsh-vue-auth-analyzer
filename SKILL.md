---
name: dsh-vue-auth-analyzer
description: Use when the user asks to analyze button permissions, scan page APIs, map v-auth directives to backend endpoints, audit permission-API coverage, or generate permission documentation for a Vue 3 project. Triggers on keywords like 按钮权限、权限扫描、API映射、v-auth分析、权限审计、button permission, API mapping, auth scan.
---

# Vue Auth-API Analyzer

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → API** 映射报告。

## 工作原理

采用**双轨分析**：
1. **静态 AST 分析**（零成本）：解析 Vue SFC 模板和脚本，追踪 `v-auth` → `@click handler` → `request() 调用` → `URL + method`
2. **AI 补全**（按需）：对静态分析未覆盖的按钮，按模块分组后通过 DSH subagent **分批并发**分析源码补全映射

## 完整执行流程

当用户要求分析时，**严格按以下步骤执行**：

### Step 1: 静态分析

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --static-only --ndjson
```

输出 `dist/auth-mapping.json`。

### Step 2: 准备 AI 任务

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson
```

输出 `dist/ai-tasks.json`。读取该文件，检查 `pendingModules` 字段：
- 如果为 0，跳到 Step 5（全部命中缓存）
- 如果 > 0，继续 Step 3

### Step 3: 分批启动 subagent 分析（关键步骤）

**⚠️ 必须控制并发数量，否则会触发 LLM API 429 限流！**

#### 3.1 合并小模块

读取 `dist/ai-tasks.json` 中的 `tasks` 数组。将按钮数 ≤ 3 的小模块合并为一个组合任务，大模块（> 3 按钮）保持独立。目标：**总任务数控制在 5-8 个**。

合并方式：将多个小模块的 prompt 拼接，用分隔线隔开：
```
=== 模块: /module-a (2 buttons) ===
{task_a.prompt}

=== 模块: /module-b (1 button) ===  
{task_b.prompt}
```

结果写入各自独立的 outputFile，每个模块一个 JSON 文件。

#### 3.2 分批启动（每批最多 5 个）

**绝对不要一次性启动超过 5 个 background subagent。** 按以下流程：

1. 将所有任务分成若干批，每批 ≤ 5 个
2. 在同一个 assistant message 中启动当前批次的所有 subagent（`run_in_background: true`）
3. 等待当前批次全部完成（runtime 自动通知）
4. 确认当前批次的 outputFile 都已生成
5. 启动下一批，重复直到所有任务完成

#### 3.3 Subagent prompt 模板

```
你是 Vue 3 + TypeScript 代码分析专家。请阅读以下源码文件，分析指定按钮最终调用的后端 API 接口。

{task.prompt 的内容}

请将分析结果写入文件 {project-root}/{task.outputFile}，格式为：
{
  "results": [
    {
      "authId": "去掉引号的权限标识字符串",
      "label": "按钮显示文本",
      "apis": [{"method": "GET|POST|PUT|DELETE|NAVIGATE", "url": "/api/path", "apiFunction": "函数名", "note": "可选"}],
      "confidence": "high|medium|low",
      "reasoning": "简要追踪路径"
    }
  ],
  "module": "{task.module}"
}

重要：
- 直接用 write tool 写入文件，不要在对话中重复输出完整 JSON
- 每个按钮对应 results 数组中的一个元素
- 如果按钮只是打开弹窗展示数据、不涉及 API 调用，apis 返回空数组 []
- 如果遇到 429 错误，等待 5 秒后重试，最多重试 3 次
```

### Step 4: 合并 AI 结果

所有 subagent 完成后：

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --merge-ai --ndjson
```

### Step 5: 汇报结果

读取 `dist/auth-mapping-merged.json`，向用户展示：
1. 总体覆盖率统计
2. 每个页面的按钮-权限-API 映射表
3. 低置信度或失败的条目（需要人工确认）
4. 建议：哪些权限标识缺少对应 API、哪些 API 没有被任何按钮触发

## 配置

检查目标项目的以下配置是否匹配默认值，不匹配则修改 `scripts/vue-auth-api-analyzer.mjs` 顶部的 CONFIG 或通过 GUI 设置面板配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 翻译文件，设为 `null` 跳过 |
| `excludePatterns` | `["**/components/**", "**/login/**", "**/profile/**"]` | 排除的目录 |

**权限指令名**：默认识别 `v-auth`。如果项目使用其他指令（如 `v-permission`），在脚本中搜索 `prop.name === "auth"` 替换。

**API 封装函数**：默认追踪 `request()` 调用。如果使用其他封装，修改 `resolveApiCall` 中的判断逻辑。

## 输出文件

| 文件 | 用途 |
|------|------|
| `dist/auth-mapping-merged.json` | **主报告**：合并后的完整映射 |
| `dist/auth-mapping.json` | 静态分析原始结果 |
| `dist/auth-mapping-ai.json` | AI 补全结果 |
| `dist/ai-tasks.json` | AI 任务文件（按模块分组的 prompt） |
| `dist/ai-results/*.json` | 各模块的 AI 分析结果 |
| `dist/.ai-auth-cache.json` | AI 增量缓存 |

## 适配其他项目

### 使用 v-permission 而非 v-auth
在脚本中搜索 `prop.name === "auth"`，替换为 `prop.name === "permission"`。

### 使用 axios 直接调用而非 request()
修改 `resolveApiCall` 函数，增加对 `axios.get/post/put/delete` 的识别。

### 没有 i18n
设置 `CONFIG.i18nFile = null`。
