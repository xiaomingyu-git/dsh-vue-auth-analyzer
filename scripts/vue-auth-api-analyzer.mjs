#!/usr/bin/env node
/**
 * Vue Auth-API Analyzer - 按钮-权限-API 映射分析器（单文件可移植版）
 *
 * 功能：
 *   1. 静态分析：AST 解析 Vue SFC，追踪 v-auth -> @click handler -> API URL/method
 *   2. AI 补全：对静态分析未覆盖的按钮，调用 LLM 分析源码补全映射
 *   3. 合并输出：将两种分析结果合并为统一的 auth-mapping-merged.json
 *
 * 用法：
 *   node vue-auth-api-analyzer.mjs                  # 完整分析（静态 + AI）
 *   node vue-auth-api-analyzer.mjs --static-only     # 仅静态分析
 *   node vue-auth-api-analyzer.mjs --prepare-ai      # 准备 AI 任务（per-module 文件）
 *   node vue-auth-api-analyzer.mjs --merge-ai        # 合并 AI 结果
 *   node vue-auth-api-analyzer.mjs --no-cache        # 清除 AI 缓存
 *   node vue-auth-api-analyzer.mjs --ndjson          # NDJSON 进度输出
 *   node vue-auth-api-analyzer.mjs --help            # 显示帮助
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
// CONFIG - 迁移到其他项目时只需修改这里
// ============================================================
const CONFIG = {
  rootDir: process.cwd(),
  viewsDir: "src/views",
  excludePatterns: ["**/components/**", "**/login/**", "**/profile/**"],
  authDirectiveName: "auth",  // Change to "permission", "has", etc.
  i18nFile: "src/lang/package/zh-cn.ts",  // Set to your i18n file path
  outputDir: "dist",
  ai: {
    enabled: true,
    maxFileSize: 120000,  // Max total file content size per module batch (bytes)
  },
};

// Module-level variables set by main()
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
  const opts = { staticOnly: false, noCache: false, help: false, ndjson: false, prepareAi: false, mergeAi: false };
  for (const a of args) {
    if (a === "--static-only") opts.staticOnly = true;
    else if (a === "--no-cache") opts.noCache = true;
    else if (a === "--ndjson") opts.ndjson = true;
    else if (a === "--prepare-ai") opts.prepareAi = true;
    else if (a === "--merge-ai") opts.mergeAi = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

function printHelp() {
  console.log(`
Vue Auth-API Analyzer v2

Usage:
  node vue-auth-api-analyzer.mjs [options]

Options:
  --static-only    Only run static AST analysis
  --prepare-ai     Prepare AI tasks (per-module files for subagent processing)
  --merge-ai       Merge AI results from dist/ai-results/*.json
  --no-cache       Clear AI cache before preparing tasks
  --ndjson         Output progress as NDJSON events
  -h, --help       Show this help

Workflow:
  1. --static-only      → dist/auth-mapping.json
  2. --prepare-ai       → dist/ai-tasks/index.json + per-module files
  3. (subagents write)  → dist/ai-results/<module>.json
  4. --merge-ai         → dist/auth-mapping-ai.json + merged report

Output:
  dist/auth-mapping.json          Static analysis results
  dist/auth-mapping-ai.json       AI completion results
  dist/auth-mapping-merged.json   Final merged report
  dist/ai-tasks/index.json        AI task index (small, no source code)
  dist/ai-tasks/<module>.json     Per-module task files (with prompts)
  dist/ai-results/<module>.json   Per-module AI results
  dist/.ai-auth-cache.json        Incremental AI cache
`);
}

// ============================================================
// SECTION: Expression Analysis
// ============================================================
const visitorKeys = (() => {
  try {
    return require("@babel/types").VISITOR_KEYS;
  } catch {
    return {};
  }
})();

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
        (callee.property.type === "Identifier" ||
          callee.property.type === "StringLiteral")
      ) {
        const prop =
          callee.property.type === "Identifier"
            ? callee.property.name
            : callee.property.value;
        names.add(`${callee.object.name}.${prop}`);
      }
    });
    if (ast.type === "Identifier") names.add(ast.name);
    return Array.from(names);
  } catch {
    return [expression.split("(")[0].trim()].filter(Boolean);
  }
}

function extractAssignmentsFromExpression(expression) {
  if (!expression) return [];
  try {
    const ast = parseExpression(expression, { plugins: ["typescript", "jsx"] });
    const vars = new Set();
    walk(ast, (node) => {
      if (node.type === "AssignmentExpression" && node.operator === "=") {
        const name = extractVarName(node.left);
        if (name) vars.add(name);
      }
    });
    return Array.from(vars);
  } catch {
    return [];
  }
}

function extractVarName(node) {
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.property.type === "Identifier" &&
    node.property.name === "value"
  ) {
    return node.object.name;
  }
  return null;
}

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

// ============================================================
// SECTION: i18n Translation Loading
// ============================================================
function loadZhCnTranslations(rootDir) {
  const file = path.join(rootDir, "src", "lang", "package", "zh-cn.ts");
  if (!fs.existsSync(file)) return {};
  const code = fs.readFileSync(file, "utf-8");
  let ast;
  try {
    ast = parseScript(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
    });
  } catch (err) {
    console.warn("[analyze-auth-apis] 解析 zh-cn.ts 失败", err.message);
    return {};
  }

  const exportNode = ast.program.body.find(
    (stmt) => stmt.type === "ExportDefaultDeclaration"
  );
  if (!exportNode || exportNode.declaration.type !== "ObjectExpression") {
    return {};
  }

  return objectExpressionToObject(exportNode.declaration);
}

function objectExpressionToObject(node) {
  const obj = {};
  node.properties.forEach((prop) => {
    if (prop.type !== "ObjectProperty") return;
    const key =
      prop.key.type === "Identifier" ? prop.key.name : prop.key.value ?? null;
    if (!key) return;
    if (prop.value.type === "StringLiteral") {
      obj[key] = prop.value.value;
    } else if (prop.value.type === "ObjectExpression") {
      obj[key] = objectExpressionToObject(prop.value);
    }
  });
  return obj;
}

// ============================================================
// SECTION: API Call Resolution
// ============================================================
const apiModuleCache = new Map();

function resolveApiCall(node, calleeName, imports, filename, srcDir) {
  const importInfo =
    imports.get(calleeName) ?? imports.get(calleeName?.split(".")[0]);
  const fromApiModule =
    importInfo &&
    (importInfo.source.includes("/api") || importInfo.source.startsWith("@/api"));
  const isRequest =
    importInfo && importInfo.source.includes("/utils/request");

  if (!fromApiModule && !isRequest) return null;

  const firstArg = node.arguments?.[0];
  const config =
    firstArg && firstArg.type === "ObjectExpression"
      ? extractRequestConfig(firstArg)
      : {};

  let apiMeta = { ...config, argExpr: firstArg ? stringifyExpression(firstArg) : undefined };

  if (fromApiModule) {
    const apiModulePath = resolveApiModulePath(importInfo.source, filename, srcDir);
    if (apiModulePath) {
      const fnName = calleeName.split(".").pop();
      const apiInfo = loadApiDefinition(apiModulePath)?.get(fnName);
      if (apiInfo) {
        apiMeta = { ...apiMeta, ...apiInfo };
      }
    }
  }

  return {
    callee: calleeName,
    from: importInfo?.source,
    ...apiMeta,
    loc: node.loc?.start?.line,
  };
}

function extractRequestConfig(objExpr, resolveValue = (v) => v) {
  const config = {};
  for (const prop of objExpr.properties) {
    if (prop.type !== "ObjectProperty" || prop.key.type !== "Identifier") continue;
    const key = prop.key.name;
    const valueNode = resolveValue(prop.value) || prop.value;
    if (key === "url") {
      if (valueNode.type === "StringLiteral" || valueNode.type === "TemplateLiteral") {
        config.url = stringifyLiteral(valueNode);
      }
    }
    if (key === "method") {
      if (
        valueNode.type === "ConditionalExpression" &&
        valueNode.consequent.type === "StringLiteral" &&
        valueNode.alternate.type === "StringLiteral"
      ) {
        const testMeta = extractMethodTest(valueNode.test);
        config.method = [valueNode.consequent.value, valueNode.alternate.value];
        if (testMeta) config.methodTest = testMeta;
      } else if (
        valueNode.type === "StringLiteral" ||
        valueNode.type === "TemplateLiteral"
      ) {
        config.method = stringifyLiteral(valueNode);
      }
    }
    if (["params", "data"].includes(key)) {
      config[key] = "present";
    }
  }
  return config;
}

function extractMethodTest(testNode) {
  if (
    testNode.type === "MemberExpression" &&
    testNode.object.type === "Identifier" &&
    (testNode.property.type === "Identifier" || testNode.property.type === "StringLiteral")
  ) {
    const prop =
      testNode.property.type === "Identifier"
        ? testNode.property.name
        : testNode.property.value;
    return { param: testNode.object.name, path: [prop] };
  }
  return null;
}

function stringifyLiteral(node) {
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral") {
    return node.quasis
      .map((q, idx) =>
        idx === node.expressions.length ? q.value.raw : `${q.value.raw}\${...}`
      )
      .join("");
  }
  return undefined;
}

function stringifyExpression(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "MemberExpression" &&
    node.object &&
    node.property
  ) {
    const obj = stringifyExpression(node.object);
    const prop =
      node.property.type === "Identifier"
        ? node.property.name
        : node.property.type === "StringLiteral"
          ? node.property.value
          : "";
    return prop ? `${obj}.${prop}` : obj;
  }
  return "";
}

function loadApiDefinition(modulePath) {
  if (apiModuleCache.has(modulePath)) return apiModuleCache.get(modulePath);
  if (!isFile(modulePath)) {
    apiModuleCache.set(modulePath, new Map());
    return apiModuleCache.get(modulePath);
  }
  const code = fs.readFileSync(modulePath, "utf-8");
  let ast;
  try {
    ast = parseScript(code, {
      sourceType: "module",
      plugins: ["typescript", "jsx", "decorators-legacy", "classProperties"],
    });
  } catch {
    apiModuleCache.set(modulePath, new Map());
    return apiModuleCache.get(modulePath);
  }

  const requestNames = new Set();
  const imports = new Map();
  ast.program.body.forEach((stmt) => {
    if (stmt.type !== "ImportDeclaration") return;
    stmt.specifiers.forEach((spec) => {
      if (
        (spec.type === "ImportSpecifier" || spec.type === "ImportDefaultSpecifier") &&
        spec.local?.name
      ) {
        imports.set(spec.local.name, stmt.source.value);
        if (stmt.source.value.includes("/utils/request")) {
          requestNames.add(spec.local.name);
        }
      }
    });
  });

  const fnMap = new Map();
  const collectRequestInFn = (fnNode) => {
    const constValues = new Map();
    if (fnNode.body?.type === "BlockStatement") {
      fnNode.body.body.forEach((stmt) => {
        if (stmt.type === "VariableDeclaration") {
          stmt.declarations.forEach((decl) => {
            if (decl.id.type === "Identifier" && decl.init) {
              constValues.set(decl.id.name, decl.init);
            }
          });
        }
      });
    }
    let found;
    const stack = [fnNode.body ?? fnNode];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node.type !== "string") continue;
      if (
        node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        requestNames.has(node.callee.name)
      ) {
        const cfg =
          node.arguments?.[0]?.type === "ObjectExpression"
            ? extractRequestConfig(node.arguments[0], (v) =>
                v?.type === "Identifier" && constValues.has(v.name)
                  ? constValues.get(v.name)
                  : v
              )
            : {};
        if (cfg.url) {
          found = cfg;
          break;
        }
      }
      Object.values(node).forEach((child) => {
        if (Array.isArray(child)) child.forEach((c) => stack.push(c));
        else if (child && typeof child.type === "string") stack.push(child);
      });
    }
    return found;
  };

  ast.program.body.forEach((stmt) => {
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      if (stmt.declaration.type === "FunctionDeclaration" && stmt.declaration.id?.name) {
        const cfg = collectRequestInFn(stmt.declaration);
        if (cfg) fnMap.set(stmt.declaration.id.name, cfg);
      } else if (stmt.declaration.type === "VariableDeclaration") {
        stmt.declaration.declarations.forEach((decl) => {
          if (
            decl.id.type === "Identifier" &&
            decl.init &&
            ["ArrowFunctionExpression", "FunctionExpression"].includes(decl.init.type)
          ) {
            const cfg = collectRequestInFn(decl.init);
            if (cfg) fnMap.set(decl.id.name, cfg);
          }
        });
      }
    }
  });

  apiModuleCache.set(modulePath, fnMap);
  return fnMap;
}

function resolveApiModulePath(importSource, importerFile, srcDir) {
  const importerDir = path.dirname(importerFile);
  let resolved;
  if (importSource.startsWith("@/")) {
    resolved = path.resolve(srcDir, importSource.slice(2));
  } else if (importSource.startsWith(".")) {
    resolved = path.resolve(importerDir, importSource);
  } else {
    return null;
  }

  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.js`,
    `${resolved}.mjs`,
    `${resolved}.mts`,
    path.join(resolved, "index.ts"),
    path.join(resolved, "index.js"),
    path.join(resolved, "index.mjs"),
    path.join(resolved, "index.mts"),
  ];

  return candidates.find((p) => isFile(p)) || null;
}

function isFile(p) {
  try {
    const stat = fs.statSync(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

// ============================================================
// SECTION: Vue Template Analysis
// ============================================================
function readVueTemplate(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const sfc = parseSFC(content, { filename: filePath });
  return {
    descriptor: sfc.descriptor,
    template: sfc.descriptor.template?.content || "",
  };
}

function extractTemplateInfo(filePath, templateCode, i18nMap = {}) {
  const authNodes = [];
  const bindings = new Map(); // varName -> [{ tag, bindings }]
  const handlers = new Set();
  const propUsage = new Map(); // exprString -> Set<prop>
  if (!templateCode) return { authNodes, bindings, handlers, propUsage };

  const tplAst = parseTemplate(templateCode, { comments: false });
  const authStack = [];

  function walk(node) {
    if (!node) return;
    if (node.type === NodeTypes.INTERPOLATION && node.content?.content) {
      collectPropUsage(node.content.content, propUsage);
      return;
    }
    if (node.type === NodeTypes.ELEMENT) {
      const events = [];
      const bindingObj = { tag: node.tag, bindings: {} };
      let currentAuth = null;

      node.props?.forEach((prop) => {
        if (prop.type === 7 && prop.name === CONFIG.authDirectiveName) {
          const authValue =
            prop.exp?.type === 4 ? prop.exp.content?.trim() : undefined;
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
          const expression =
            prop.exp?.type === 4 ? prop.exp.content?.trim() : undefined;
          extractHandlerNamesFromExpression(expression).forEach((h) => handlers.add(h));
          const evt = {
            event: prop.arg?.type === 4 ? prop.arg.content : "unknown",
            expression,
            line: prop.loc?.start?.line,
            tag: node.tag,
            name: extractEventName(expression, i18nMap),
          };
          events.push(evt);
          if (authStack.length > 0) {
            const parentAuth = authStack[authStack.length - 1];
            parentAuth.descendantEvents.push(evt);
          }
          if (expression) collectPropUsage(expression, propUsage);
        }

        if (prop.type === 7 && prop.name === "model" && prop.exp?.type === 4) {
          const argName = prop.arg?.type === 4 ? prop.arg.content : "modelValue";
          bindingObj.bindings[argName] = prop.exp.content.trim();
        }

        if (
          prop.type === 7 &&
          prop.name === "bind" &&
          prop.arg?.type === 4 &&
          ["visible", "modelValue", "data"].includes(prop.arg.content) &&
          prop.exp?.type === 4
        ) {
          bindingObj.bindings[prop.arg.content] = prop.exp.content.trim();
        }

        if (
          prop.type === 7 &&
          prop.name === "bind" &&
          prop.arg?.type === 4 &&
          prop.arg.content.startsWith("on") &&
          prop.exp?.type === 4
        ) {
          const expression = prop.exp.content.trim();
          extractHandlerNamesFromExpression(expression).forEach((h) => handlers.add(h));
          const evtName = prop.arg.content.replace(/^on-?/, "") || "unknown";
          const evt = {
            event: evtName,
            expression,
            line: prop.loc?.start?.line,
            tag: node.tag,
            name: extractEventName(expression, i18nMap),
          };
          events.push(evt);
          if (authStack.length > 0) {
            const parentAuth = authStack[authStack.length - 1];
            parentAuth.descendantEvents.push(evt);
          }
          collectPropUsage(expression, propUsage);
        }

        if (prop.exp?.type === 4 && prop.exp.content) {
          collectPropUsage(prop.exp.content, propUsage);
        }
      });

      const vars = Object.values(bindingObj.bindings);
      vars.forEach((v) => {
        if (!v) return;
        if (!bindings.has(v)) bindings.set(v, []);
        bindings.get(v).push(bindingObj);
      });

      if (currentAuth) authStack.push(currentAuth);
      node.children?.forEach(walk);
      if (currentAuth) authStack.pop();
    } else if (Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  }

  walk(tplAst);

  return { authNodes, bindings, handlers, propUsage };
}

function traverseTemplateWithAuthStack(ast, onEnter, onLeave) {
  const stack = Array.isArray(ast.children) ? [...ast.children.reverse()] : [];
  const enterStack = [];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    const isElementOrInterpolation =
      node.type === NodeTypes.ELEMENT || node.type === NodeTypes.INTERPOLATION;
    if (isElementOrInterpolation) {
      onEnter(node, true);
      enterStack.push(node);
      if (node.children?.length) {
        for (let i = node.children.length - 1; i >= 0; i--) {
          stack.push(node.children[i]);
        }
      }
      onEnter(node, false);
    } else if (node.children?.length) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
    while (enterStack.length && enterStack[enterStack.length - 1] === node) {
      const last = enterStack.pop();
      onLeave?.(last);
    }
  }
}

function collectPropUsage(expression, propUsage) {
  if (!expression) return;
  try {
    const ast = parseExpression(expression, {
      plugins: ["typescript", "jsx", "optionalChaining", "nullishCoalescingOperator"],
    });
    const stack = [ast];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node.type !== "string") continue;
      if (
        node.type === "MemberExpression" ||
        node.type === "OptionalMemberExpression"
      ) {
        const objStr = stringifyExpression(node.object);
        const prop =
          node.property?.type === "Identifier"
            ? node.property.name
            : node.property?.type === "StringLiteral"
              ? node.property.value
              : null;
        if (objStr && prop) {
          if (!propUsage.has(objStr)) propUsage.set(objStr, new Set());
          propUsage.get(objStr).add(prop);
        }
      }
      Object.values(node).forEach((child) => {
        if (Array.isArray(child)) child.forEach((c) => stack.push(c));
        else if (child && typeof child.type === "string") stack.push(child);
      });
    }
  } catch {
    // ignore parse errors in template expressions
  }
}

// stringifyExpression defined above

function extractElementName(node, i18nMap = {}) {
  if (!node || !node.props) return "";
  const nameProp = node.props.find(
    (p) =>
      p.type === 6 &&
      (p.name === "name" || p.name === "label") &&
      typeof p.value?.content === "string"
  );
  if (nameProp?.value?.content) return nameProp.value.content.trim();
  const texts = [];
  if (Array.isArray(node.children)) {
    node.children.forEach((c) => {
      if (c.type === NodeTypes.TEXT && c.content) {
        texts.push(String(c.content).trim());
      } else if (c.type === NodeTypes.INTERPOLATION && c.content?.content) {
        const translated = translateExpression(c.content.content, i18nMap);
        if (translated) texts.push(translated);
      }
    });
  }
  return texts.join(" ").trim();
}

function extractEventName(expression, i18nMap = {}) {
  if (!expression) return "";
  const translated = translateExpression(expression, i18nMap);
  return translated || "";
}

function translateExpression(expression, i18nMap) {
  try {
    const ast = parseExpression(expression, {
      plugins: ["typescript", "jsx", "optionalChaining", "nullishCoalescingOperator"],
    });
    if (ast.type === "CallExpression") {
      const calleeName = getCalleeName(ast.callee);
      if (calleeName === "$t" || calleeName === "t") {
        const arg = ast.arguments?.[0];
        if (arg?.type === "StringLiteral") {
          return getI18nValue(i18nMap, arg.value) || "";
        }
      }
    }
  } catch {
    return "";
  }
  return "";
}

function getI18nValue(i18nMap, key) {
  if (!key) return "";
  const parts = key.split(".");
  let current = i18nMap;
  for (const p of parts) {
    if (current && typeof current === "object" && p in current) {
      current = current[p];
    } else {
      return "";
    }
  }
  return typeof current === "string" ? current : "";
}

function getCalleeName(callee) {
  if (!callee) return null;
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier"
  ) {
    const prop =
      callee.property.type === "Identifier"
        ? callee.property.name
        : callee.property.type === "StringLiteral"
          ? callee.property.value
          : null;
    if (prop) return `${callee.object.name}.${prop}`;
  }
  return null;
}

// ============================================================
// SECTION: Script AST Analysis
// ============================================================

function analyzeScript(code, filename, srcDir) {
  if (!code.trim())
    return { functions: new Map(), imports: new Map(), looseApis: [], initialObjects: {} };
  let ast;
  try {
    ast = parseScript(code, {
      sourceType: "module",
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "dynamicImport",
      ],
    });
  } catch (err) {
    console.warn(`[analyze-auth-apis] 解析失败 ${filename}`, err.message);
    return { functions: new Map(), imports: new Map(), looseApis: [], initialObjects: {} };
  }

  const imports = new Map();
  const looseApis = [];
  const initialObjects = {};
  const propAliases = {};
  let propsIdentifier = "props";
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
        imports.set(spec.local.name, {
          local: spec.local.name,
          imported: "*",
          source: stmt.source.value,
        });
      }
    });
  });

  const functions = new Map();
  const visitorKeys = astVisitorKeys();

  const ensureFn = (name, loc) => {
    if (!functions.has(name)) {
      functions.set(name, {
        name,
        loc,
        params: [],
        apiCalls: [],
        calls: [],
        toggles: [],
        objectAssignments: {},
        aliasAssignments: [],
      });
    }
    return functions.get(name);
  };

  const collectDefs = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "FunctionDeclaration" && node.id?.name) {
      const fnInfo = ensureFn(node.id.name, node.loc?.start?.line);
      fnInfo.node = node;
      fnInfo.params = extractParamNames(node.params);
    } else if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init &&
      ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init.type)
    ) {
      const fnInfo = ensureFn(node.id.name, node.loc?.start?.line);
      fnInfo.node = node.init;
      fnInfo.params = extractParamNames(node.init.params);
    }
    (visitorKeys[node.type] || []).forEach((key) => {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(collectDefs);
      else if (child && typeof child.type === "string") collectDefs(child);
    });
  };

  collectDefs(ast.program);

  ast.program.body.forEach((stmt) => {
    if (
      stmt.type === "VariableDeclaration" &&
      Array.isArray(stmt.declarations)
    ) {
      stmt.declarations.forEach((decl) => {
        if (
          decl.type === "VariableDeclarator" &&
          decl.id.type === "Identifier" &&
          decl.init?.type === "CallExpression"
        ) {
          const calleeName = getCalleeName(decl.init.callee);
          if (calleeName === "defineProps") {
            propsIdentifier = decl.id.name;
          }
        }
      });
    }
  });

  // 收集初始对象定义（ref/reactive/object literal）
  ast.program.body.forEach((stmt) => {
    if (
      stmt.type === "VariableDeclaration" &&
      Array.isArray(stmt.declarations)
    ) {
      stmt.declarations.forEach((decl) => {
        if (
          decl.type === "VariableDeclarator" &&
          decl.id.type === "Identifier" &&
          decl.init
        ) {
          const objInfo = extractInitialObject(decl.init);
          if (objInfo) initialObjects[decl.id.name] = objInfo;
          const spreadSrc = extractSpreadSource(decl.init);
          if (spreadSrc && spreadSrc.kind === "identifier" && objInfo?.props) {
            initialObjects[spreadSrc.name] = {
              ...(initialObjects[spreadSrc.name] || { props: {} }),
              props: { ...(initialObjects[spreadSrc.name]?.props || {}), ...objInfo.props },
            };
          }
          // defineModel/defineProps 解构
          if (
            decl.init.type === "CallExpression" &&
            decl.init.callee.type === "Identifier" &&
            (decl.init.callee.name === "defineModel" || decl.init.callee.name === "defineProps") &&
            decl.init.arguments?.[0]
          ) {
            const arg = decl.init.arguments[0];
            if (arg.type === "ObjectExpression") {
              const props = analyzeObjectAssignment(arg);
              if (props) {
                initialObjects[decl.id.name] = {
                  ...(initialObjects[decl.id.name] || { props: {} }),
                  props: { ...(initialObjects[decl.id.name]?.props || {}), ...props.props },
                };
              }
            } else if (arg.type === "Identifier") {
              if (initialObjects[arg.name]) {
                initialObjects[decl.id.name] = initialObjects[arg.name];
              } else {
                initialObjects[decl.id.name] = { from: arg.name };
              }
            }
          } else if (
            decl.init.type === "CallExpression" &&
            decl.init.callee.type === "Identifier" &&
            decl.init.callee.name === "defineModel"
          ) {
            // defineModel("data", {...})
            if (
              decl.init.arguments?.[1]?.type === "ObjectExpression"
            ) {
              const props = analyzeObjectAssignment(decl.init.arguments[1]);
              if (props) {
                initialObjects[decl.id.name] = {
                  ...(initialObjects[decl.id.name] || { props: {} }),
                  props: { ...(initialObjects[decl.id.name]?.props || {}), ...props.props },
                };
              }
            }
          }
        }
      });
    }
  });

  collectPropAliases(ast.program, propsIdentifier, propAliases);

  const visit = (node, currentFnName) => {
    if (!node || typeof node.type !== "string") return;
    let nextFnName = currentFnName;

    if (node.type === "FunctionDeclaration" && node.id?.name) {
      const fnInfo = ensureFn(node.id.name, node.loc?.start?.line);
      fnInfo.node = node;
      fnInfo.params = extractParamNames(node.params);
      nextFnName = node.id.name;
    } else if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      node.init &&
      ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init.type)
    ) {
      const fnInfo = ensureFn(node.id.name, node.loc?.start?.line);
      fnInfo.node = node.init;
      fnInfo.params = extractParamNames(node.init.params);
      nextFnName = node.id.name;
    } else if (
      currentFnName &&
      node.type === "VariableDeclarator" &&
      node.id.type === "ObjectPattern" &&
      node.init &&
      (node.init.type === "Identifier" ||
        (node.init.type === "MemberExpression" && node.init.object.type === "Identifier"))
    ) {
      const currentFn = ensureFn(currentFnName);
      const source =
        node.init.type === "Identifier" ? node.init.name : node.init.object.name;
      const props = extractDestructuredProps(node.id);
      if (props && source) {
        currentFn.objectAssignments[source] = {
          ...(currentFn.objectAssignments[source] || { props: {} }),
          props: { ...(currentFn.objectAssignments[source]?.props || {}), ...props },
        };
      }
    }

    handleNode(
      node,
      nextFnName,
      visit,
      ensureFn,
      functions,
      imports,
      filename,
      srcDir,
      visitorKeys,
      looseApis
    );
  };

  visit(ast.program, null);

  return { functions, imports, looseApis, initialObjects, propAliases };
}

function handleNode(
  node,
  currentFnName,
  visit,
  ensureFn,
  functions,
  imports,
  filename,
  srcDir,
  visitorKeys,
  looseApis
) {
  if (!node) return;

  if (
    node.type === "VariableDeclarator" &&
    node.id.type === "ObjectPattern" &&
    node.init?.type === "CallExpression"
  ) {
    const calleeName = getCalleeName(node.init.callee);
    if (calleeName?.includes("useRequest")) {
      const api = extractApiFromUseRequestArg(node.init.arguments?.[0], imports, filename, srcDir);
      if (api) {
        looseApis.push(api);
      }
    }
  }

  if (
    currentFnName &&
    node.type === "VariableDeclarator" &&
    node.id.type === "Identifier" &&
    node.init
  ) {
    const currentFn = ensureFn(currentFnName);
    const objInfo = analyzeObjectAssignment(node.init);
    if (objInfo) {
      currentFn.objectAssignments[node.id.name] = objInfo;
    }
    const aliasSource = extractAliasSource(node.init);
    if (aliasSource) {
      currentFn.aliasAssignments.push({ target: node.id.name, source: aliasSource });
    }
  }

  if (currentFnName && node.type === "CallExpression" && node.callee) {
    const currentFn = ensureFn(currentFnName);
    const calleeName = getCalleeName(node.callee);
    if (calleeName) {
      if (functions.has(calleeName)) {
        currentFn.calls.push(calleeName);
      }
      const apiInfo = resolveApiCall(node, calleeName, imports, filename, srcDir);
      if (apiInfo) {
        const argInfo = analyzeArg(node.arguments?.[0]);
        currentFn.apiCalls.push({ ...apiInfo, argInfo });
      } else if (calleeName === "window.open" || calleeName === "open") {
        const url = stringifyUrlArg(node.arguments?.[0]);
        if (url) {
          currentFn.apiCalls.push({
            url,
            method: "GET",
            callee: calleeName,
            argInfo: analyzeArg(node.arguments?.[0]),
          });
        }
      } else if (calleeName === "router.push" || calleeName === "push") {
        const routeInfo = extractRouterPushInfo(node);
        if (routeInfo) {
          currentFn.apiCalls.push({
            url: routeInfo.path,
            method: "NAVIGATE",
            callee: "router.push",
            query: routeInfo.query,
            argInfo: analyzeArg(node.arguments?.[0]),
          });
        }
      }
    }
  }

  if (
    currentFnName &&
    node.type === "AssignmentExpression" &&
    node.operator === "="
  ) {
    const currentFn = ensureFn(currentFnName);
    const varName = extractAssignedVarName(node.left);
    const assignedTrue =
      node.right.type === "BooleanLiteral" && node.right.value === true;
    if (varName && assignedTrue) {
      currentFn.toggles.push(varName);
    }
    if (varName && node.left.type === "MemberExpression") {
      const objInfo = analyzeObjectAssignment(node.right);
      if (objInfo) {
        currentFn.objectAssignments[varName] = objInfo;
      }
      const aliasSource = extractAliasSource(node.right);
      if (aliasSource) {
        currentFn.aliasAssignments.push({ target: varName, source: aliasSource });
      }
    }
  }

  if (node.type === "IfStatement") {
    const evalResult = evalStaticBoolean(node.test);
    if (evalResult === true) {
      visit(node.consequent, currentFnName);
    } else if (evalResult === false) {
      if (node.alternate) visit(node.alternate, currentFnName);
    } else {
      visit(node.consequent, currentFnName);
      if (node.alternate) visit(node.alternate, currentFnName);
    }
    return;
  }

  if (node.type === "ConditionalExpression") {
    const evalResult = evalStaticBoolean(node.test);
    if (evalResult === true) {
      visit(node.consequent, currentFnName);
    } else if (evalResult === false) {
      visit(node.alternate, currentFnName);
    } else {
      visit(node.consequent, currentFnName);
      visit(node.alternate, currentFnName);
    }
    return;
  }

  if (node.type === "LogicalExpression") {
    const evalLeft = evalStaticBoolean(node.left);
    if (node.operator === "&&") {
      visit(node.left, currentFnName);
      if (evalLeft !== false) visit(node.right, currentFnName);
      return;
    }
    if (node.operator === "||") {
      visit(node.left, currentFnName);
      if (evalLeft !== true) visit(node.right, currentFnName);
      return;
    }
  }

  (visitorKeys[node.type] || []).forEach((key) => {
    const child = node[key];
    if (Array.isArray(child)) child.forEach((c) => visit(c, currentFnName));
    else if (child && typeof child.type === "string") visit(child, currentFnName);
  });
}

function analyzeArg(argNode) {
  if (!argNode) return null;
  if (argNode.type === "ObjectExpression") {
    const props = {};
    argNode.properties.forEach((p) => {
      if (p.type !== "ObjectProperty") return;
      const key =
        p.key.type === "Identifier"
          ? p.key.name
          : p.key.type === "StringLiteral"
            ? p.key.value
            : null;
      if (!key) return;
      if (p.value.type === "StringLiteral" || p.value.type === "NumericLiteral") {
        props[key] = { kind: "literal", value: p.value.value };
      } else if (p.value.type === "BooleanLiteral") {
        props[key] = { kind: "literal", value: p.value.value };
      } else {
        props[key] = { kind: "unknown" };
      }
    });
    return { kind: "object", props };
  }
  if (argNode.type === "Identifier") {
    return { kind: "identifier", name: argNode.name };
  }
  if (
    argNode.type === "MemberExpression" &&
    argNode.object.type === "Identifier" &&
    (argNode.property.type === "Identifier" || argNode.property.type === "StringLiteral")
  ) {
    const prop =
      argNode.property.type === "Identifier"
        ? argNode.property.name
        : argNode.property.value;
    return { kind: "member", object: argNode.object.name, path: [prop] };
  }
  return { kind: "unknown", expr: stringifyExpression(argNode) };
}

function extractApiFromUseRequestArg(argNode, imports, filename, srcDir) {
  if (!argNode) return null;
  const visitorKeys = astVisitorKeys();
  let found = null;
  const walk = (node) => {
    if (!node || typeof node.type !== "string" || found) return;
    if (node.type === "CallExpression") {
      const calleeName = getCalleeName(node.callee);
      const api = resolveApiCall(node, calleeName, imports, filename, srcDir);
      if (api) {
        found = api;
        return;
      }
    }
    const keys = visitorKeys[node.type] ?? [];
    for (const key of keys) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child.type === "string") walk(child);
    }
  };
  walk(argNode.body ?? argNode);
  return found;
}

function extractAssignedVarName(node) {
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.property.type === "Identifier" &&
    node.property.name === "value"
  ) {
    return node.object.name;
  }
  return null;
}

function analyzeObjectAssignment(rightNode) {
  if (rightNode.type !== "ObjectExpression") return null;
  const props = {};
  let spreadSources = [];
  rightNode.properties.forEach((p) => {
    if (p.type === "SpreadElement") {
      const src = extractSpreadSource(p.argument);
      if (src) spreadSources.push(src);
      return;
    }
    if (p.type !== "ObjectProperty") return;
    const key =
      p.key.type === "Identifier"
        ? p.key.name
        : p.key.type === "StringLiteral"
          ? p.key.value
          : null;
    if (!key) return;
    if (p.value.type === "StringLiteral" || p.value.type === "NumericLiteral") {
      props[key] = { kind: "literal", value: p.value.value };
    } else if (p.value.type === "BooleanLiteral") {
      props[key] = { kind: "literal", value: p.value.value };
    } else {
      props[key] = { kind: "unknown" };
    }
  });
  const result = { props };
  if (spreadSources.length) result.spreads = spreadSources;
  return result;
}

function extractInitialObject(initNode) {
  if (!initNode) return null;
  const node = unwrapExpression(initNode);
  if (node.type === "ObjectExpression") {
    return analyzeObjectAssignment(node);
  }
  if (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "defineModel" &&
    node.arguments?.[1]?.type === "ObjectExpression"
  ) {
    return analyzeObjectAssignment(node.arguments[1]);
  }
  if (
    node.type === "CallExpression" &&
    node.callee &&
    (node.callee.type === "Identifier" ||
      (node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier"))
  ) {
    const calleeName = getCalleeName(node.callee);
    if (
      ["ref", "reactive", "shallowRef", "toRef", "toRefs"].includes(calleeName) &&
      node.arguments?.[0]?.type === "ObjectExpression"
    ) {
      return analyzeObjectAssignment(node.arguments[0]);
    }
  }
  return null;
}

function collectPropAliases(ast, propsIdentifier, propAliases) {
  const visitorKeys = astVisitorKeys();
  const walk = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "AssignmentExpression" && node.operator === "=") {
      const target = extractAssignedVarName(node.left);
      if (
        target &&
        node.right.type === "MemberExpression" &&
        node.right.object.type === "Identifier" &&
        node.right.object.name === propsIdentifier &&
        (node.right.property.type === "Identifier" ||
          node.right.property.type === "StringLiteral")
      ) {
        const propKey =
          node.right.property.type === "Identifier"
            ? node.right.property.name
            : node.right.property.value;
        propAliases[target] = propKey;
      }
    }

    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.object.type === "Identifier" &&
      node.callee.object.name === "Object" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "assign"
    ) {
      const [targetArg, sourceArg] = node.arguments || [];
      const target = extractAssignedVarName(targetArg);
      if (
        target &&
        sourceArg?.type === "MemberExpression" &&
        sourceArg.object.type === "Identifier" &&
        sourceArg.object.name === propsIdentifier &&
        (sourceArg.property.type === "Identifier" ||
          sourceArg.property.type === "StringLiteral")
      ) {
        const propKey =
          sourceArg.property.type === "Identifier"
            ? sourceArg.property.name
            : sourceArg.property.value;
        propAliases[target] = propKey;
      }
    }

    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      node.callee.name === "watch"
    ) {
      const [source, callback] = node.arguments || [];
      const propKey = extractPropKeyFromWatchSource(source, propsIdentifier);
      const paramName =
        callback &&
        (callback.type === "ArrowFunctionExpression" ||
          callback.type === "FunctionExpression") &&
        callback.params?.[0]?.type === "Identifier"
          ? callback.params[0].name
          : null;
      if (propKey && paramName) {
        const targets = new Set();
        walkCallbackForAlias(callback.body, paramName, targets, visitorKeys);
        targets.forEach((t) => (propAliases[t] = propKey));
      }
    }

    const keys = visitorKeys[node.type] || [];
    keys.forEach((k) => {
      const child = node[k];
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child.type === "string") walk(child);
    });
  };
  walk(ast);
}

function extractPropKeyFromWatchSource(source, propsIdentifier) {
  if (!source) return null;
  const node = unwrapExpression(source);
  if (
    node.type === "ArrowFunctionExpression" &&
    node.body &&
    node.body.type === "MemberExpression" &&
    node.body.object.type === "Identifier" &&
    node.body.object.name === propsIdentifier &&
    (node.body.property.type === "Identifier" ||
      node.body.property.type === "StringLiteral")
  ) {
    return node.body.property.type === "Identifier"
      ? node.body.property.name
      : node.body.property.value;
  }
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === propsIdentifier &&
    (node.property.type === "Identifier" || node.property.type === "StringLiteral")
  ) {
    return node.property.type === "Identifier"
      ? node.property.name
      : node.property.value;
  }
  return null;
}

function walkCallbackForAlias(bodyNode, paramName, targets, visitorKeys) {
  const stack = [bodyNode];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    if (
      node.type === "AssignmentExpression" &&
      node.operator === "=" &&
      node.right.type === "Identifier" &&
      node.right.name === paramName
    ) {
      const target = extractAssignedVarName(node.left);
      if (target) targets.add(target);
    }
    if (
      node.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      node.callee.object.type === "Identifier" &&
      node.callee.object.name === "Object" &&
      node.callee.property.type === "Identifier" &&
      node.callee.property.name === "assign"
    ) {
      const [targetArg, sourceArg] = node.arguments || [];
      if (sourceArg?.type === "Identifier" && sourceArg.name === paramName) {
        const target = extractAssignedVarName(targetArg);
        if (target) targets.add(target);
      }
    }
    const keys = visitorKeys[node.type] || [];
    keys.forEach((k) => {
      const child = node[k];
      if (Array.isArray(child)) child.forEach((c) => stack.push(c));
      else if (child && typeof child.type === "string") stack.push(child);
    });
  }
}

function extractParamNames(params) {
  if (!Array.isArray(params)) return [];
  return params
    .map((p) => {
      if (!p) return null;
      if (p.type === "Identifier") return p.name;
      if (p.type === "AssignmentPattern" && p.left.type === "Identifier") {
        return p.left.name;
      }
      return null;
    })
    .filter(Boolean);
}

function unwrapExpression(node) {
  let current = node;
  while (current && (current.type === "TSAsExpression" || current.type === "TypeCastExpression")) {
    current = current.expression;
  }
  return current;
}

function extractAliasSource(node) {
  const expr = unwrapExpression(node);
  if (!expr) return null;
  if (expr.type === "Identifier") return expr.name;
  if (
    expr.type === "MemberExpression" &&
    expr.object.type === "Identifier" &&
    expr.property.type === "Identifier" &&
    expr.property.name === "value"
  ) {
    return expr.object.name;
  }
  if (expr.type !== "CallExpression") return null;

  const calleeName = getCalleeName(expr.callee);
  const firstArg = expr.arguments?.[0];

  if (
    calleeName === "JSON.parse" &&
    firstArg?.type === "CallExpression" &&
    getCalleeName(firstArg.callee) === "JSON.stringify"
  ) {
    const inner = firstArg.arguments?.[0];
    if (inner?.type === "Identifier") return inner.name;
    if (
      inner?.type === "MemberExpression" &&
      inner.object.type === "Identifier" &&
      inner.property.type === "Identifier" &&
      inner.property.name === "value"
    ) {
      return inner.object.name;
    }
  }

  if (calleeName && ["cloneDeep", "clone", "structuredClone"].includes(calleeName)) {
    if (firstArg?.type === "Identifier") return firstArg.name;
    if (
      firstArg?.type === "MemberExpression" &&
      firstArg.object.type === "Identifier" &&
      firstArg.property.type === "Identifier" &&
      firstArg.property.name === "value"
    ) {
      return firstArg.object.name;
    }
  }

  if (expr.type === "ObjectExpression" && expr.properties.length === 1) {
    const [prop] = expr.properties;
    if (prop.type === "SpreadElement") {
      if (prop.argument.type === "Identifier") return prop.argument.name;
      if (
        prop.argument.type === "MemberExpression" &&
        prop.argument.object.type === "Identifier" &&
        prop.argument.property.type === "Identifier" &&
        prop.argument.property.name === "value"
      ) {
        return prop.argument.object.name;
      }
    }
  }

  if (expr.type === "ObjectExpression") {
    const spreadProp = expr.properties.find((p) => p.type === "SpreadElement");
    if (spreadProp) {
      if (spreadProp.argument.type === "Identifier") return spreadProp.argument.name;
      if (
        spreadProp.argument.type === "MemberExpression" &&
        spreadProp.argument.object.type === "Identifier" &&
        spreadProp.argument.property.type === "Identifier" &&
        spreadProp.argument.property.name === "value"
      ) {
        return spreadProp.argument.object.name;
      }
      if (
        spreadProp.argument.type === "MemberExpression" &&
        spreadProp.argument.object.type === "Identifier" &&
        spreadProp.argument.property.type === "Identifier"
      ) {
        return spreadProp.argument.object.name;
      }
    }
  }

  return null;
}

function extractDestructuredProps(pattern) {
  if (pattern.type !== "ObjectPattern") return null;
  const props = {};
  pattern.properties.forEach((p) => {
    if (p.type !== "ObjectProperty") return;
    const key =
      p.key.type === "Identifier"
        ? p.key.name
        : p.key.type === "StringLiteral"
          ? p.key.value
          : null;
    if (!key) return;
    props[key] = { kind: "present" };
  });
  return props;
}

function extractSpreadSource(argument) {
  if (argument.type === "Identifier") return { kind: "identifier", name: argument.name };
  if (
    argument.type === "MemberExpression" &&
    argument.object.type === "Identifier" &&
    argument.property.type === "Identifier"
  ) {
    return { kind: "member", object: argument.object.name, property: argument.property.name };
  }
  return null;
}

function extractRouterPushInfo(callNode) {
  const arg = callNode.arguments?.[0];
  if (!arg) return null;
  // router.push("/path") or router.push(`/path/${id}`)
  if (arg.type === "StringLiteral" || arg.type === "TemplateLiteral") {
    const path = stringifyUrlArg(arg);
    return path ? { path, query: null } : null;
  }
  // router.push({ path: "/xxx", query: {...} })
  if (arg.type === "ObjectExpression") {
    let routePath = null;
    let query = null;
    for (const prop of arg.properties) {
      if (prop.type !== "ObjectProperty" || prop.key.type !== "Identifier") continue;
      if (prop.key.name === "path") {
        routePath = stringifyUrlArg(prop.value);
      } else if (prop.key.name === "query" && prop.value.type === "ObjectExpression") {
        const qKeys = [];
        for (const qp of prop.value.properties) {
          if (qp.type === "ObjectProperty" && qp.key.type === "Identifier") {
            qKeys.push(qp.key.name);
          }
        }
        if (qKeys.length) query = qKeys;
      }
    }
    if (routePath) return { path: routePath, query };
  }
  return null;
}

function stringifyUrlArg(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral") {
    return node.quasis
      .map((q, idx) =>
        idx === node.expressions.length ? q.value.raw : `${q.value.raw}\${...}`
      )
      .join("");
  }
  return null;
}

// getCalleeName defined above

function evalStaticBoolean(node) {
  if (!node) return null;
  if (node.type === "BooleanLiteral") return node.value;
  if (node.type === "UnaryExpression" && node.operator === "!") {
    const val = evalStaticBoolean(node.argument);
    return val === null ? null : !val;
  }
  if (node.type === "BinaryExpression") {
    const left = evalStaticLiteral(node.left);
    const right = evalStaticLiteral(node.right);
    if (left === null || right === null) return null;
    switch (node.operator) {
      case "===":
        return left === right;
      case "!==":
        return left !== right;
      case "==":
        return left == right;
      case "!=":
        return left != right;
      case ">":
        return left > right;
      case "<":
        return left < right;
      case ">=":
        return left >= right;
      case "<=":
        return left <= right;
      default:
        return null;
    }
  }
  return null;
}

function evalStaticLiteral(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "NumericLiteral") return node.value;
  if (node.type === "BooleanLiteral") return node.value;
  if (node.type === "NullLiteral") return null;
  return null;
}

function astVisitorKeys() {
  try {
    const types = require("@babel/types");
    return types.VISITOR_KEYS;
  } catch {
    return {};
  }
}

// ============================================================
// SECTION: Static Analysis Main Logic
// ============================================================

async function runStaticAnalysis(ROOT, SRC_DIR, OUTPUT_DIR) {
  const OUTPUT_FILE = path.join(OUTPUT_DIR, "auth-mapping.json");
  const pages = await collectPageEntries();
  const results = [];
  const templateDebug = [];
  const scriptDebug = [];
  const compositionDebug = [];
  const traceDebug = [];

  for (const entry of pages) {
    const pageResult = await analyzePage(
      entry,
      templateDebug,
      scriptDebug,
      compositionDebug,
      traceDebug
    );
    if (pageResult) results.push(pageResult);
  }

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), "utf-8");
  const debugDir = path.join(ROOT, "dist", "auth-debug");
  fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(
    path.join(debugDir, "template.json"),
    JSON.stringify(templateDebug, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(debugDir, "script.json"),
    JSON.stringify(scriptDebug, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(debugDir, "composition.json"),
    JSON.stringify(compositionDebug, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(debugDir, "trace.json"),
    JSON.stringify(traceDebug, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(debugDir, "summary.json"),
    JSON.stringify(buildSummary(results), null, 2),
    "utf-8"
  );
  console.log(
    `[analyze-auth-apis] 页面数量：${results.length}，输出：${path.relative(
      ROOT,
      OUTPUT_FILE
    )}`
  );
  return results;
}

async function collectPageEntries() {
  const pattern = CONFIG.viewsDir + "/**/index.vue";
  const entries = await fg(pattern, {
    cwd: ROOT,
    ignore: CONFIG.excludePatterns,
  });
  return entries.map((p) => path.join(ROOT, p));
}

