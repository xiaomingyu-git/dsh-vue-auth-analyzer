# AGENTS.md — AI 协作指南

> 本文件面向 AI coding agent（Claude Code、Codex、Hermes 等），说明如何修改本项目。

## 项目概述

dsh-vue-auth-analyzer 是一个 DeepSeek Harness (DSH) 插件，扫描 Vue 3 项目中带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成 **按钮 → 权限标识 → HTTP API** 映射报告。

采用双轨分析：静态 AST 分析 + DSH subagent 并发 AI 补全。

## ⚠️ 单一数据源规则

**`metadata.json` 是本项目的文档单一数据源。** 以下内容由它驱动，修改时必须先改 metadata.json：

| 内容 | 消费方 | 说明 |
|------|--------|------|
| CLI flags + 描述 | `scripts/vue-auth-api-analyzer.mjs` → `printHelp()` | 动态读取，无需手动同步 |
| 输出文件列表 | `printHelp()` | 动态读取 |
| 工作流步骤 | `printHelp()` | 动态读取 |
| 版本号 | `printHelp()` | 动态读取 |
| 配置字段（key/type/default/description） | `index.js` → AnalyzerSettings schema | 动态构建 |
| 配置同步规则 | `index.js` → syncConfigToFile() | 遍历 metadata.config |

### 修改流程

#### 新增/修改 CLI flag
1. 编辑 `metadata.json` → `flags` 数组
2. 在 `scripts/vue-auth-api-analyzer.mjs` 的 `parseArgs()` 中添加对应的解析逻辑
3. 在 `main()` 中添加对应的执行分支
4. printHelp 自动更新，无需手动改

#### 新增/修改配置字段
1. 编辑 `metadata.json` → `config` 数组，添加 `{ key, type, default, zhLabel, zhHint, enLabel, enHint }`
2. 在 `scripts/vue-auth-api-analyzer.mjs` 的 CONFIG 对象中添加对应字段
3. schema 和 syncConfigToFile 自动适配，无需手动改 index.js
4. 在 `client/client.js` 的 locale 对象（zh/en）中添加对应的 label/hint
5. 在 `client/client.js` 的 DEFAULTS 对象中添加默认值
6. 在 `client/client.js` 的表单渲染区域添加对应的输入控件

#### 新增/修改输出文件
1. 编辑 `metadata.json` → `outputs` 数组
2. printHelp 自动更新
3. 在脚本中实现实际的写入逻辑

#### AI 分析模式选择
- **`--run-ai`**：脚本直接调 LLM API（确定性编排，利用缓存，平台无关）
  - 凭证自动从 `~/.dsh/.credentials.yaml` 或环境变量读取
  - 支持并发控制（CONFIG.ai.concurrency，默认 2）
  - 已有 ai-results 的模块自动跳过
- **subagent 模式**：通过 DSH subagent 并发分析（依赖 DSH 平台）
  - 由 SKILL.md Step 3 指导 agent 执行
  - 适合 DSH 环境，利用平台模型配置
- 两种模式共享同一套缓存和结果格式，可混合使用

#### 升版本号
1. 编辑 `metadata.json` → `version`
2. 编辑 `package.json` → `version`（保持一致）
3. printHelp 自动显示新版本

#### 修改 SKILL.md / README.md
这两个文件目前是手动维护，但内容应与 metadata.json 对齐：
- SKILL.md 中的命令、路径、步骤应与 `metadata.json` 的 `flags`/`workflow`/`outputs` 一致
- README.md 中的 CLI 用法、输出文件表、配置表应与 metadata.json 一致
- 修改后运行 `node scripts/vue-auth-api-analyzer.mjs --help` 验证 printHelp 输出是否与文档一致

## 文件结构

```
├── metadata.json              ← 📌 单一数据源（flags/config/outputs/workflow/version）
├── package.json               ← npm 包配置
├── index.js                   ← DSH 插件入口（skill + settings + HTTP routes）
├── SKILL.md                   ← Agent 执行指令（DSH skill 系统加载）
├── README.md                  ← 项目文档（面向人类用户）
├── AGENTS.md                  ← 本文件（面向 AI agent）
├── client/
│   └── client.js              ← GUI 配置面板（React component, __ModuleLoader__ 格式）
├── scripts/
│   └── vue-auth-api-analyzer.mjs  ← 核心分析脚本（静态分析 + 任务准备 + 结果合并）
├── cordis.patch.yml           ← DSH bundle 注册
└── LICENSE
```

## 核心架构

### 四步流水线

```
Step 1: --static-only    → .auth-analyzer/static/<module>.json   (AST 解析)
Step 2: --prepare-ai     → .auth-analyzer/ai-tasks/<module>.json (分组 + prompt)
Step 3a: --run-ai        → .auth-analyzer/ai-results/<module>.json (脚本直接调 LLM)
Step 3b: OR subagent 并发 → .auth-analyzer/ai-results/<module>.json (DSH subagent)
Step 4: --merge-ai       → .auth-analyzer/auth-mapping-merged.json (合并)
```

### 关键设计决策

- **Per-module 文件结构**：所有中间产物按模块拆分，避免单文件过大导致 agent JSON 解析失败
- **Plan A 全模块上下文**：AI prompt 包含模块内所有按钮（✅已确认 + ❓待分析），已确认按钮作为推理锚点
- **输出目录 `.auth-analyzer/`**：隐藏目录，不会被项目 `pnpm build` 清理
- **绝对路径**：taskFile/outputFile 均为绝对路径，避免 agent 拼接错误
- **SKILL.md 热加载**：index.js 每 5 秒轮询 SKILL.md mtime，变化时自动重新注册
- **缓存机制**：已分析的模块自动跳过，`--no-cache` 强制重分析
- **分批并发**：每批最多 2 个 subagent，避免 LLM API 429 限流

## 开发注意事项

### 不要做的事
- ❌ 不要在 printHelp() 中硬编码 flag/output/workflow 信息 → 改 metadata.json
- ❌ 不要在 index.js 中硬编码 config schema → 改 metadata.json
- ❌ 不要把分析结果输出到 `dist/` → 会被项目 build 清理
- ❌ 不要在 `--run-ai` 之外让脚本直接调用 LLM API → 用 `--run-ai` flag 或 DSH subagent
- ❌ 不要用 `tools.read()` 读 JSON 文件给 agent → 用 bash `node -e "require(...)"`

### 测试方式
```bash
# 语法检查
node --check scripts/vue-auth-api-analyzer.mjs
node --check index.js

# Client bundle 验证
node -e "let c;global.window={__ModuleLoader__:{load:o=>{c=o}}};new Function(require('fs').readFileSync('client/client.js','utf8'))();console.log(c.factory(n=>n==='react'?{createElement:()=>null,useState:()=>[null,()=>{}],useEffect:()=>{},useRef:()=>({current:null})}:n==='@deepseek-ai/dsh-client-ui-primitives'?{Button:()=>null,IconChevronDownOutline14:()=>null}:{}).name)"

# 端到端测试（需要一个 Vue 3 项目）
cd <project-root>
node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --static-only --ndjson
node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson
# Option A: script runs LLM directly (platform-independent)
node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --run-ai --ndjson
# Option B: DSH subagent (see SKILL.md Step 3)
# ... subagent 执行 ...
node <plugin-dir>/scripts/vue-auth-api-analyzer.mjs --merge-ai --ndjson
```

### 提交规范
```
feat: 新功能
fix: 修复 bug
refactor: 重构（不改变行为）
docs: 文档更新
chore: 版本号/依赖/构建
```
