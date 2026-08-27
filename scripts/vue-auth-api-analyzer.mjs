#!/usr/bin/env node
/**
 * Vue Auth-API Analyzer v3 - 按钮-权限-API 映射分析器（AI-First 架构）
 *
 * 核心设计理念：
 *   - 静态分析仅负责「链式上下文组织」：收集文件、解析模板结构、构建调用图骨架
 *   - 所有权限识别和 API 映射分析全部由 AI 完成
 *   - 静态分析不再尝试解析 HTTP URL，只提供结构化上下文给 AI
 *
 * 用法：
 *   node vue-auth-api-analyzer.mjs --run-ai          # 完整分析（静态上下文 + AI 分析）
 *   node vue-auth-api-analyzer.mjs --static-only      # 仅收集上下文
 *   node vue-auth-api-analyzer.mjs --prepare-ai       # 准备 AI 任务
 *   node vue-auth-api-analyzer.mjs --merge-ai         # 合并 AI 结果
 *   node vue-auth-api-analyzer.mjs --no-cache         # 清除缓存
 *   node vue-auth-api-analyzer.mjs --ndjson           # NDJSON 进度输出
 *   node vue-auth-api-analyzer.mjs --help             # 显示帮助
 *
 * 外部依赖（需安装）：
 *   npm install @babel/parser @babel/types @vue/compiler-sfc @vue/compiler-dom fast-glob
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fg from "fast-glob";
import { parse as parseScript, parseExpression } from "@babel/parser";
import { parse as parseSFC } from "@vue/compiler-sfc";
import { parse as parseTemplate, NodeTypes } from "@vue/compiler-dom";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
  rootDir: process.cwd(),
  viewsDir: "src/views",
  excludePatterns: ["**/components/**", "**/login/**", "**/profile/**"],
  authDirectiveName: "auth",
  i18nFile: "src/lang/package/zh-cn.ts",
  outputDir: ".auth-analyzer",
  ai: {
    enabled: true,
    maxFileSize: 200000,
    apiKey: "",
    baseUrl: "",
    model: "",
    concurrency: 2,
  },
};

let ROOT = process.cwd();
let SRC_DIR = path.join(ROOT, CONFIG.viewsDir);
let NDJSON_MODE = false;

function emit(event) {
  if (!NDJSON_MODE) return;
  process.stdout.write(JSON.stringify(event) + "\n");
}

// ============================================================
// CLI
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { staticOnly: false, noCache: false, help: false, ndjson: false, prepareAi: false, mergeAi: false, runAi: false };
  for (const a of args) {
    if (a === "--static-only") opts.staticOnly = true;
    else if (a === "--no-cache") opts.noCache = true;
    else if (a === "--ndjson") opts.ndjson = true;
    else if (a === "--prepare-ai") opts.prepareAi = true;
    else if (a === "--merge-ai") opts.mergeAi = true;
    else if (a === "--run-ai") opts.runAi = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function printHelp() {
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "metadata.json"), "utf-8"));
  } catch {
    console.log("Vue Auth-API Analyzer\nRun with --help after ensuring metadata.json exists.");
    return;
  }
  const pad = (s, len) => s + " ".repeat(Math.max(0, len - s.length));
  const maxFlagLen = Math.max(...meta.flags.map(f => f.flag.length)) + 2;
  const maxFileLen = Math.max(...meta.outputs.map(o => o.file.length)) + 2;

  let out = `\nVue Auth-API Analyzer v${meta.version}\n\nUsage:\n  node vue-auth-api-analyzer.mjs [options]\n\nOptions:\n`;
  for (const f of meta.flags) out += "  " + pad(f.flag, maxFlagLen) + f.desc + "\n";
  out += "\nWorkflow:\n";
  for (const w of meta.workflow) out += "  " + w.step + ". " + pad(w.cmd, 20) + "→ " + w.output + "\n";
  out += "\nOutput (default directory: " + meta.outputDir + "/):\n";
  for (const o of meta.outputs) out += "  " + pad(o.file, maxFileLen) + o.desc + "\n";
  console.log(out);
}

// ============================================================
// SECTION: AST Utilities
// ============================================================
const visitorKeys = (() => {
  try {
    return require("@babel/types").VISITOR_KEYS;
  } catch {
    return {};
  }
})();

function walk(node, onNode) {
  if (!node || typeof node.type !== "string") return;
  onNode(node);
  const keys = visitorKeys[node.type] || [];
  for (const key of keys) {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => walk(c, onNode));
    else walk(child, onNode);
  }
}

function extractHandlerNamesFromExpression(expression) {
  if (!expression) return [];
  try {
    const ast = parseExpression(expression, { plugins: ["typescript", "jsx"] });
    const names = new Set();
    walk(ast, (node) => {
      if (node.type !== "CallExpression") return;
      const callee = node.callee;
      if (callee.type === "Identifier") {
        names.add(callee.name);
      } else if (
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        (callee.property.type === "Identifier" || callee.property.type === "StringLiteral")
      ) {
        const prop = callee.property.type === "Identifier" ? callee.property.name : callee.property.value;
        names.add(`${callee.object.name}.${prop}`);
      }
    });
    if (ast.type === "Identifier") names.add(ast.name);
    return Array.from(names);
  } catch {
    return [expression.split("(")[0].trim()].filter(Boolean);
  }
}

function stringifyExpression(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && node.object && node.property) {
    const obj = stringifyExpression(node.object);
    const prop = node.property.type === "Identifier" ? node.property.name
      : node.property.type === "StringLiteral" ? node.property.value : "";
    return prop ? `${obj}.${prop}` : obj;
  }
  return "";
}

function getCalleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.object.type === "Identifier") {
    const prop = callee.property.type === "Identifier" ? callee.property.name
      : callee.property.type === "StringLiteral" ? callee.property.value : null;
    if (prop) return `${callee.object.name}.${prop}`;
  }
  return null;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function astVisitorKeys() {
  try { return require("@babel/types").VISITOR_KEYS; } catch { return {}; }
}

// ============================================================
// SECTION: i18n Translation Loading
// ============================================================
function loadZhCnTranslations(rootDir) {
  const file = path.join(rootDir, "src", "lang", "package", "zh-cn.ts");
  if (!fs.existsSync(file)) return {};
  const code = fs.readFileSync(file, "utf-8");
  let ast;
  try {
    ast = parseScript(code, { sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"] });
  } catch { return {}; }
  const exportNode = ast.program.body.find(s => s.type === "ExportDefaultDeclaration");
  if (!exportNode || exportNode.declaration.type !== "ObjectExpression") return {};
  return objectExpressionToObject(exportNode.declaration);
}

function objectExpressionToObject(node) {
  const obj = {};
  node.properties.forEach((prop) => {
    if (prop.type !== "ObjectProperty") return;
    const key = prop.key.type === "Identifier" ? prop.key.name : prop.key.value ?? null;
    if (!key) return;
    if (prop.value.type === "StringLiteral") obj[key] = prop.value.value;
    else if (prop.value.type === "ObjectExpression") obj[key] = objectExpressionToObject(prop.value);
  });
  return obj;
}

function getI18nValue(i18nMap, key) {
  if (!key) return "";
  const parts = key.split(".");
  let current = i18nMap;
  for (const p of parts) {
    if (current && typeof current === "object" && p in current) current = current[p];
    else return "";
  }
  return typeof current === "string" ? current : "";
}

function translateExpression(expression, i18nMap) {
  try {
    const ast = parseExpression(expression, { plugins: ["typescript", "jsx", "optionalChaining", "nullishCoalescingOperator"] });
    if (ast.type === "CallExpression") {
      const calleeName = getCalleeName(ast.callee);
      if (calleeName === "$t" || calleeName === "t") {
        const arg = ast.arguments?.[0];
        if (arg?.type === "StringLiteral") return getI18nValue(i18nMap, arg.value) || "";
      }
    }
  } catch {}
  return "";
}

// ============================================================
// SECTION: Template Analysis (Context Only — No API Resolution)
// ============================================================
function readVueTemplate(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const sfc = parseSFC(content, { filename: filePath });
  return { descriptor: sfc.descriptor, template: sfc.descriptor.template?.content || "" };
}

function extractElementName(node, i18nMap = {}) {
  if (!node || !node.props) return "";
  const nameProp = node.props.find(p => p.type === 6 && (p.name === "name" || p.name === "label") && typeof p.value?.content === "string");
  if (nameProp?.value?.content) return nameProp.value.content.trim();
  const texts = [];
  if (Array.isArray(node.children)) {
    node.children.forEach((c) => {
      if (c.type === NodeTypes.TEXT && c.content) texts.push(String(c.content).trim());
      else if (c.type === NodeTypes.INTERPOLATION && c.content?.content) {
        const translated = translateExpression(c.content.content, i18nMap);
        if (translated) texts.push(translated);
      }
    });
  }
  return texts.join(" ").trim();
}

function extractTemplateInfo(filePath, templateCode, i18nMap = {}) {
  const authNodes = [];
  const bindings = new Map();
  const handlers = new Set();
  if (!templateCode) return { authNodes, bindings, handlers };

  const tplAst = parseTemplate(templateCode, { comments: false });
  const authStack = [];

  function walkTpl(node) {
    if (!node) return;
    if (node.type === NodeTypes.ELEMENT) {
      const events = [];
      const bindingObj = { tag: node.tag, bindings: {} };
      let currentAuth = null;

      node.props?.forEach((prop) => {
        if (prop.type === 7 && prop.name === CONFIG.authDirectiveName) {
          const authValue = prop.exp?.type === 4 ? prop.exp.content?.trim() : undefined;
          currentAuth = {
            tag: node.tag,
            name: extractElementName(node, i18nMap),
            authValue,
            line: prop.loc?.start?.line ?? node.loc?.start?.line,
            events,
            descendantEvents: [],
          };
          authNodes.push(currentAuth);
        }

        if (prop.type === 7 && prop.name === "on") {
          const expression = prop.exp?.type === 4 ? prop.exp.content?.trim() : undefined;
          extractHandlerNamesFromExpression(expression).forEach(h => handlers.add(h));
          const evt = {
            event: prop.arg?.type === 4 ? prop.arg.content : "unknown",
            expression,
            line: prop.loc?.start?.line,
            tag: node.tag,
            name: translateExpression(expression, i18nMap) || "",
          };
          events.push(evt);
          if (authStack.length > 0) authStack[authStack.length - 1].descendantEvents.push(evt);
        }

        if (prop.type === 7 && prop.name === "model" && prop.exp?.type === 4) {
          const argName = prop.arg?.type === 4 ? prop.arg.content : "modelValue";
          bindingObj.bindings[argName] = prop.exp.content.trim();
        }

        if (prop.type === 7 && prop.name === "bind" && prop.arg?.type === 4 &&
            ["visible", "modelValue", "data"].includes(prop.arg.content) && prop.exp?.type === 4) {
          bindingObj.bindings[prop.arg.content] = prop.exp.content.trim();
        }

        if (prop.type === 7 && prop.name === "bind" && prop.arg?.type === 4 &&
            prop.arg.content.startsWith("on") && prop.exp?.type === 4) {
          const expression = prop.exp.content.trim();
          extractHandlerNamesFromExpression(expression).forEach(h => handlers.add(h));
          const evtName = prop.arg.content.replace(/^on-?/, "") || "unknown";
          const evt = { event: evtName, expression, line: prop.loc?.start?.line, tag: node.tag, name: translateExpression(expression, i18nMap) || "" };
          events.push(evt);
          if (authStack.length > 0) authStack[authStack.length - 1].descendantEvents.push(evt);
        }
      });

      Object.values(bindingObj.bindings).forEach(v => {
        if (!v) return;
        if (!bindings.has(v)) bindings.set(v, []);
        bindings.get(v).push(bindingObj);
      });

      if (currentAuth) authStack.push(currentAuth);
      node.children?.forEach(walkTpl);
      if (currentAuth) authStack.pop();
    } else if (Array.isArray(node.children)) {
      node.children.forEach(walkTpl);
    }
  }

  walkTpl(tplAst);
  return { authNodes, bindings, handlers };
}

// ============================================================
// SECTION: Script Structure Analysis (Context Only — No API Resolution)
// ============================================================
function analyzeScriptStructure(code, filename) {
  if (!code.trim()) return { functions: new Map(), imports: new Map() };
  let ast;
  try {
    ast = parseScript(code, { sourceType: "module", plugins: ["typescript", "jsx", "decorators-legacy", "classProperties", "dynamicImport"] });
  } catch {
    return { functions: new Map(), imports: new Map() };
  }

  const imports = new Map();
  ast.program.body.forEach((stmt) => {
    if (stmt.type !== "ImportDeclaration") return;
    stmt.specifiers.forEach((spec) => {
      if (spec.type === "ImportSpecifier" || spec.type === "ImportDefaultSpecifier") {
        imports.set(spec.local.name, {
          local: spec.local.name,
          imported: spec.type === "ImportSpecifier" ? spec.imported.name : "default",
          source: stmt.source.value,
        });
      } else if (spec.type === "ImportNamespaceSpecifier") {
        imports.set(spec.local.name, { local: spec.local.name, imported: "*", source: stmt.source.value });
      }
    });
  });

  const functions = new Map();
  const vk = astVisitorKeys();

  const ensureFn = (name, loc) => {
    if (!functions.has(name)) {
      functions.set(name, { name, loc, params: [], calls: [], toggles: [] });
    }
    return functions.get(name);
  };

  // Collect function definitions
  const collectDefs = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "FunctionDeclaration" && node.id?.name) {
      const fn = ensureFn(node.id.name, node.loc?.start?.line);
      fn.params = extractParamNames(node.params);
    } else if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init &&
               ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init.type)) {
      const fn = ensureFn(node.id.name, node.loc?.start?.line);
      fn.params = extractParamNames(node.init.params);
    }
    (vk[node.type] || []).forEach((key) => {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(collectDefs);
      else if (child && typeof child.type === "string") collectDefs(child);
    });
  };
  collectDefs(ast.program);

  // Collect call relationships and toggles (NO API resolution)
  const visitForStructure = (node, currentFnName) => {
    if (!node || typeof node.type !== "string") return;
    let nextFnName = currentFnName;

    if (node.type === "FunctionDeclaration" && node.id?.name) nextFnName = node.id.name;
    else if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init &&
             ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init.type)) {
      nextFnName = node.id.name;
    }

    if (currentFnName && node.type === "CallExpression" && node.callee) {
      const calleeName = getCalleeName(node.callee);
      if (calleeName && functions.has(calleeName)) {
        ensureFn(currentFnName).calls.push(calleeName);
      }
    }

    if (currentFnName && node.type === "AssignmentExpression" && node.operator === "=") {
      if (node.left.type === "Identifier" && node.right.type === "BooleanLiteral" && node.right.value === true) {
        ensureFn(currentFnName).toggles.push(node.left.name);
      }
      if (node.left.type === "MemberExpression" && node.left.object.type === "Identifier" &&
          node.left.property.type === "Identifier" && node.left.property.name === "value" &&
          node.right.type === "BooleanLiteral" && node.right.value === true) {
        ensureFn(currentFnName).toggles.push(node.left.object.name);
      }
    }

    (vk[node.type] || []).forEach((key) => {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(c => visitForStructure(c, nextFnName));
      else if (child && typeof child.type === "string") visitForStructure(child, nextFnName);
    });
  };
  visitForStructure(ast.program, null);

  return { functions, imports };
}

function extractParamNames(params) {
  if (!Array.isArray(params)) return [];
  return params.map(p => {
    if (!p) return null;
    if (p.type === "Identifier") return p.name;
    if (p.type === "AssignmentPattern" && p.left.type === "Identifier") return p.left.name;
    return null;
  }).filter(Boolean);
}

// ============================================================
// SECTION: Context Collection (replaces old static analysis)
// ============================================================
async function collectPageEntries() {
  const pattern = CONFIG.viewsDir + "/**/index.vue";
  const entries = await fg(pattern, { cwd: ROOT, ignore: CONFIG.excludePatterns });
  return entries.map(p => path.join(ROOT, p));
}