async function analyzePage(entryPath, templateDebug, scriptDebug, compositionDebug, traceDebug) {
  const baseDir = path.dirname(entryPath);
  const vueFiles = await fg("**/*.vue", { cwd: baseDir, absolute: true });
  const i18nMap = loadZhCnTranslations(ROOT);

  const authNodes = [];
  const functionGraphs = new Map();
  const visibilityBindings = new Map();
  const templateHandlers = new Map();
  const importMaps = new Map();
  const looseApisMap = new Map();
  const propUsageMap = new Map();
  const initialObjectsMap = new Map();
  const propAliasesMap = new Map();

  for (const filePath of vueFiles) {
    const { descriptor, template } = readVueTemplate(filePath);
    const { authNodes: nodes, bindings, handlers, propUsage } = extractTemplateInfo(
      filePath,
      template,
      i18nMap
    );
    const scriptContent = [
      descriptor.script?.content ?? "",
      descriptor.scriptSetup?.content ?? "",
    ]
      .filter(Boolean)
      .join("\n");
    const scriptInfo = analyzeScript(scriptContent, filePath, SRC_DIR);

    authNodes.push(
      ...nodes.map((n) => ({
        ...n,
        file: path.relative(ROOT, filePath),
        absPath: filePath,
      }))
    );
    functionGraphs.set(filePath, scriptInfo.functions);
    importMaps.set(filePath, scriptInfo.imports);
    looseApisMap.set(filePath, scriptInfo.looseApis);
    initialObjectsMap.set(filePath, scriptInfo.initialObjects || {});
    visibilityBindings.set(filePath, bindings);
    templateHandlers.set(filePath, handlers);
    propUsageMap.set(filePath, propUsage);
    propAliasesMap.set(filePath, scriptInfo.propAliases || {});

    templateDebug?.push({
      file: path.relative(ROOT, filePath),
      authNodes: nodes,
      bindings: serializeBindings(bindings),
      handlers: Array.from(handlers ?? []),
      propUsage: serializeMapOfSets(propUsage),
    });
    scriptDebug?.push({
      file: path.relative(ROOT, filePath),
      functions: serializeFunctionGraph(scriptInfo.functions),
      looseApis: scriptInfo.looseApis,
      initialObjects: scriptInfo.initialObjects,
      propAliases: scriptInfo.propAliases,
      imports: serializeImports(scriptInfo.imports),
    });
  }

  const tagFileMap = buildTagToFileMap(vueFiles);
  const triggerableApisByFile = collectTriggerableApisByFile(
    vueFiles,
    functionGraphs,
    templateHandlers,
    looseApisMap,
    initialObjectsMap
  );

  const merged = mergeBindingsWithApis(
    authNodes,
    functionGraphs,
    templateHandlers,
    visibilityBindings,
    tagFileMap,
    triggerableApisByFile,
    importMaps,
    propUsageMap,
    initialObjectsMap,
    propAliasesMap,
    traceDebug
  );

  compositionDebug?.push({
    page: toRoutePath(path.relative(SRC_DIR, baseDir)),
    entry: path.relative(ROOT, entryPath),
    tagFileMap: serializeTagFileMap(tagFileMap),
    triggerableApisByFile: serializeTriggerable(triggerableApisByFile),
  });

  return {
    page: toRoutePath(path.relative(SRC_DIR, baseDir)),
    entry: path.relative(ROOT, entryPath),
    authBindings: merged,
  };
}

