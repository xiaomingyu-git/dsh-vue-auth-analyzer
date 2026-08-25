---
name: dsh-vue-auth-analyzer
description: Use when the user asks to analyze button permissions, scan page APIs, map v-auth directives to backend endpoints, audit permission-API coverage, or generate permission documentation for a Vue 3 project. Triggers on keywords like 按钮权限、权限扫描、API映射、v-auth分析、权限审计、button permission, API mapping, auth scan.
---

# Vue Auth-API Analyzer

扫描 Vue 3 项目中所有带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成完整的 **按钮 → 权限标识 → API** 映射报告。

## 工作原理

1. **静态 AST 分析**：解析 Vue SFC，追踪 `v-auth` → `@click` → `request()` → URL + method
2. **AI 补全**：对未覆盖的按钮，按模块分组后通过 DSH subagent **分批并发**分析

## 执行流程（严格按顺序）

### Step 1: 静态分析

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --static-only --ndjson
```

### Step 2: 准备 AI 任务

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson
```

读取 `dist/ai-tasks.json`，检查 `pendingModules`：
- **0** → 跳到 Step 5
- **> 0** → 继续 Step 3

### Step 3: 分批 subagent 分析

#### ⚠️ 核心规则

- **每批最多 2 个 subagent**，绝不超过
- **等当前批次全部完成后再启动下一批**
- **不要自己写合并脚本**，用 `--merge-ai` 命令

#### 3.1 读取任务列表

读取 `dist/ai-tasks.json` 中的 `tasks` 数组。如果任务数 > 2，分成多批：

```
批次 1: tasks[0..1]   (最多2个)
批次 2: tasks[2..3]   (最多2个)
批次 3: tasks[4..5]   (最多2个)
...依此类推
```

#### 3.2 对每一批执行

**在同一个 assistant message 中**，对当前批次的每个 task 调用 `subagent` tool：

```
subagent({
  description: "Analyze {task.module}",
  run_in_background: true,    ← 必须 true
  prompt: <见下方模板>
})
```

然后**等待 runtime 通知所有 subagent 完成**，确认 outputFile 都已生成，再启动下一批。

#### 3.3 Subagent prompt 模板

将 `task.prompt` 的内容直接嵌入以下模板：

```
你是 Vue 3 + TypeScript 代码分析专家。

{task.prompt 的完整内容}

请将分析结果用 write tool 写入文件：{project-root}/{task.outputFile}

输出格式（严格 JSON）：
{
  "results": [
    {
      "authId": "去掉引号的权限标识",
      "label": "按钮文本",
      "apis": [{"method": "GET|POST|PUT|DELETE|NAVIGATE", "url": "/path", "apiFunction": "fn", "note": ""}],
      "confidence": "high|medium|low",
      "reasoning": "追踪路径"
    }
  ],
  "module": "{task.module}"
}

注意：
- 用 write tool 直接写文件，不要在对话中输出完整 JSON
- 纯 UI 按钮（弹窗展示、无 API 调用）apis 返回 []
- 遇到 429 错误等 5 秒重试，最多 3 次
```

### Step 4: 合并结果

**所有批次完成后**，运行一次合并：

```bash
cd <project-root> && node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --merge-ai --ndjson
```

这会读取 `dist/ai-results/*.json` 的所有文件并合并。**不要自己写合并逻辑。**

### Step 5: 汇报

读取 `dist/auth-mapping-merged.json`，展示：
1. 覆盖率统计
2. 每页按钮-权限-API 映射表
3. 低置信度/失败条目
4. 建议

## 配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `viewsDir` | `src/views` | Vue 页面目录 |
| `i18nFile` | `src/lang/package/zh-cn.ts` | i18n 文件，`null` 跳过 |
| `excludePatterns` | `["**/components/**", ...]` | 排除目录 |

## 输出文件

| 文件 | 用途 |
|------|------|
| `dist/auth-mapping-merged.json` | **主报告** |
| `dist/auth-mapping.json` | 静态分析结果 |
| `dist/auth-mapping-ai.json` | AI 补全结果 |
| `dist/ai-tasks.json` | AI 任务（按模块分组） |
| `dist/ai-results/*.json` | 各模块 AI 结果 |
| `dist/.ai-auth-cache.json` | 增量缓存 |

## 适配

- **v-permission**: 搜索 `prop.name === "auth"` 替换为 `"permission"`
- **非 request()**: 修改 `resolveApiCall` 识别你的封装函数
- **无 i18n**: `CONFIG.i18nFile = null`