function toRoutePath(relativeDir) {
  if (!relativeDir || relativeDir === ".") return "/";
  return "/" + relativeDir.split(path.sep).map(seg => seg.replace(/\[([^\]]+)\]/g, ":$1")).join("/");
}

function toKebabCase(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\s+/g, "-").toLowerCase();
}

function buildTagToFileMap(vueFiles) {
  const map = new Map();
  vueFiles.forEach(file => {
    const base = path.basename(file, ".vue");
    const kebab = toKebabCase(base);
    const simple = base.toLowerCase();
    const segments = kebab.split("-");
    const keys = new Set([kebab, simple]);
    for (let i = 0; i < segments.length; i++) keys.add(segments.slice(i).join("-"));
    keys.forEach(k => { if (!map.has(k)) map.set(k, file); });
  });
  return map;
}

async function collectModuleContext(entryPath) {
  const baseDir = path.dirname(entryPath);
  const vueFiles = await fg("**/*.vue", { cwd: baseDir, absolute: true });
  const apiFiles = await fg("**/*.ts", { cwd: path.join(baseDir, ".."), absolute: true, ignore: ["**/*.d.ts"] });
  const i18nMap = loadZhCnTranslations(ROOT);

  const files = [];
  const authNodes = [];
  const allHandlers = new Set();
  const allBindings = new Map();
  const allImports = new Map();
  const allFunctions = new Map();
  const tagFileMap = buildTagToFileMap(vueFiles);

  // Process each Vue file in the module
  for (const filePath of vueFiles) {
    const { descriptor, template } = readVueTemplate(filePath);
    const { authNodes: nodes, bindings, handlers } = extractTemplateInfo(filePath, template, i18nMap);

    const scriptContent = [descriptor.script?.content ?? "", descriptor.scriptSetup?.content ?? ""].filter(Boolean).join("\n");
    const { functions, imports } = analyzeScriptStructure(scriptContent, filePath);

    const relPath = path.relative(ROOT, filePath);
    nodes.forEach(n => {
      authNodes.push({ ...n, file: relPath, absPath: filePath });
    });

    handlers.forEach(h => allHandlers.add(h));
    bindings.forEach((arr, key) => {
      if (!allBindings.has(key)) allBindings.set(key, []);
      allBindings.get(key).push(...arr);
    });
    imports.forEach((val, key) => allImports.set(key, val));
    functions.forEach((val, key) => allFunctions.set(key, val));

    files.push({
      path: relPath,
      hasAuth: nodes.length > 0,
      authCount: nodes.length,
      handlerCount: handlers.size,
    });
  }

  // Collect relevant API files
  const apiFileList = [];
  for (const filePath of apiFiles) {
    const relPath = path.relative(ROOT, filePath);
    if (relPath.includes("/api/") || relPath.includes("/utils/request")) {
      apiFileList.push(relPath);
    }
  }

  return {
    page: toRoutePath(path.relative(SRC_DIR, baseDir)),
    entry: path.relative(ROOT, entryPath),
    files,
    apiFiles: apiFileList,
    authNodes: authNodes.map(n => ({
      tag: n.tag,
      name: n.name,
      authValue: n.authValue,
      line: n.line,
      file: n.file,
      events: n.events,
      descendantEvents: n.descendantEvents,
    })),
    handlers: Array.from(allHandlers),
    bindings: Object.fromEntries(allBindings),
    imports: Array.from(allImports.entries()).map(([k, v]) => ({ local: k, ...v })),
    functions: Array.from(allFunctions.entries()).map(([k, v]) => ({
      name: k, loc: v.loc, params: v.params, calls: v.calls, toggles: v.toggles,
    })),
    tagFileMap: Object.fromEntries(Array.from(tagFileMap.entries()).map(([k, v]) => [k, path.relative(ROOT, v)])),
  };
}