function collectTriggerableApisByFile(
  vueFiles,
  fnGraphs,
  templateHandlers,
  looseApisMap,
  initialObjectsMap,
  authNodes
) {
  const result = new Map();
  vueFiles.forEach((file) => {
    const handlers = new Set(templateHandlers.get(file) ?? []);
    // 合并该文件内 v-auth 节点的事件/子事件 handler
    (authNodes || [])
      .filter((n) => n.absPath === file)
      .forEach((n) => {
        [...(n.events || []), ...(n.descendantEvents || [])].forEach((evt) => {
          extractHandlerNamesFromExpression(evt.expression).forEach((h) => handlers.add(h));
        });
      });
    const fnMap = fnGraphs.get(file) ?? new Map();
    const initialObjects = initialObjectsMap?.get(file) ?? {};
    const apiSet = new Map();
    const pushApi = (api) => {
      if (!api) return;
      const url = api.url || api.from || api.callee;
      if (!url) return;
      const methodKey = Array.isArray(api.method)
        ? api.method.join(",")
        : (typeof api.method === "string" ? api.method.toUpperCase() : api.method) || "GET";
      const key = `${methodKey}|${url}`;
      if (!apiSet.has(key)) {
        apiSet.set(key, { ...api });
      }
    };
    handlers.forEach((name) => {
      const { apis, objectAssignments } = collectApisAndToggles(
        name,
        fnMap,
        {},
        initialObjects
      );
      apis.forEach((api) => {
        pushApi({ ...api, env: objectAssignments });
      });
    });
    result.set(file, Array.from(apiSet.values()));
  });
  return result;
}

