# AGENTS.md — AI 协作指南

> 本文件面向 AI coding agent（Claude Code、Codex、Cursor、Pi 等），说明如何修改本项目。

## 项目概述

vue-auth-analyzer 是一个 Vue 3 按钮-权限-API 映射分析工具，扫描项目中带权限指令（如 `v-auth`）的按钮，追踪其调用的后端 API 接口，生成 **按钮 → 权限标识 → HTTP API** 映射报告。

采用双轨分析：静态 AST 分析 + AI 补全（支持 `--run-ai` 脚本直调 LLM）。

可作为独立 CLI 工具使用，也可通过各 agent 平台的指令文件集成。

## ⚠️ 单一数据源规则

**`metadata.json` 是本项目的文档单一数据源。** 以下内容由它驱动，修改时必须先改 metadata.json：

| 内容 | 消费方 | 说明 |
|------|--------|------|
| CLI flags + 描述 | `scripts/vue-auth-api-analyzer.mjs` → `printHelp()` | 动态读取，无需手动同步 |
| 输出文件列表 | `printHelp()` | 动态读取 |
| 工作流步骤 | `printHelp()` | 动态读取 |
| 版本号 | `printHelp()` | 动态读取 |

### 修改流程

#### 新增/修改 CLI flag
1. 编辑 `metadata.json` → `flags` 数组
2. 在 `scripts/vue-auth-api-analyzer.mjs` 的 `parseArgs()` 中添加对应的解析逻辑
3. 在 `main()` 中添加对应的执行分支
4. printHelp 自动更新，无需手动改

#### 新增/修改输出文件
1. 编辑 `metadata.json` → `outputs` 数组
2. printHelp 自动更新
3. 在脚本中实现实际的写入逻辑

#### 升版本号
1. 编辑 `metadata.json` → `version`
2. 编辑 `package.json` → `version`（保持一致）
3. printHelp 自动显示新版本

#### 修改 agent 指令文件
`agents/` 目录下的文件需要保持核心指令内容一致：
- `SKILL.md` — 通用格式（DSH skill 系统也使用此文件）
- `codex.md` / `cursor.md` / `claude.md` / `pi.md` — 各平台适配格式
- 修改核心规则时，所有文件需同步更新

#### 修改 DSH 适配层
DSH 专属代码在 `dsh/` 子目录中，有独立的 `package.json`：
- `dsh/index.js` — DSH bundle entry（skill 注册 + settings + HTTP routes）
- `dsh/client/client.js` — GUI 配置面板
- `dsh/cordis.patch.yml` — Cordis bundle 注册
- 注意：`dsh/index.js` 中的路径使用 `parentRoot` 引用上层的脚本和 metadata

## 文件结构

```
├── package.json               ← npm 包配置（CLI 工具）
├── bin/
│   └── vue-auth-analyzer.mjs  ← CLI 入口（npx 可用）
├── scripts/
│   └── vue-auth-api-analyzer.mjs  ← 核心分析脚本（静态分析 + AI 编排）
├── agents/                    ← 多平台 agent 指令
│   ├── SKILL.md               ← 通用 agent 指令
│   ├── codex.md               ← OpenAI Codex 指令
│   ├── cursor.md              ← Cursor Rules 格式
│   ├── claude.md              ← Claude Code 指令
│   └── pi.md                  ← Pi agent 指令
├── metadata.json              ← 📌 单一数据源（flags/outputs/workflow/version）
├── AGENTS.md                  ← 本文件（面向 AI agent）
├── README.md                  ← 项目文档（面向人类用户）
├── dsh/                       ← DSH 适配层（可选安装）
│   ├── index.js               ← DSH bundle entry
│   ├── client/client.js       ← GUI 配置面板
│   ├── cordis.patch.yml       ← Cordis bundle 注册
│   └── package.json           ← DSH 子包（独立 peerDeps）
└── LICENSE
```

## 核心架构

### 四步流水线

```
Step 1: --static-only    → .auth-analyzer/static/<module>.json   (AST 解析)
Step 2: --prepare-ai     → .auth-analyzer/ai-tasks/<module>.json (分组 + prompt)
Step 3: --run-ai         → .auth-analyzer/ai-results/<module>.json (脚本直接调 LLM)
Step 4: --merge-ai       → .auth-analyzer/auth-mapping-merged.json (合并)
```

### 关键设计决策

- **Per-module 文件结构**：所有中间产物按模块拆分，避免单文件过大导致 agent JSON 解析失败
- **Plan A 全模块上下文**：AI prompt 包含模块内所有按钮（✅已确认 + ❓待分析 + ⚠️部分解析），已确认按钮作为推理锚点
- **输出目录 `.auth-analyzer/`**：隐藏目录，不会被项目 `pnpm build` 清理
- **绝对路径**：taskFile/outputFile 均为绝对路径，避免 agent 拼接错误
- **缓存机制**：已分析的模块自动跳过，`--no-cache` 强制重分析
- **分批并发**：每批最多 2 个 LLM 调用，避免 429 限流
- **Partial match 补全**：静态分析追踪到 import 路径但未解析出 HTTP URL 的按钮，标记为 ⚠️ 部分解析，交由 AI 补全

## 开发注意事项

### 不要做的事
- ❌ 不要在 printHelp() 中硬编码 flag/output/workflow 信息 → 改 metadata.json
- ❌ 不要把分析结果输出到 `dist/` → 会被项目 build 清理
- ❌ 不要在 `--run-ai` 之外让脚本直接调用 LLM API → 用 `--run-ai` flag

### 测试方式
```bash
# 语法检查
node --check scripts/vue-auth-api-analyzer.mjs
node --check bin/vue-auth-analyzer.mjs

# 端到端测试（需要一个 Vue 3 项目）
cd <project-root>
node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --static-only --ndjson
node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --prepare-ai --ndjson
node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --run-ai --ndjson
node <tool-dir>/scripts/vue-auth-api-analyzer.mjs --merge-ai --ndjson
```

### 提交规范
```
feat: 新功能
fix: 修复 bug
refactor: 重构（不改变行为）
docs: 文档更新
chore: 版本号/依赖/构建
```