async function runContextCollection(ROOT, SRC_DIR, OUTPUT_DIR) {
  const pages = await collectPageEntries();
  const results = [];

  for (const entry of pages) {
    emit({ type: "progress", phase: "context", file: path.relative(ROOT, entry) });
    const ctx = await collectModuleContext(entry);
    if (ctx.authNodes.length > 0) results.push(ctx);
  }

  // Write per-module context files
  const staticDir = path.join(OUTPUT_DIR, "static");
  fs.mkdirSync(staticDir, { recursive: true });

  const indexEntries = [];
  for (const page of results) {
    const safeName = (page.page || "root").replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/, "") || "root";
    const moduleFile = path.join(staticDir, safeName + ".json");
    fs.writeFileSync(moduleFile, JSON.stringify(page, null, 2), "utf-8");
    indexEntries.push({
      page: page.page,
      entry: page.entry,
      file: path.join("dist", "static", safeName + ".json"),
      totalButtons: page.authNodes.length,
      fileCount: page.files.length,
      apiFileCount: page.apiFiles.length,
    });
  }

  const totalButtons = results.reduce((sum, r) => sum + r.authNodes.length, 0);
  const indexFile = path.join(staticDir, "index.json");
  fs.writeFileSync(indexFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalPages: results.length,
    totalButtons,
    pages: indexEntries,
  }, null, 2), "utf-8");

  // Legacy compat
  fs.writeFileSync(path.join(OUTPUT_DIR, "auth-mapping.json"), JSON.stringify(results, null, 2), "utf-8");

  console.log(`[context] 页面数量：${results.length}，按钮总数：${totalButtons}`);
  console.log(`  索引: ${path.relative(ROOT, indexFile)}`);
  console.log(`  模块文件: ${path.relative(ROOT, staticDir)}/<module>.json (${results.length} 个)`);
  return results;
}