function mergeBindingsWithApis(
  authNodes,
  fnGraphs,
  templateHandlers,
  visibilityBindings,
  tagFileMap,
  triggerableApisByFile,
  importMaps,
  propUsageMap,
  initialObjectsMap,
  propAliasesMap,
  traceDebug
) {
  const pageTraces = [];
  const mergedNodes = authNodes.map((node) => {
    const fnMap = fnGraphs.get(node.absPath) ?? new Map();
    const imports = importMaps.get(node.absPath) ?? new Map();
    const propUsage = propUsageMap.get(node.absPath) ?? new Map();
    const initialObjects = initialObjectsMap.get(node.absPath) ?? {};
    const propAliases = propAliasesMap.get(node.absPath) ?? {};
    const apiSet = new Map();
    const traces = [];
    const allEvents = [...(node.events || []), ...(node.descendantEvents || [])];
    allEvents.forEach((evt) => {
      const handlerNames = extractHandlerNamesFromExpression(evt.expression);
      const directToggles = extractAssignmentsFromExpression(evt.expression);
      const directApis = collectApisFromExpression(
        evt.expression,
        imports,
        node.absPath
      );
      directApis.forEach((api) => {
        addApiToSet(apiSet, api, undefined, api.env);
        recordTrace(traces, node, evt, [`expr:${evt.expression}`], api);
      });
      handlerNames.forEach((name) => {
        const initialEnv = buildInitialEnvFromExpression(
          evt.expression,
          name,
          fnMap,
          propUsage
        );
        const { apis: apiDetails, toggles, objectAssignments } =
          collectApisAndToggles(name, fnMap, initialEnv, initialObjects);
        apiDetails.forEach((api) => {
          addApiToSet(apiSet, api, undefined, objectAssignments);
          recordTrace(traces, node, evt, api.trace, api, objectAssignments);
        });
        toggles.forEach((varName) => {
          const components = findComponentsByBinding(
            node.absPath,
            varName,
            visibilityBindings,
            tagFileMap
          );
          components.forEach((comp) => {
            const dataBindingKey = comp.bindings.data
              ? "data"
              : comp.bindings.modelValue
                ? "modelValue"
                : comp.bindings.model
                  ? "model"
                  : null;
            const dataVar = dataBindingKey ? comp.bindings[dataBindingKey] : null;
            const baseEnv = dataVar ? objectAssignments[dataVar] : null;
            const childPropAliases = propAliasesMap.get(comp.file) || {};
            const env = buildChildEnv(
              baseEnv,
              dataVar,
              dataBindingKey,
              childPropAliases
            );
            const childHandlers = templateHandlers.get(comp.file) || new Set();
            const childFnMap = fnGraphs.get(comp.file) || new Map();
            const childInitialObjects = initialObjectsMap.get(comp.file) || {};
            let apis = [];
            if (childHandlers.size) {
              childHandlers.forEach((h) => {
                const { apis: childApis, objectAssignments: childObjects } = collectApisAndToggles(
                  h,
                  childFnMap,
                  env || {},
                  childInitialObjects
                );
                childApis.forEach((api) => {
                  const mergedEnv = mergeEnv(env, childObjects);
                  addApiToSet(apiSet, api, undefined, mergedEnv);
                  recordTrace(
                    traces,
                    node,
                    evt,
                    [...(api.trace || []), `child:${comp.file}`],
                    api,
                    mergedEnv
                  );
                });
              });
            } else {
              apis = triggerableApisByFile.get(comp.file) || [];
              apis.forEach((api) =>
                addApiToSet(apiSet, api, undefined, mergeEnv(env, api.env))
              );
            }
          });
        });
      });
      directToggles.forEach((varName) => {
        const components = findComponentsByBinding(
          node.absPath,
          varName,
          visibilityBindings,
          tagFileMap
        );
        components.forEach((comp) => {
          const dataBindingKey = comp.bindings.data
            ? "data"
            : comp.bindings.modelValue
              ? "modelValue"
              : comp.bindings.model
                ? "model"
                : null;
          const dataVar = dataBindingKey ? comp.bindings[dataBindingKey] : null;
          const baseEnv = null;
          const childPropAliases = propAliasesMap.get(comp.file) || {};
          const env = buildChildEnv(
            baseEnv,
            dataVar,
            dataBindingKey,
            childPropAliases
          );
          const childHandlers = templateHandlers.get(comp.file) || new Set();
          const childFnMap = fnGraphs.get(comp.file) || new Map();
          const childInitialObjects = initialObjectsMap.get(comp.file) || {};
          let apis = [];
          if (childHandlers.size) {
            childHandlers.forEach((h) => {
              const { apis: childApis, objectAssignments: childObjects } = collectApisAndToggles(
                h,
                childFnMap,
                env || {},
                childInitialObjects
              );
              childApis.forEach((api) => {
                const mergedEnv = mergeEnv(env, childObjects);
                addApiToSet(apiSet, api, undefined, mergedEnv);
                recordTrace(
                  traces,
                  node,
                  evt,
                  [...(api.trace || []), `child:${comp.file}`],
                  api,
                  mergedEnv
                );
              });
            });
          } else {
            apis = triggerableApisByFile.get(comp.file) || [];
            apis.forEach((api) =>
              addApiToSet(apiSet, api, undefined, mergeEnv(env, api.env))
            );
          }
        });
      });
    });

    const mergedNode = {
      ...node,
      events: undefined,
      apis: Array.from(apiSet.values()),
      trace: traces,
    };
    if (traces.length) {
      pageTraces.push({
        page: mergedNode.page || "",
        file: mergedNode.file,
        auth: mergedNode.authValue,
        traces,
      });
    }
    return mergedNode;
  });
  if (pageTraces.length && traceDebug) {
    traceDebug.push(pageTraces);
  }
  return mergedNodes;
}

function recordTrace(traces, node, evt, chain, api, env) {
  traces.push({
    auth: node.authValue,
    tag: node.tag,
    name: node.name,
    event: evt.event,
    expression: evt.expression,
    api: { url: api.url || api.from || api.callee, method: api.method },
    chain,
    env,
  });
}

function collectApisAndToggles(fnName, fnMap, initialEnv = {}, initialObjects = {}) {
  const baseEnv = initialEnv || {};
  const visited = new Set();
  const results = [];
  const toggles = new Set();
  const objectAssignments = { ...initialObjects, ...baseEnv };

  const dfs = (name, trace) => {
    if (visited.has(name)) return;
    visited.add(name);
    const fn = fnMap?.get(name);
    if (!fn) return;

    const paramEnv = {};
    (fn.params || []).forEach((p) => {
      if (baseEnv[p]) paramEnv[p] = baseEnv[p];
    });

    for (const api of fn.apiCalls) {
      results.push({
        ...api,
        trace: [...trace, `script:${name}`, `api:${api.callee}`],
      });
    }
    (fn.toggles || []).forEach((t) => toggles.add(t));
    Object.assign(objectAssignments, fn.objectAssignments || {});
    (fn.aliasAssignments || []).forEach(({ target, source }) => {
      if (objectAssignments[target]) return;
      if (objectAssignments[source]) {
        objectAssignments[target] = objectAssignments[source];
      } else if (paramEnv[source]) {
        objectAssignments[target] = paramEnv[source];
      } else if (fn.objectAssignments[source]) {
        objectAssignments[target] = fn.objectAssignments[source];
      }
    });

    for (const next of fn.calls) {
      dfs(next, [...trace, `script:${name}`]);
    }
  };

  dfs(fnName, []);
  return { apis: results, toggles: Array.from(toggles), objectAssignments };
}