// ============================================================
// SECTION: AI Task Preparation (ALL buttons go to AI)
// ============================================================
async function collectModuleFilesForAI(contextData, rootDir) {
  const allFiles = new Set();
  const baseDir = path.dirname(path.join(rootDir, contextData.entry));
  const srcDir = path.join(rootDir, "src");

  // 1. All Vue files in the module directory (and subdirectories)
  const vueFiles = await fg("**/*.vue", { cwd: baseDir, absolute: true });
  vueFiles.forEach(f => allFiles.add(f));

  // 2. All Vue files referenced by tagFileMap (child components used in templates)
  for (const [, relPath] of Object.entries(contextData.tagFileMap || {})) {
    const absPath = path.join(rootDir, relPath);
    if (isFile(absPath)) allFiles.add(absPath);
    // Also collect sibling files in the child component's directory
    const childDir = path.dirname(absPath);
    const siblingVue = await fg("*.vue", { cwd: childDir, absolute: true });
    siblingVue.forEach(f => allFiles.add(f));
  }

  // 3. API files referenced by imports
  for (const imp of (contextData.imports || [])) {
    if (!imp.source) continue;
    if (imp.source.includes("/api") || imp.source.startsWith("@/api") || imp.source.includes("/utils/request")) {
      let resolved;
      if (imp.source.startsWith("@/")) resolved = path.resolve(srcDir, imp.source.slice(2));
      else if (imp.source.startsWith(".")) resolved = path.resolve(baseDir, imp.source);
      if (resolved) {
        const candidates = [resolved, `${resolved}.ts`, `${resolved}.js`,
          path.join(resolved, "index.ts"), path.join(resolved, "index.js")];
        candidates.forEach(c => { try { if (fs.statSync(c).isFile()) allFiles.add(c); } catch {} });
      }
    }
    // Also resolve composable/useXxx imports — they may contain API calls
    if (imp.source.includes("/composables/") || imp.source.includes("/hooks/") || imp.source.includes("/use")) {
      let resolved;
      if (imp.source.startsWith("@/")) resolved = path.resolve(srcDir, imp.source.slice(2));
      else if (imp.source.startsWith(".")) resolved = path.resolve(baseDir, imp.source);
      if (resolved) {
        const candidates = [resolved, `${resolved}.ts`, `${resolved}.js`];
        candidates.forEach(c => { try { if (fs.statSync(c).isFile()) allFiles.add(c); } catch {} });
      }
    }
  }

  // 4. Scan for API directories (module-level + project-level)
  const parentApi = await fg("api/**/*.ts", { cwd: path.dirname(baseDir), absolute: true });
  parentApi.forEach(f => allFiles.add(f));
  const srcApi = await fg("api/**/*.ts", { cwd: srcDir, absolute: true });
  srcApi.forEach(f => allFiles.add(f));

  // 5. Utils/request wrapper
  const requestFiles = await fg("utils/request*.{ts,js}", { cwd: srcDir, absolute: true });
  requestFiles.forEach(f => allFiles.add(f));

  return [...allFiles];
}