function extractHandlerNames(expression) {
  return extractHandlerNamesFromExpression(expression);
}

function findComponentsByBinding(currentFile, varName, visibilityBindings, tagFileMap) {
  const bindings = visibilityBindings.get(currentFile);
  if (!bindings) return [];
  const entries = bindings.get(varName);
  if (!entries) return [];
  return entries
    .map((entry) => {
      const directKey = entry.tag.toLowerCase();
      const kebabKey = toKebabCase(entry.tag);
      const file =
        tagFileMap.get(directKey) || tagFileMap.get(kebabKey) || null;
      if (!file) return null;
      return { file, bindings: entry.bindings };
    })
    .filter(Boolean);
}

function buildTagToFileMap(vueFiles) {
  const map = new Map();
  vueFiles.forEach((file) => {
    const base = path.basename(file, ".vue");
    const kebab = toKebabCase(base);
    const simple = base.toLowerCase();
    const segments = kebab.split("-");
    const keys = new Set([kebab, simple]);
    // 追加后缀匹配，防止模板使用简写组件名
    for (let i = 0; i < segments.length; i++) {
      const slice = segments.slice(i).join("-");
      keys.add(slice);
    }
    keys.forEach((k) => {
      if (!map.has(k)) map.set(k, file);
    });
  });
  return map;
}

function addApiToSet(apiSet, api, allowedMethods, env) {
  const url = api?.url || api?.from || api?.callee;
  if (!url) return;
  const rawMethod = api?.method;
  let filterMethods = allowedMethods;
  if (!filterMethods && Array.isArray(rawMethod) && api.methodTest) {
    const evalResult = evalMethodTest(api.methodTest, api.argInfo, env);
    if (evalResult) filterMethods = evalResult;
  }
  const methods = Array.isArray(rawMethod) ? rawMethod : [rawMethod || "get"];
  methods.forEach((method) => {
    const normalized = typeof method === "string" ? method.toUpperCase() : "GET";
    if (filterMethods && filterMethods.length && !filterMethods.includes(normalized)) {
      return;
    }
    const key = `${normalized}|${url}`;
    if (!apiSet.has(key)) {
      apiSet.set(key, { url, method: normalized });
    }
  });
}

function collectApisFromExpression(expression, imports, filename) {
  if (!expression) return [];
  try {
    const ast = parseExpression(expression, {
      plugins: ["typescript", "jsx", "optionalChaining", "nullishCoalescingOperator"],
    });
    const apis = [];
    const stack = [ast];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node.type !== "string") continue;
      if (node.type === "CallExpression") {
        const calleeName = getCalleeName(node.callee);
        const api = resolveApiCall(node, calleeName, imports, filename, SRC_DIR);
        if (api) apis.push(api);
        else if (calleeName === "window.open" || calleeName === "open") {
          const arg = node.arguments?.[0];
          const url = stringifyUrlArg(arg);
          if (url) {
            apis.push({ url, method: "GET", callee: calleeName });
          }
        } else if (calleeName === "router.push" || calleeName === "push") {
          const routeInfo = extractRouterPushInfo(node);
          if (routeInfo) {
            apis.push({ url: routeInfo.path, method: "NAVIGATE", callee: "router.push", query: routeInfo.query });
          }
        }
      }
      Object.values(node).forEach((child) => {
        if (Array.isArray(child)) child.forEach((c) => stack.push(c));
        else if (child && typeof child.type === "string") stack.push(child);
      });
    }
    return apis;
  } catch {
    return [];
  }
}

// getCalleeName defined above

function buildInitialEnvFromExpression(expression, handlerName, fnMap, propUsage) {
  if (!expression || !handlerName) return null;
  const fn = fnMap.get(handlerName);
  if (!fn?.params?.length) return null;
  let ast;
  try {
    ast = parseExpression(expression, {
      plugins: ["typescript", "jsx", "optionalChaining", "nullishCoalescingOperator"],
    });
  } catch {
    return null;
  }
  const argsList = [];
  const stack = [ast];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    if (node.type === "CallExpression") {
      const calleeName = getCalleeName(node.callee);
      if (calleeName === handlerName) {
        argsList.push(node.arguments || []);
      }
    }
    Object.values(node).forEach((child) => {
      if (Array.isArray(child)) child.forEach((c) => stack.push(c));
      else if (child && typeof child.type === "string") stack.push(child);
    });
  }
  if (!argsList.length) return null;
  const env = {};
  argsList.forEach((args) => {
    args.forEach((arg, idx) => {
      if (!arg || !fn.params[idx]) return;
      const argStr = stringifySimpleExpression(arg);
      const props = argStr ? propUsage.get(argStr) : null;
      if (props && props.size) {
        env[fn.params[idx]] = {
          props: Object.fromEntries(
            Array.from(props).map((p) => [p, { kind: "present" }])
          ),
        };
      } else if (arg.type === "Identifier") {
        env[fn.params[idx]] = { props: { [arg.name]: { kind: "present" } } };
      } else if (
        arg.type === "MemberExpression" &&
        arg.object.type === "Identifier" &&
        arg.property.type === "Identifier"
      ) {
        env[fn.params[idx]] = {
          props: {
            [arg.property.name]: { kind: "present" },
          },
          spreads: [{ kind: "member", object: arg.object.name, property: arg.property.name }],
        };
      }
    });
  });
  return Object.keys(env).length ? env : null;
}

function stringifySimpleExpression(node) {
  if (!node) return "";
  if (node.type === "Identifier") return node.name;
  if (
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression"
  ) {
    const obj = stringifySimpleExpression(node.object);
    const prop =
      node.property?.type === "Identifier"
        ? node.property.name
        : node.property?.type === "StringLiteral"
          ? node.property.value
          : "";
    if (!obj) return prop;
    if (!prop) return obj;
    return `${obj}.${prop}`;
  }
  return "";
}

// stringifyUrlArg defined above

function buildChildEnv(baseEnv, dataVar, dataBindingKey, propAliases) {
  if (!baseEnv) return null;
  const env = {};
  if (dataVar) env[dataVar] = baseEnv;
  if (dataVar && baseEnv.spreads) {
    env[dataVar].spreads = baseEnv.spreads;
  }
  Object.entries(propAliases || {}).forEach(([localVar, propKey]) => {
    if (propKey === dataBindingKey) {
      env[localVar] = baseEnv;
    }
  });
  if (dataBindingKey) {
    env.props = {
      props: {
        [dataBindingKey]: {
          props: baseEnv.props || {},
        },
      },
    };
  }
  return env;
}

function mergeEnv(primary, secondary) {
  if (primary && secondary) return { ...secondary, ...primary };
  return primary || secondary || null;
}