function buildAIPrompt(moduleName, contextData, fileContents) {
  const filesSection = fileContents
    .map(({ filePath, content }) => "### File: " + filePath + "\n```\n" + content + "\n```")
    .join("\n\n");

  const buttonsList = contextData.authNodes.map((b, i) => {
    const authClean = (b.authValue || "").replace(/['"]/g, "");
    const events = [...(b.events || []), ...(b.descendantEvents || [])]
      .map(e => `${e.event}="${e.expression}"`).join(", ");
    return `${i + 1}. v-auth="${authClean}" | 名称: "${b.name || ""}" | 标签: ${b.tag} | 文件: ${b.file} | 行: ${b.line}${events ? " | 事件: " + events : ""}`;
  }).join("\n");

  const importsList = (contextData.imports || [])
    .filter(i => i.source && (i.source.includes("/api") || i.source.startsWith("@/api") || i.source.includes("/utils/request")))
    .map(i => `  ${i.local} ← ${i.source} (${i.imported})`)
    .join("\n");

  const functionsList = (contextData.functions || [])
    .filter(f => f.calls.length > 0 || f.toggles.length > 0)
    .map(f => {
      const parts = [];
      if (f.calls.length) parts.push("调用: " + f.calls.join(", "));
      if (f.toggles.length) parts.push("切换: " + f.toggles.join(", "));
      return `  ${f.name}(${(f.params || []).join(", ")}) → ${parts.join("; ")}`;
    })
    .join("\n");

  // Build tagFileMap section for AI
  const tagFileMapEntries = Object.entries(contextData.tagFileMap || {})
    .filter(([tag]) => !['div','span','button','el-button','el-table','el-form','el-input','el-select','el-dialog','el-drawer','el-upload','el-popconfirm','el-tooltip','el-dropdown','el-menu','el-tab-pane','el-tabs','el-card','el-row','el-col','el-icon','template'].includes(tag))
    .map(([tag, file]) => `  <${tag}> → ${file}`)
    .join("\n");

  return `你是一个 Vue 3 + TypeScript 代码分析专家。你的任务是分析每个带权限指令（v-auth）的按钮，**必须追踪到它最终触发的后端 HTTP API 接口**。

## ⛔ 核心原则：不允许返回空 apis

**每个按钮都必须有明确的 API 映射结果。** 你不允许因为"追踪困难"就返回空 apis 或标记为纯 UI。
如果你无法确定具体 API，仍然要给出最佳推测，并将 confidence 设为 "low"，在 reasoning 中说明不确定原因。
**唯一允许返回空 apis 的情况**：按钮确实只做纯前端展示切换（如展开/折叠面板、切换 Tab），没有任何后端交互。

## 🔍 必须追踪的场景（这些不是"纯UI"）

### 1. 弹窗/抽屉触发按钮
按钮点击后打开 Dialog/Drawer/Modal → 子组件中有确认/提交/保存按钮 → 该按钮调用 API
**你必须：**
- 从 @click handler 中找到 visible.value = true / dialogVisible = true 等
- 通过 v-model / :visible 绑定找到对应的 <el-dialog> / <el-drawer> / 自定义组件
- 利用下方的「组件标签→文件映射」找到子组件源码
- 在子组件中找到 confirm/submit/save/handleOk 等处理函数
- 追踪到 request()/axios/fetch 调用，提取 url + method
- **将原始按钮（不是子组件按钮）关联到这个 API**

### 2. 搜索/重置/刷新按钮
按钮触发列表刷新 → 通常调用 getList/fetchData/loadData 等函数 → 内部有 GET API
**你必须：** 追踪 handler → 找到实际的 request 调用 → 提取 GET url

### 3. 下载/导出按钮
可能通过 blob download、window.open、a.href 等方式
**你必须：** 找到下载函数 → 提取 URL（可能是 GET 或 POST）→ method 标为 GET/DOWNLOAD

### 4. 条件分支按钮
如 scope.row.adminFlag ? iam.user.removeAdmin : iam.user.authAdmin
**你必须：** 分析两个分支分别调用的 API，全部列出

### 5. 表格行操作按钮（scope slot 内）
编辑/删除/授权等操作按钮
**你必须：** 追踪 @click → handler → API，注意参数可能来自 scope.row

### 6. el-upload 组件
追踪 :http-request / :on-success / :before-upload → 找到上传 API

### 7. router.push / window.open
→ method: "NAVIGATE", url: 目标路径

## 模块: ${moduleName}

## 按钮清单 (${contextData.authNodes.length} 个):
${buttonsList}

## 组件标签 → 文件映射:
${tagFileMapEntries || "(无自定义组件)"}

## 导入关系（API 相关）:
${importsList || "(无)"}

## 函数调用图:
${functionsList || "(无)"}

## 源码:
${filesSection}

## 输出格式
严格输出 JSON 数组，每个元素对应一个按钮：
[
  {
    "authId": "去掉引号的权限标识",
    "label": "按钮显示文本",
    "apis": [{ "method": "GET|POST|PUT|DELETE|NAVIGATE|DOWNLOAD", "url": "/api/path", "apiFunction": "函数名", "note": "可选说明" }],
    "confidence": "high|medium|low",
    "reasoning": "完整追踪路径，如：新建按钮 → handleAdd → openDialog → AddModal.vue → handleSubmit → POST /api/apps"
  }
]

**再次强调**：
- 为所有 ${contextData.authNodes.length} 个按钮都输出结果
- 弹窗/抽屉按钮必须追踪到子组件内的最终 API
- 搜索/刷新按钮必须追踪到列表加载 API
- 只有纯展示切换才返回空 apis
- confidence=low 比空 apis 好得多`;
}

// ============================================================
// Smart Button Grouping — keep related buttons together
// ============================================================
function groupButtonsSmart(authNodes, functionsList, maxGroupSize = 20) {
  if (authNodes.length <= maxGroupSize) return [authNodes];

  const handlerToggles = new Map();
  for (const fn of (functionsList || [])) {
    if (fn.toggles && fn.toggles.length > 0) {
      handlerToggles.set(fn.name, new Set(fn.toggles));
    }
  }

  const buttonKeys = authNodes.map((b, idx) => {
    const keys = new Set();
    keys.add("file:" + b.file);
    const allEvents = [...(b.events || []), ...(b.descendantEvents || [])];
    for (const evt of allEvents) {
      const handlers = extractHandlerNamesFromExpression(evt.expression);
      for (const h of handlers) {
        keys.add("handler:" + h);
        const toggles = handlerToggles.get(h);
        if (toggles) {
          for (const t of toggles) keys.add("toggle:" + t);
        }
      }
    }
    return { idx, keys };
  });

  const parent = authNodes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  const keyToButtons = new Map();
  for (const bk of buttonKeys) {
    for (const key of bk.keys) {
      if (!keyToButtons.has(key)) keyToButtons.set(key, []);
      keyToButtons.get(key).push(bk.idx);
    }
  }
  for (const [, indices] of keyToButtons) {
    for (let i = 1; i < indices.length; i++) {
      union(indices[0], indices[i]);
    }
  }

  const groups = new Map();
  for (let i = 0; i < authNodes.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(authNodes[i]);
  }

  const result = [];
  for (const [, group] of groups) {
    if (group.length <= maxGroupSize) {
      result.push(group);
    } else {
      const byFile = new Map();
      for (const b of group) {
        if (!byFile.has(b.file)) byFile.set(b.file, []);
        byFile.get(b.file).push(b);
      }
      let currentChunk = [];
      for (const [, fileButtons] of byFile) {
        if (currentChunk.length + fileButtons.length > maxGroupSize && currentChunk.length > 0) {
          result.push(currentChunk);
          currentChunk = [];
        }
        currentChunk.push(...fileButtons);
      }
      if (currentChunk.length > 0) result.push(currentChunk);
    }
  }

  return result;
}

async function prepareAITasks() {
  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const staticIndexFile = path.join(OUTPUT_DIR, "static", "index.json");
  const mappingFile = path.join(OUTPUT_DIR, "auth-mapping.json");

  // Load context data
  let modules = [];
  if (fs.existsSync(staticIndexFile)) {
    try {
      const index = JSON.parse(fs.readFileSync(staticIndexFile, "utf-8"));
      for (const entry of (index.pages || [])) {
        if (entry.totalButtons > 0 && entry.file) {
          const moduleFile = path.join(ROOT, entry.file);
          if (fs.existsSync(moduleFile)) {
            modules.push(JSON.parse(fs.readFileSync(moduleFile, "utf-8")));
          }
        }
      }
    } catch {}
  }
  if (modules.length === 0) {
    if (!fs.existsSync(mappingFile)) {
      console.error("❌ 未找到上下文数据，请先运行 --static-only");
      process.exit(1);
    }
    modules = JSON.parse(fs.readFileSync(mappingFile, "utf-8"));
  }

  const totalButtons = modules.reduce((sum, m) => sum + (m.authNodes?.length || 0), 0);
  const moduleCount = modules.length;

  console.log(`📊 共 ${totalButtons} 个按钮，分布在 ${moduleCount} 个模块`);
  console.log(`🔍 全部交由 AI 分析权限-API 映射`);
  emit({ type: "ai-start", total: totalButtons, modules: moduleCount });

  if (totalButtons === 0) {
    console.log("✅ 没有发现带权限指令的按钮");
    emit({ type: "done" });
    return;
  }

  // Build tasks
  const tasks = [];
  const resultsDir = path.join(OUTPUT_DIR, "ai-results");
  fs.mkdirSync(resultsDir, { recursive: true });

  const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
  const cache = loadCache(cacheFile);

  let cachedModules = 0;

  for (const ctx of modules) {
    const moduleName = ctx.page;
    const safeName = moduleName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "root";

    // Check if ALL buttons in this module are cached
    const allCached = ctx.authNodes.every(b => {
      const cleanId = (b.authValue || "").replace(/['"]/g, "");
      return cache[moduleName + "|" + b.authValue] || cache[moduleName + "|" + cleanId];
    });
    if (allCached && ctx.authNodes.length > 0) {
      cachedModules++;
      emit({ type: "ai-progress", current: tasks.length + 1, total: moduleCount, page: moduleName, status: "cache-hit" });
      continue;
    }

    // Collect files for AI context (shared across chunks)
    const relevantFiles = await collectModuleFilesForAI(ctx, ROOT);
    const fileContents = [];
    let totalSize = 0;
    const MAX_SIZE = CONFIG.ai.maxFileSize || 200000;

    for (const filePath of relevantFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (totalSize + content.length > MAX_SIZE) continue;
        fileContents.push({ filePath: path.relative(ROOT, filePath), content });
        totalSize += content.length;
      } catch {}
    }

    // Smart grouping: keep related buttons together (same handler/dialog/file)
    const groups = groupButtonsSmart(ctx.authNodes, ctx.functions);

    if (groups.length > 1) {
      console.log(`  🧩 ${moduleName}: ${ctx.authNodes.length} buttons → ${groups.length} semantic groups (${groups.map(g => g.length).join("+")})`);
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const groupNodes = groups[gi];
      const groupCtx = { ...ctx, authNodes: groupNodes };
      const groupId = groups.length > 1 ? `${safeName}_g${gi + 1}` : safeName;
      const groupLabel = groups.length > 1 ? `${moduleName} (group ${gi + 1}/${groups.length})` : moduleName;

      const prompt = buildAIPrompt(groupLabel, groupCtx, fileContents);

      tasks.push({
        id: groupId,
        module: moduleName,
        buttons: groupNodes.map(b => ({ authValue: b.authValue, name: b.name, file: b.file, tag: b.tag })),
        prompt,
        outputFile: path.join(ROOT, CONFIG.outputDir, "ai-results", groupId + ".json"),
      });
    }

    emit({ type: "ai-progress", current: tasks.length + cachedModules, total: moduleCount, page: moduleName, status: "pending" });
  }

  // Write task files
  const tasksDir = path.join(OUTPUT_DIR, "ai-tasks");
  fs.mkdirSync(tasksDir, { recursive: true });

  const indexEntries = [];
  for (const task of tasks) {
    const taskFile = path.join(tasksDir, task.id + ".json");
    fs.writeFileSync(taskFile, JSON.stringify({
      module: task.module,
      buttons: task.buttons,
      prompt: task.prompt,
      outputFile: task.outputFile,
    }, null, 2), "utf-8");
    indexEntries.push({
      id: task.id,
      module: task.module,
      buttons: task.buttons.length,
      taskFile: path.join(tasksDir, task.id + ".json"),
      outputFile: task.outputFile,
    });
  }

  const indexFile = path.join(tasksDir, "index.json");
  fs.writeFileSync(indexFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalButtons,
    totalModules: moduleCount,
    cachedModules,
    pendingModules: tasks.length,
    tasks: indexEntries,
  }, null, 2), "utf-8");

  console.log(`\n📋 AI 任务目录: ${path.relative(ROOT, tasksDir)}`);
  console.log(`   待分析模块: ${tasks.length} 个`);
  console.log(`   缓存命中模块: ${cachedModules} 个`);

  const BATCH_SIZE = 2;
  const batches = [];
  for (let i = 0; i < indexEntries.length; i += BATCH_SIZE) {
    batches.push(indexEntries.slice(i, i + BATCH_SIZE).map(t => ({ module: t.module, buttons: t.buttons, taskFile: t.taskFile, outputFile: t.outputFile })));
  }
  emit({ type: "tasks-ready", indexFile, pending: tasks.length, cached: cachedModules, batchSize: BATCH_SIZE, totalBatches: batches.length, batches });
}

// ============================================================
// SECTION: LLM Integration
// ============================================================
function loadAICredentials() {
  // Priority: CONFIG > env vars > platform config files
  // Supports: DSH, Pi, Codex, Claude Code, Cursor, and generic env vars
  let apiKey = CONFIG.ai.apiKey || "";
  let baseUrl = CONFIG.ai.baseUrl || "";
  let model = CONFIG.ai.model || "";

  // ── Layer 1: Environment variables (set by platform or user) ──
  if (!apiKey) {
    const envKeys = [
      { key: "AI_API_KEY", url: null, mdl: null },
      { key: "DEEPSEEK_API_KEY", url: "https://api.deepseek.com/v1", mdl: "deepseek-chat" },
      { key: "OPENAI_API_KEY", url: "https://api.openai.com/v1", mdl: "gpt-4o-mini" },
      { key: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com/v1", mdl: "claude-sonnet-4-20250514" },
      { key: "QWEN_TOKEN_PLAN_CN_API_KEY", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", mdl: "qwen-plus" },
    ];
    for (const e of envKeys) {
      const val = process.env[e.key];
      if (val) {
        apiKey = val;
        if (!baseUrl && e.url) baseUrl = e.url;
        if (!model && e.mdl) model = e.mdl;
        break;
      }
    }
  }
  // Also check platform-specific env vars (Codex custom providers, etc.)
  if (!apiKey) {
    const extraEnvKeys = ["CRS_OAI_KEY", "OPENROUTER_API_KEY"];
    for (const k of extraEnvKeys) {
      const val = process.env[k];
      if (val) { apiKey = val; break; }
    }
  }

  // Apply env-based URL/model overrides
  if (!baseUrl) baseUrl = process.env.AI_BASE_URL || process.env.OPENAI_BASE_URL || "";
  if (!model) model = process.env.AI_MODEL || process.env.OPENAI_MODEL || "";

  // ── Layer 2: Platform credential files ──
  if (!apiKey) {
    const home = process.env.HOME || "";

    // 2a. DSH credentials (~/.dsh/.credentials.yaml)
    const dshCredPath = path.join(home, ".dsh", ".credentials.yaml");
    if (fs.existsSync(dshCredPath)) {
      try {
        const content = fs.readFileSync(dshCredPath, "utf-8");
        const patterns = [
          { key: /DEEPSEEK_API_KEY:\s*(.+)/, url: "https://api.deepseek.com/v1", mdl: "deepseek-chat" },
          { key: /AI_API_KEY:\s*(.+)/, url: null, mdl: null },
          { key: /OPENAI_API_KEY:\s*(.+)/, url: "https://api.openai.com/v1", mdl: "gpt-4o-mini" },
          { key: /QWEN_TOKEN_PLAN_CN_API_KEY:\s*(.+)/, url: "https://dashscope.aliyuncs.com/compatible-mode/v1", mdl: "qwen-plus" },
        ];
        for (const p of patterns) {
          const match = content.match(p.key);
          if (match && match[1].trim()) {
            apiKey = match[1].trim();
            if (!baseUrl && p.url) baseUrl = p.url;
            if (!model && p.mdl) model = p.mdl;
            break;
          }
        }
      } catch {}
    }

    // 2b. Pi agent auth (~/.pi/agent/auth.json)
    if (!apiKey) {
      const piAuthPath = path.join(home, ".pi", "agent", "auth.json");
      if (fs.existsSync(piAuthPath)) {
        try {
          const piAuth = JSON.parse(fs.readFileSync(piAuthPath, "utf-8"));
          const providerMap = {
            deepseek: { url: "https://api.deepseek.com/v1", mdl: "deepseek-chat" },
            openai: { url: "https://api.openai.com/v1", mdl: "gpt-4o-mini" },
            anthropic: { url: "https://api.anthropic.com/v1", mdl: "claude-sonnet-4-20250514" },
            "qwen-token-plan-cn": { url: "https://dashscope.aliyuncs.com/compatible-mode/v1", mdl: "qwen-plus" },
            "qwen-token-plan": { url: "https://dashscope.aliyuncs.com/compatible-mode/v1", mdl: "qwen-plus" },
            openrouter: { url: "https://openrouter.ai/api/v1", mdl: "deepseek/deepseek-chat" },
          };
          for (const [provider, cfg] of Object.entries(providerMap)) {
            const entry = piAuth[provider];
            if (entry?.key && !entry.key.startsWith("$") && !entry.key.startsWith("!")) {
              apiKey = entry.key;
              if (!baseUrl) baseUrl = cfg.url;
              if (!model) model = cfg.mdl;
              break;
            }
          }
        } catch {}
      }
    }

    // 2c. Codex config (~/.codex/config.toml) — extract custom provider base_url + env_key
    if (!apiKey) {
      const codexConfigPath = path.join(home, ".codex", "config.toml");
      if (fs.existsSync(codexConfigPath)) {
        try {
          const content = fs.readFileSync(codexConfigPath, "utf-8");
          // Extract env_key from [model_providers.*] sections
          const envKeyMatch = content.match(/env_key\s*=\s*"([^"]+)"/);
          if (envKeyMatch) {
            const envKeyName = envKeyMatch[1];
            const envVal = process.env[envKeyName];
            if (envVal) {
              apiKey = envVal;
              // Also extract base_url from the same section
              const baseUrlMatch = content.match(/base_url\s*=\s*"([^"]+)"/);
              if (baseUrlMatch && !baseUrl) baseUrl = baseUrlMatch[1];
            }
          }
        } catch {}
      }
    }

    // 2d. Tool-specific credentials (~/.config/dsh-vue-auth-analyzer/credentials.yaml)
    if (!apiKey) {
      const toolCredPath = path.join(home, ".config", "dsh-vue-auth-analyzer", "credentials.yaml");
      if (fs.existsSync(toolCredPath)) {
        try {
          const content = fs.readFileSync(toolCredPath, "utf-8");
          const patterns = [
            { key: /AI_API_KEY:\s*(.+)/, url: null, mdl: null },
            { key: /DEEPSEEK_API_KEY:\s*(.+)/, url: "https://api.deepseek.com/v1", mdl: "deepseek-chat" },
            { key: /OPENAI_API_KEY:\s*(.+)/, url: "https://api.openai.com/v1", mdl: "gpt-4o-mini" },
          ];
          for (const p of patterns) {
            const match = content.match(p.key);
            if (match && match[1].trim()) {
              apiKey = match[1].trim();
              if (!baseUrl && p.url) baseUrl = p.url;
              if (!model && p.mdl) model = p.mdl;
              break;
            }
          }
        } catch {}
      }
    }
  }

  // ── Defaults ──
  if (!baseUrl) baseUrl = "https://api.deepseek.com/v1";
  if (!model) model = "deepseek-chat";

  return { apiKey, baseUrl, model };
}

async function callLLM(config, messages, maxRetries = 3) {
  const url = config.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + config.apiKey },
        body: JSON.stringify({
          model: config.model, messages, temperature: 0.1, max_tokens: 16384,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429 || res.status === 402) {
        const wait = 5000 * (attempt + 1);
        console.log("  ⏳ 429 rate limited, waiting " + (wait / 1000) + "s...");
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        throw new Error("HTTP " + res.status + ": " + errText.substring(0, 200));
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty response content");
      let jsonStr = content.trim();
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
      return JSON.parse(jsonStr);
    } catch (err) {
      if (attempt < maxRetries - 1 && !err.message.includes("429")) {
        console.log("  ⚠️ Attempt " + (attempt + 1) + " failed: " + err.message);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      } else throw err;
    }
  }
}