function evalMethodTest(testMeta, argInfo, env) {
  if (!testMeta || !argInfo) return null;
  if (!testMeta.path || testMeta.path.length === 0) return null;
  let baseProps = null;
  if (argInfo.kind === "object" && argInfo.props) {
    baseProps = argInfo.props;
  } else if (argInfo.kind === "identifier" && env?.[argInfo.name]?.props) {
    baseProps = env[argInfo.name].props;
  } else if (
    argInfo.kind === "member" &&
    env?.[argInfo.object]?.props
  ) {
    const objProps = env[argInfo.object].props;
    const [first, ...rest] = argInfo.path || [];
    if (first === "value") {
      baseProps = objProps;
    } else {
      const prop = objProps[first];
      if (prop?.kind === "literal") {
        baseProps = { value: prop.value, props: {} };
      } else if (prop?.props) {
        baseProps = prop.props;
      }
    }
  }
  if (!baseProps && argInfo.kind === "identifier" && env?.[argInfo.name]?.spreads) {
    for (const spread of env[argInfo.name].spreads) {
      if (spread.kind === "member" && env[spread.object]?.props) {
        const objProps = env[spread.object].props;
        if (objProps[testMeta.path[0]]) {
          baseProps = objProps;
          break;
        }
      }
      if (spread.kind === "identifier" && env[spread.name]?.props) {
        const objProps = env[spread.name].props;
        if (objProps[testMeta.path[0]]) {
          baseProps = objProps;
          break;
        }
      }
    }
  }
  if (!baseProps && env) {
    const first = testMeta.path[0];
    for (const val of Object.values(env)) {
      if (!val?.props) continue;
      const prop = val.props[first];
      if (prop?.kind === "literal") {
        const v = prop.value;
        if (v === undefined || v === null || v === false) return ["POST"];
        return ["PUT"];
      }
      if (prop?.kind === "present") return ["PUT"];
    }
    // 仍未找到匹配字段，但存在环境信息时按“无 id => POST，有 id => PUT”兜底
    const hasAnyId = Object.values(env).some(
      (val) => val?.props && val.props.id
    );
    if (hasAnyId) return ["PUT"];
    if (Object.keys(env).length > 0) return ["POST"];
  }
  if (!baseProps) return null;
  let current = baseProps;
  for (const seg of testMeta.path) {
    const prop = current[seg];
    if (!prop) return ["POST"]; // 未出现该字段，视为假
    if (prop.kind === "literal") {
      const val = prop.value;
      if (val === undefined || val === null || val === false) return ["POST"];
      return ["PUT"];
    }
    if (prop.kind === "present") {
      return ["PUT"];
    }
    return ["POST", "PUT"];
  }
  return null;
}

function toRoutePath(relativeDir) {
  if (!relativeDir || relativeDir === ".") return "/";
  return (
    "/" +
    relativeDir
      .split(path.sep)
      .map((seg) => seg.replace(/\[([^\]]+)\]/g, ":$1"))
      .join("/")
  );
}

function toKebabCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/\s+/g, "-")
    .toLowerCase();
}

function serializeBindings(bindings) {
  const obj = {};
  bindings?.forEach((arr, key) => {
    obj[key] = arr;
  });
  return obj;
}

function serializeMapOfSets(map) {
  const obj = {};
  map?.forEach((set, key) => {
    obj[key] = Array.from(set);
  });
  return obj;
}

function serializeFunctionGraph(fnMap) {
  const arr = [];
  fnMap?.forEach((fn, key) => {
    arr.push({
      name: key,
      loc: fn.loc,
      params: fn.params,
      calls: fn.calls,
      toggles: fn.toggles,
      apiCalls: fn.apiCalls,
      objectAssignments: fn.objectAssignments,
      aliasAssignments: fn.aliasAssignments,
    });
  });
  return arr;
}

function serializeImports(imports) {
  const arr = [];
  imports?.forEach((val, key) => {
    arr.push({ local: key, ...val });
  });
  return arr;
}

function serializeTagFileMap(map) {
  const obj = {};
  map?.forEach((v, k) => {
    obj[k] = path.relative(ROOT, v);
  });
  return obj;
}

function serializeTriggerable(map) {
  const obj = {};
  map?.forEach((arr, file) => {
    obj[path.relative(ROOT, file)] = arr;
  });
  return obj;
}

function buildSummary(results) {
  const emptyAuths = [];
  const multiMethod = [];
  results.forEach((page) => {
    page.authBindings.forEach((b) => {
      if (!b.apis || b.apis.length === 0) {
        emptyAuths.push({
          page: page.page,
          auth: b.authValue,
          name: b.name,
          file: b.file,
        });
      }
      const map = new Map();
      (b.apis || []).forEach((api) => {
        const key = api.url;
        if (!map.has(key)) map.set(key, new Set());
        map.get(key).add(api.method);
      });
      map.forEach((set, url) => {
        if (set.size > 1) {
          multiMethod.push({
            page: page.page,
            auth: b.authValue,
            name: b.name,
            url,
            methods: Array.from(set),
          });
        }
      });
    });
  });
  return { emptyAuths, multiMethod };
}

// ============================================================
// SECTION: AI Completion
// ============================================================
/**
 * AI 补全按钮-API 映射分析器
 * 
 * 读取 dist/auth-mapping.json 中静态分析未能关联 API 的按钮，
 * 调用 LLM 分析源码补全映射关系。
 * 
 * 用法: node scripts/ai-complete-auth.mjs
 */


// ─── 按模块分组 + 准备 AI 任务 ────────────────────────────
// 不再自己调用 LLM，而是输出结构化任务文件，由 DSH agent 通过 subagent 并发处理

async function collectModuleFiles(buttons, rootDir) {
  // Collect all relevant files for a group of buttons in the same module
  const allFiles = new Set();
  for (const button of buttons) {
    const absFile = path.join(rootDir, button.file);
    const pageDir = path.dirname(absFile);
    const vueFiles = await fg("**/*.vue", { cwd: pageDir, absolute: true });
    const apiFiles = await fg("**/api/index.ts", { cwd: pageDir, absolute: true });
    const parentApi = await fg("api/index.ts", { cwd: path.dirname(pageDir), absolute: true });
    [...vueFiles, ...apiFiles, ...parentApi].forEach(f => allFiles.add(f));
  }
  return [...allFiles];
}

function buildBatchPrompt(moduleName, buttons, fileContents) {
  const filesSection = fileContents
    .map(({ filePath, content }) => "### File: " + filePath + "\n```\n" + content + "\n```")
    .join("\n\n");

  const buttonsList = buttons.map((b, i) => {
    const authClean = (b.authValue || "").replace(/['"]/g, "");
    return (i + 1) + ". v-auth=\"" + authClean + "\" | 名称: \"" + (b.name || "") + "\" | 标签: " + (b.tag || "") + " | 文件: " + b.file;
  }).join("\n");

  return "你是一个 Vue 3 + TypeScript 代码分析专家。分析以下源码，找出每个按钮最终调用的后端 API 接口。\n\n" +
    "## 分析规则\n" +
    "1. 找到每个 v-auth 指令对应的按钮元素\n" +
    "2. 追踪 @click 事件处理函数 → 弹窗/对话框 → request()/axios 调用 → url + method\n" +
    "3. 如果按钮只打开预览/详情弹窗且不涉及 API 调用，apis 返回空数组\n" +
    "4. el-upload 追踪 :http-request 或 :on-change\n" +
    "5. 条件表达式如 dataSource.id ? PUT : POST，根据上下文判断\n" +
    "6. router.push / window.open → method: NAVIGATE, url: 目标路径\n\n" +
    "## 模块: " + moduleName + "\n\n" +
    "## 需要分析的按钮 (" + buttons.length + " 个):\n" + buttonsList + "\n\n" +
    "## 源码:\n" + filesSection + "\n\n" +
    "## 输出格式\n" +
    "严格输出 JSON 数组，每个元素对应一个按钮：\n" +
    "[\n" +
    "  {\n" +
    "    \"authId\": \"去掉引号的权限标识\",\n" +
    "    \"label\": \"按钮显示文本\",\n" +
    "    \"apis\": [{ \"method\": \"GET|POST|PUT|DELETE|NAVIGATE\", \"url\": \"/api/path\", \"apiFunction\": \"函数名\", \"note\": \"可选\" }],\n" +
    "    \"confidence\": \"high|medium|low\",\n" +
    "    \"reasoning\": \"简要追踪路径\"\n" +
    "  }\n" +
    "]";
}

async function prepareAITasks() {
  const mappingFile = path.join(ROOT, CONFIG.outputDir, "auth-mapping.json");
  if (!fs.existsSync(mappingFile)) {
    console.error("❌ 未找到 dist/auth-mapping.json，请先运行静态分析");
    process.exit(1);
  }

  const mapping = JSON.parse(fs.readFileSync(mappingFile, "utf-8"));

  // Group unmatched buttons by page/module
  const groups = {};
  let totalButtons = 0;
  mapping.forEach(page => {
    page.authBindings.forEach(binding => {
      totalButtons++;
      if (!binding.apis || binding.apis.length === 0) {
        const key = page.page;
        if (!groups[key]) groups[key] = [];
        groups[key].push({
          page: page.page,
          authValue: binding.authValue,
          name: binding.name,
          file: binding.file,
          tag: binding.tag,
        });
      }
    });
  });

  const unmatchedCount = Object.values(groups).reduce((sum, arr) => sum + arr.length, 0);
  const moduleCount = Object.keys(groups).length;

  console.log("📊 静态分析覆盖率: " + (totalButtons - unmatchedCount) + "/" + totalButtons + " (" + ((totalButtons - unmatchedCount) / totalButtons * 100).toFixed(1) + "%)");
  console.log("🔍 需要 AI 补全: " + unmatchedCount + " 个按钮，分布在 " + moduleCount + " 个模块");
  emit({ type: "ai-start", total: unmatchedCount, modules: moduleCount, coverage: ((totalButtons - unmatchedCount) / totalButtons * 100).toFixed(1) });

  if (unmatchedCount === 0) {
    console.log("✅ 所有按钮已关联 API，无需 AI 补全");
    emit({ type: "done" });
    return;
  }

  // Build tasks
  const tasks = [];
  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const resultsDir = path.join(OUTPUT_DIR, "ai-results");
  fs.mkdirSync(resultsDir, { recursive: true });

  // Check cache
  const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
  const cache = loadCache(cacheFile);

  let cachedModules = 0;
  let pendingModules = 0;

  for (const [moduleName, buttons] of Object.entries(groups)) {
    // Check if all buttons in this module are cached
    const allCached = buttons.every(b => cache[b.page + "|" + b.authValue]);
    if (allCached) {
      cachedModules++;
      emit({ type: "ai-progress", current: tasks.length + 1, total: moduleCount, page: moduleName, status: "cache-hit", buttons: buttons.length });
      continue;
    }

    // Collect files for this module
    const relevantFiles = await collectModuleFiles(buttons, ROOT);
    const fileContents = [];
    let totalSize = 0;
    const MAX_SIZE = 120000; // Larger limit for batch

    // Prioritize: button files first, then API files, then others
    const buttonAbsPaths = buttons.map(b => path.join(ROOT, b.file));
    const priorityFiles = relevantFiles.filter(f => buttonAbsPaths.includes(f) || f.includes("/api/"));
    const otherFiles = relevantFiles.filter(f => !priorityFiles.includes(f));
    const orderedFiles = [...priorityFiles, ...otherFiles];

    for (const filePath of orderedFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (totalSize + content.length > MAX_SIZE) continue;
        fileContents.push({ filePath: path.relative(ROOT, filePath), content });
        totalSize += content.length;
      } catch { /* skip unreadable */ }
    }

    const prompt = buildBatchPrompt(moduleName, buttons, fileContents);
    const safeName = moduleName.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/^_+|_+$/g, "") || "root";

    tasks.push({
      id: safeName,
      module: moduleName,
      buttons: buttons.map(b => ({ authValue: b.authValue, name: b.name, file: b.file, tag: b.tag })),
      prompt,
      outputFile: path.join(ROOT, CONFIG.outputDir, "ai-results", safeName + ".json"),
    });

    pendingModules++;
    emit({ type: "ai-progress", current: tasks.length + cachedModules, total: moduleCount, page: moduleName, status: "pending", buttons: buttons.length });
  }

  // Write per-module task files (avoids one huge JSON that breaks agent parsing)
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

  // Write small index file (no prompts, just metadata)
  const indexFile = path.join(tasksDir, "index.json");
  const indexOutput = {
    generatedAt: new Date().toISOString(),
    totalButtons: unmatchedCount,
    totalModules: moduleCount,
    cachedModules,
    pendingModules: tasks.length,
    tasks: indexEntries,
  };
  fs.writeFileSync(indexFile, JSON.stringify(indexOutput, null, 2), "utf-8");

  console.log("\n📋 AI 任务目录: " + path.relative(ROOT, tasksDir));
  console.log("   索引文件: " + path.relative(ROOT, indexFile));
  console.log("   待分析模块: " + tasks.length + " 个（每模块一个文件）");
  console.log("   缓存命中模块: " + cachedModules + " 个");
  console.log("\n💡 请读取 " + path.relative(ROOT, indexFile) + " 获取任务列表，逐个读取模块文件获取 prompt");

  // Build batch plan
  const BATCH_SIZE = 2;
  const batches = [];
  for (let i = 0; i < indexEntries.length; i += BATCH_SIZE) {
    batches.push(indexEntries.slice(i, i + BATCH_SIZE).map(t => ({ module: t.module, buttons: t.buttons, taskFile: t.taskFile, outputFile: t.outputFile })));
  }
  emit({ type: "tasks-ready", indexFile, pending: tasks.length, cached: cachedModules, batchSize: BATCH_SIZE, totalBatches: batches.length, batches });
}