async function runAICompletion() {
  const creds = loadAICredentials();
  if (!creds.apiKey) {
    console.error("❌ No API key found. Set AI_API_KEY env var, add to ~/.dsh/.credentials.yaml, or configure in GUI.");
    process.exit(1);
  }

  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const tasksIndexFile = path.join(OUTPUT_DIR, "ai-tasks", "index.json");
  if (!fs.existsSync(tasksIndexFile)) {
    console.error("❌ No ai-tasks/index.json found. Run --prepare-ai first.");
    process.exit(1);
  }

  const tasksIndex = JSON.parse(fs.readFileSync(tasksIndexFile, "utf-8"));
  const resultsDir = path.join(OUTPUT_DIR, "ai-results");
  fs.mkdirSync(resultsDir, { recursive: true });

  const concurrency = Math.min(Math.max(CONFIG.ai.concurrency || 2, 1), 5);
  const totalTasks = tasksIndex.tasks.length;

  console.log("🤖 Running AI analysis (all buttons)");
  console.log("   Model: " + creds.model);
  console.log("   Base URL: " + creds.baseUrl);
  console.log("   Tasks: " + totalTasks + ", Concurrency: " + concurrency);
  emit({ type: "ai-start", total: totalTasks, modules: totalTasks });

  let completed = 0;
  let failed = 0;

  async function processTask(task) {
    const taskFilePath = path.isAbsolute(task.taskFile) ? task.taskFile : path.join(ROOT, task.taskFile);
    if (!fs.existsSync(taskFilePath)) { console.log("⚠️ Task file not found: " + task.taskFile); return null; }

    const outputFile = path.isAbsolute(task.outputFile) ? task.outputFile : path.join(ROOT, task.outputFile);
    if (fs.existsSync(outputFile)) {
      completed++;
      emit({ type: "ai-progress", current: completed, total: totalTasks, page: task.module, status: "cache-hit" });
      console.log("[" + completed + "/" + totalTasks + "] ⏭ " + task.module + " (already done)");
      return;
    }

    const taskData = JSON.parse(fs.readFileSync(taskFilePath, "utf-8"));
    console.log("[" + (completed + 1) + "/" + totalTasks + "] 🔄 分析中: " + task.module + " (" + task.buttons + " buttons)");
    emit({ type: "ai-progress", current: completed + 1, total: totalTasks, page: task.module, status: "analyzing" });

    try {
      const messages = [
        { role: "system", content: "You are a Vue 3 + TypeScript code analysis expert. Analyze source code to identify permissions and find the backend API endpoints that buttons ultimately trigger. Output strictly valid JSON." },
        { role: "user", content: taskData.prompt + "\n\nOutput strictly as JSON: { \"results\": [...], \"module\": \"" + task.module + "\" }" },
      ];
      const result = await callLLM(creds, messages);
      fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf-8");
      completed++;
      emit({ type: "ai-progress", current: completed, total: totalTasks, page: task.module, status: "done" });
      console.log("[" + completed + "/" + totalTasks + "] ✅ " + task.module);
    } catch (err) {
      failed++; completed++;
      console.log("[" + completed + "/" + totalTasks + "] ❌ " + task.module + ": " + err.message);
      emit({ type: "ai-progress", current: completed, total: totalTasks, page: task.module, status: "failed", error: err.message });
    }
  }

  const queue = [...tasksIndex.tasks];
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push((async () => { while (queue.length > 0) await processTask(queue.shift()); })());
  }
  await Promise.all(workers);

  emit({ type: "ai-done", stats: { total: totalTasks, llmCalls: totalTasks - failed, failed } });
  console.log("\n📋 AI analysis complete: " + (totalTasks - failed) + "/" + totalTasks + " succeeded, " + failed + " failed");
}

// ============================================================
// SECTION: Merge AI Results
// ============================================================
function mergeAIResults() {
  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const resultsDir = path.join(OUTPUT_DIR, "ai-results");
  const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
  const cache = loadCache(cacheFile);

  // Build authId → {page, authValue} mapping from context data
  const authIdToOriginal = new Map();
  const staticIndexFile = path.join(OUTPUT_DIR, "static", "index.json");
  const mappingFile = path.join(OUTPUT_DIR, "auth-mapping.json");

  let loaded = false;
  if (fs.existsSync(staticIndexFile)) {
    try {
      const index = JSON.parse(fs.readFileSync(staticIndexFile, "utf-8"));
      for (const entry of (index.pages || [])) {
        if (entry.file) {
          const moduleFile = path.join(ROOT, entry.file);
          if (fs.existsSync(moduleFile)) {
            const page = JSON.parse(fs.readFileSync(moduleFile, "utf-8"));
            (page.authNodes || []).forEach(b => {
              const cleanId = (b.authValue || "").replace(/['"]/g, "");
              if (cleanId && !authIdToOriginal.has(cleanId)) {
                authIdToOriginal.set(cleanId, { page: page.page, authValue: b.authValue });
              }
            });
          }
        }
      }
      loaded = authIdToOriginal.size > 0;
    } catch {}
  }
  if (!loaded && fs.existsSync(mappingFile)) {
    try {
      const mapping = JSON.parse(fs.readFileSync(mappingFile, "utf-8"));
      (Array.isArray(mapping) ? mapping : []).forEach(page => {
        (page.authNodes || []).forEach(b => {
          const cleanId = (b.authValue || "").replace(/['"]/g, "");
          if (cleanId && !authIdToOriginal.has(cleanId)) {
            authIdToOriginal.set(cleanId, { page: page.page, authValue: b.authValue });
          }
        });
      });
    } catch {}
  }

  if (!fs.existsSync(resultsDir)) { console.error("❌ 未找到 ai-results/ 目录"); process.exit(1); }
  const resultFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith(".json"));
  if (resultFiles.length === 0) { console.error("❌ ai-results/ 中没有结果文件"); process.exit(1); }

  const allResults = [];
  let fileCount = 0;

  for (const file of resultFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf-8"));
      const moduleName = data.module || file.replace(/\.json$/, "");
      const results = Array.isArray(data) ? data : (data.results || []);
      results.forEach(r => {
        const original = authIdToOriginal.get(r.authId);
        if (original) { r.page = original.page; r.authValue = original.authValue; }
        else if (!r.page) r.page = moduleName;
        allResults.push(r);
        if (r.authId) {
          const page = r.page || moduleName;
          const authVal = r.authValue || ("'" + r.authId + "'");
          cache[page + "|" + authVal] = { apis: r.apis || [], confidence: r.confidence || "medium", reasoning: r.reasoning || "" };
        }
      });
      fileCount++;
    } catch (e) { console.log("⚠️ 跳过无效结果文件: " + file + " (" + e.message + ")"); }
  }

  saveCache(cacheFile, cache);

  const output = {
    generatedAt: new Date().toISOString(),
    model: "ai-analysis",
    stats: {
      total: allResults.length,
      highConfidence: allResults.filter(r => r.confidence === "high").length,
      mediumConfidence: allResults.filter(r => r.confidence === "medium").length,
      lowConfidence: allResults.filter(r => r.confidence === "low").length,
      failed: allResults.filter(r => r.confidence === "failed").length,
    },
    results: allResults,
  };

  const aiOutputFile = path.join(OUTPUT_DIR, "auth-mapping-ai.json");
  fs.writeFileSync(aiOutputFile, JSON.stringify(output, null, 2), "utf-8");

  emit({ type: "ai-done", stats: output.stats });
  console.log("📋 AI 结果合并完成");
  console.log("   结果文件: " + fileCount + " 个");
  console.log("   按钮总数: " + allResults.length);
  console.log("   🟢 高: " + output.stats.highConfidence + " 🟡 中: " + output.stats.mediumConfidence + " 🔴 低: " + output.stats.lowConfidence);
  console.log("   输出: " + path.relative(ROOT, aiOutputFile));
}

// ─── Cache ──────────────────────────────────────────────
function loadCache(cacheFile) {
  try { return JSON.parse(fs.readFileSync(cacheFile, "utf-8")); } catch { return {}; }
}
function saveCache(cacheFile, cache) {
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
}

// ============================================================
// SECTION: Final Merge (AI results → final report)
// ============================================================
function mergeResults(contextData, aiData) {
  const aiMap = new Map();
  if (aiData && aiData.results) {
    aiData.results.forEach(r => {
      const key = r.page + "|" + r.authId;
      aiMap.set(key, r);
      // Also try with authValue
      if (r.authValue) {
        aiMap.set(r.page + "|" + r.authValue, r);
      }
    });
  }

  const pages = [];
  let aiMatched = 0, uiOnly = 0, totalButtons = 0;

  (contextData || []).forEach(page => {
    const buttons = [];
    (page.authNodes || []).forEach(b => {
      totalButtons++;
      const cleanId = (b.authValue || "").replace(/['"]/g, "");
      const aiResult = aiMap.get(page.page + "|" + cleanId) || aiMap.get(page.page + "|" + b.authValue);

      if (aiResult && aiResult.apis && aiResult.apis.length > 0) {
        aiMatched++;
        buttons.push({
          authId: cleanId,
          label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
          apis: aiResult.apis.map(a => ({ method: a.method, url: a.url, apiFunction: a.apiFunction || "", note: a.note || "" })),
          source: "ai", confidence: aiResult.confidence || "medium", reasoning: aiResult.reasoning || "",
        });
      } else if (aiResult) {
        uiOnly++;
        buttons.push({
          authId: cleanId,
          label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
          apis: [], source: "ai", confidence: aiResult.confidence || "high", reasoning: aiResult.reasoning || "Pure UI operation",
        });
      } else {
        buttons.push({
          authId: cleanId,
          label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
          apis: [], source: "unresolved", confidence: "unresolved",
        });
      }
    });
    pages.push({ page: page.page, buttons });
  });

  const coverage = totalButtons > 0 ? ((aiMatched) / totalButtons * 100).toFixed(1) + "%" : "0%";
  return { generatedAt: new Date().toISOString(), stats: { totalButtons, aiMatched, uiOnly, coverage }, pages };
}

// ============================================================
// MAIN ENTRY
// ============================================================
async function main() {
  const opts = parseArgs();
  if (opts.help) { printHelp(); return; }
  NDJSON_MODE = opts.ndjson;

  process.on("SIGINT", () => { emit({ type: "cancelled" }); process.exit(130); });

  ROOT = CONFIG.rootDir;
  SRC_DIR = path.join(ROOT, CONFIG.viewsDir);
  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const STATIC_OUTPUT = path.join(OUTPUT_DIR, "auth-mapping.json");
  const AI_OUTPUT = path.join(OUTPUT_DIR, "auth-mapping-ai.json");
  const MERGED_OUTPUT = path.join(OUTPUT_DIR, "auth-mapping-merged.json");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let contextData = null;
  let aiData = null;

  // Phase 1: Context collection (unless --merge-ai only)
  if (!opts.mergeAi) {
    emit({ type: "phase", phase: "context", label: "Context Collection" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 1: Context Collection (static structure analysis)");
    console.log("=".repeat(60));
    contextData = await runContextCollection(ROOT, SRC_DIR, OUTPUT_DIR);
    fs.writeFileSync(STATIC_OUTPUT, JSON.stringify(contextData, null, 2), "utf-8");
  } else {
    if (fs.existsSync(STATIC_OUTPUT)) {
      contextData = JSON.parse(fs.readFileSync(STATIC_OUTPUT, "utf-8"));
    }
  }

  // Phase 2: AI analysis
  if (opts.runAi) {
    emit({ type: "phase", phase: "prepare-ai", label: "Prepare AI Tasks" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2a: Prepare AI Tasks");
    console.log("=".repeat(60));
    if (opts.noCache) {
      const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
      console.log("Cache cleared.");
    }
    await prepareAITasks();

    emit({ type: "phase", phase: "run-ai", label: "Run AI Analysis" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2b: Run AI Analysis");
    console.log("=".repeat(60));
    await runAICompletion();

    emit({ type: "phase", phase: "merge-ai", label: "Merge AI Results" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2c: Merge AI Results");
    console.log("=".repeat(60));
    mergeAIResults();
    if (fs.existsSync(AI_OUTPUT)) aiData = JSON.parse(fs.readFileSync(AI_OUTPUT, "utf-8"));
  } else if (opts.mergeAi) {
    emit({ type: "phase", phase: "merge-ai", label: "Merge AI Results" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2: Merge AI Results");
    console.log("=".repeat(60));
    mergeAIResults();
    if (fs.existsSync(AI_OUTPUT)) aiData = JSON.parse(fs.readFileSync(AI_OUTPUT, "utf-8"));
  } else if (!opts.staticOnly && CONFIG.ai.enabled) {
    emit({ type: "phase", phase: "prepare-ai", label: "Prepare AI Tasks" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2a: Prepare AI Tasks");
    console.log("=".repeat(60));
    if (opts.noCache) {
      const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
    }
    await prepareAITasks();

    emit({ type: "phase", phase: "run-ai", label: "Run AI Analysis" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2b: Run AI Analysis");
    console.log("=".repeat(60));
    await runAICompletion();

    emit({ type: "phase", phase: "merge-ai", label: "Merge AI Results" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2c: Merge AI Results");
    console.log("=".repeat(60));
    mergeAIResults();
    if (fs.existsSync(AI_OUTPUT)) aiData = JSON.parse(fs.readFileSync(AI_OUTPUT, "utf-8"));
  }

  // Phase 3: Final merge
  if (contextData && !opts.staticOnly) {
    emit({ type: "phase", phase: "merge", label: "Final Merge" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 3: Final Merge");
    console.log("=".repeat(60));
    const merged = mergeResults(contextData, aiData);
    fs.writeFileSync(MERGED_OUTPUT, JSON.stringify(merged, null, 2), "utf-8");
    console.log("Merged output: " + path.relative(ROOT, MERGED_OUTPUT));
    console.log("\nStats:", JSON.stringify(merged.stats, null, 2));
  }

  console.log("\nDone!");
  emit({ type: "done" });
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