// ─── 合并 AI 结果（subagent 写入的分散结果）────────────────
function mergeAIResults() {
  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const resultsDir = path.join(OUTPUT_DIR, "ai-results");
  const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
  const cache = loadCache(cacheFile);

  // Build authId → {page, authValue} mapping from static analysis output.
  // This is the single source of truth for button→page membership.
  const authIdToOriginal = new Map();
  const mappingFile = path.join(OUTPUT_DIR, "auth-mapping.json");
  if (fs.existsSync(mappingFile)) {
    try {
      const mapping = JSON.parse(fs.readFileSync(mappingFile, "utf-8"));
      (Array.isArray(mapping) ? mapping : []).forEach(page => {
        (page.authBindings || []).forEach(b => {
          const cleanId = (b.authValue || "").replace(/['"]/g, "");
          if (cleanId && !authIdToOriginal.has(cleanId)) {
            authIdToOriginal.set(cleanId, { page: page.page, authValue: b.authValue });
          }
        });
      });
    } catch {}
  }

  if (!fs.existsSync(resultsDir)) {
    console.error("❌ 未找到 dist/ai-results/ 目录");
    process.exit(1);
  }

  const resultFiles = fs.readdirSync(resultsDir).filter(f => f.endsWith(".json"));
  if (resultFiles.length === 0) {
    console.error("❌ dist/ai-results/ 中没有结果文件");
    process.exit(1);
  }

  const allResults = [];
  let fileCount = 0;

  for (const file of resultFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf-8"));
      const moduleName = data.module || file.replace(/\.json$/, "");
      const results = Array.isArray(data) ? data : (data.results || []);
      results.forEach(r => {
        // Enrich with original page + authValue from tasks
        const original = authIdToOriginal.get(r.authId);
        if (original) {
          r.page = original.page;
          r.authValue = original.authValue;
        } else if (!r.page) {
          r.page = moduleName;
        }
        allResults.push(r);
        // Update cache with correct key format (page|'authValue')
        if (r.authId) {
          const page = r.page || moduleName;
          const authVal = r.authValue || ("'" + r.authId + "'");
          const cacheKey = page + "|" + authVal;
          cache[cacheKey] = { apis: r.apis || [], confidence: r.confidence || "medium", reasoning: r.reasoning || "" };
        }
      });
      fileCount++;
    } catch (e) {
      console.log("⚠️  跳过无效结果文件: " + file + " (" + e.message + ")");
    }
  }

  saveCache(cacheFile, cache);

  const output = {
    generatedAt: new Date().toISOString(),
    model: "dsh-subagent",
    stats: {
      total: allResults.length,
      cacheHits: 0,
      llmCalls: fileCount,
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
  console.log("   🟢 高: " + output.stats.highConfidence + " 🟡 中: " + output.stats.mediumConfidence + " 🔴 低: " + output.stats.lowConfidence + " ❌ 失败: " + output.stats.failed);
  console.log("   输出: " + path.relative(ROOT, aiOutputFile));
}

// ─── 缓存管理 ────────────────────────────────────────────
function loadCache(cacheFile) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cacheFile, cache) {
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2), "utf-8");
}

// ============================================================
// MERGE: Combine static analysis and AI completion results
// ============================================================
function mergeResults(staticData, aiData) {
  const aiMap = new Map();
  if (aiData && aiData.results) {
    aiData.results.forEach((r) => {
      const key = r.page + "|" + r.authValue;
      aiMap.set(key, r);
    });
  }

  const pages = [];
  let staticMatched = 0, aiMatched = 0, uiOnly = 0, totalButtons = 0;

  (staticData || []).forEach((page) => {
    const buttons = [];
    page.authBindings.forEach((b) => {
      totalButtons++;
      const aiKey = page.page + "|" + b.authValue;
      const aiResult = aiMap.get(aiKey);

      if (b.apis && b.apis.length > 0) {
        staticMatched++;
        buttons.push({
          authId: (b.authValue || "").replace(/['"]/g, ""),
          label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
          apis: b.apis.map((a) => ({ method: a.method, url: a.url })),
          source: "static", confidence: "high",
        });
      } else if (aiResult) {
        if (aiResult.apis && aiResult.apis.length > 0) {
          aiMatched++;
          buttons.push({
            authId: (b.authValue || "").replace(/['"]/g, ""),
            label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
            apis: aiResult.apis.map((a) => ({ method: a.method, url: a.url, apiFunction: a.apiFunction || "", note: a.note || "" })),
            source: "ai", confidence: aiResult.confidence || "medium", reasoning: aiResult.reasoning || "",
          });
        } else {
          uiOnly++;
          buttons.push({
            authId: (b.authValue || "").replace(/['"]/g, ""),
            label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
            apis: [], source: "ai", confidence: aiResult.confidence || "high", reasoning: aiResult.reasoning || "Pure UI operation",
          });
        }
      } else {
        buttons.push({
          authId: (b.authValue || "").replace(/['"]/g, ""),
          label: b.name || "", tag: b.tag || "", file: b.file || "", line: b.line || 0,
          apis: [], source: "static", confidence: "unresolved",
        });
      }
    });
    pages.push({ page: page.page, buttons });
  });

  const coverage = totalButtons > 0 ? ((staticMatched + aiMatched) / totalButtons * 100).toFixed(1) + "%" : "0%";
  return { generatedAt: new Date().toISOString(), stats: { totalButtons, staticMatched, aiMatched, uiOnly, coverage }, pages };
}

// ============================================================
// MAIN ENTRY
// ============================================================
async function main() {
  const opts = parseArgs();
  if (opts.help) { printHelp(); return; }
  NDJSON_MODE = opts.ndjson;

  // Handle SIGINT for graceful cancellation
  let cancelled = false;
  process.on("SIGINT", () => {
    cancelled = true;
    emit({ type: "cancelled" });
    process.exit(130);
  });

  ROOT = CONFIG.rootDir;
  SRC_DIR = path.join(ROOT, CONFIG.viewsDir);
  const OUTPUT_DIR = path.join(ROOT, CONFIG.outputDir);
  const STATIC_OUTPUT = path.join(OUTPUT_DIR, "auth-mapping.json");
  const AI_OUTPUT = path.join(OUTPUT_DIR, "auth-mapping-ai.json");
  const MERGED_OUTPUT = path.join(OUTPUT_DIR, "auth-mapping-merged.json");

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(path.join(OUTPUT_DIR, "auth-debug"), { recursive: true });

  let staticData = null;
  let aiData = null;

  // Phase 1: Static analysis (unless --merge-ai only)
  if (!opts.mergeAi) {
    emit({ type: "phase", phase: "static", label: "Static Analysis" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 1: Static Analysis");
    console.log("=".repeat(60));
    staticData = await runStaticAnalysis(ROOT, SRC_DIR, OUTPUT_DIR);
    fs.writeFileSync(STATIC_OUTPUT, JSON.stringify(staticData, null, 2), "utf-8");
    console.log("Static output: " + path.relative(ROOT, STATIC_OUTPUT));
  } else {
    if (fs.existsSync(STATIC_OUTPUT)) {
      staticData = JSON.parse(fs.readFileSync(STATIC_OUTPUT, "utf-8"));
    }
  }

  // Phase 2: AI task preparation or result merging
  if (opts.mergeAi) {
    emit({ type: "phase", phase: "merge-ai", label: "Merge AI Results" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2: Merge AI Results");
    console.log("=".repeat(60));
    mergeAIResults();
    if (fs.existsSync(AI_OUTPUT)) {
      aiData = JSON.parse(fs.readFileSync(AI_OUTPUT, "utf-8"));
    }
  } else if (!opts.staticOnly && CONFIG.ai.enabled) {
    emit({ type: "phase", phase: "prepare-ai", label: "Prepare AI Tasks" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 2: Prepare AI Tasks");
    console.log("=".repeat(60));
    if (opts.noCache) {
      const cacheFile = path.join(OUTPUT_DIR, ".ai-auth-cache.json");
      if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile);
      console.log("AI cache cleared.");
    }
    await prepareAITasks();
  }

  // Phase 3: Only merge when explicitly requested (--merge-ai)
  if (opts.mergeAi && staticData) {
    emit({ type: "phase", phase: "merge", label: "Merge Results" });
    console.log("\n" + "=".repeat(60));
    console.log("PHASE 3: Merge Results");
    console.log("=".repeat(60));
    const merged = mergeResults(staticData, aiData);
    fs.writeFileSync(MERGED_OUTPUT, JSON.stringify(merged, null, 2), "utf-8");
    console.log("Merged output: " + path.relative(ROOT, MERGED_OUTPUT));
    console.log("\nStats:", JSON.stringify(merged.stats, null, 2));
  }

  console.log("\nDone!");
  emit({ type: "done" });
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
