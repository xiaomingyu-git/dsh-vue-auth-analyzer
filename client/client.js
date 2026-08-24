window.__ModuleLoader__.load({
  id: "dsh-vue-auth-analyzer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // ─── CSS (injected once) ────────────────────────────────
    const css = [
      ".ava-card{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}",
      ".ava-card:hover{border-color:var(--dsw-alias-label-dimmed,#c8ccd4)}",
      ".ava-card.ava-open{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-color:var(--dsw-alias-label-dimmed,#c8ccd4)}",
      ".ava-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
      ".ava-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4f6ef7);outline-offset:-2px}",
      ".ava-head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
      ".ava-name{color:var(--dsw-alias-label-primary,#1f2328);font-size:15px;font-weight:600;line-height:1.4}",
      ".ava-desc{color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:13px;line-height:1.5}",
      ".ava-chevron{color:var(--dsw-alias-label-tertiary,#8b93a1);flex:none;display:inline-flex;transition:transform .16s}",
      ".ava-chevron.ava-open{transform:rotate(180deg)}",
      ".ava-body{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);margin:0 16px;padding-bottom:8px}",
      ".ava-row{display:flex;align-items:center;gap:12px;padding:12px 0}",
      ".ava-row+.ava-row{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb)}",
      ".ava-label-box{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}",
      ".ava-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2328)}",
      ".ava-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b93a1)}",
      ".ava-input{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);height:34px;font:inherit;color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:220px;max-width:100%;box-sizing:border-box}",
      ".ava-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4f6ef7);outline:none}",
      ".ava-input:disabled{color:var(--dsw-alias-label-tertiary,#8b93a1);cursor:default}",
      ".ava-seg{display:inline-flex;flex-shrink:0;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:2px;gap:2px}",
      ".ava-seg-btn{font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer}",
      ".ava-seg-btn:disabled{cursor:default;opacity:.5}",
      ".ava-seg-on{background:var(--dsw-alias-bg-layer-2,#eef0f4);color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}",
      ".ava-actions{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
      ".ava-status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b93a1)}",
      ".ava-status-ok{color:var(--dsw-alias-state-success-primary,#16a34a)}",
      ".ava-status-err{color:var(--dsw-alias-state-error-primary,#dc2626)}",
      ".ava-run-btn{display:flex;align-items:center;gap:6px}",
    ].join("\n");

    const tagId = "dsh-vue-auth-analyzer/card.css";
    if (typeof document !== "undefined" && !document.querySelector('style[data-plugin-css="' + tagId + '"]')) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-vue-auth-analyzer";
      tag.dataset.pluginCss = tagId;
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    // ─── Locale ─────────────────────────────────────────────
    const zh = {
      nav: "Auth Analyzer",
      cardDesc: "Vue 3 按钮-权限-API 映射分析器配置",
      viewsDir: "页面目录",
      viewsDirHint: "Vue 页面文件所在目录（相对于项目根目录）",
      authDirective: "权限指令名",
      authDirectiveHint: "v-auth 中的 \"auth\"，若用 v-permission 则填 \"permission\"",
      i18nFile: "i18n 翻译文件",
      i18nFileHint: "中文翻译文件路径，留空跳过 i18n 解析",
      excludePatterns: "排除模式",
      excludePatternsHint: "逗号分隔的 glob 模式，匹配的目录不参与扫描",
      aiEnabled: "AI 补全",
      aiEnabledHint: "对静态分析未覆盖的按钮调用 LLM 补全映射",
      aiModel: "AI 模型",
      aiModelHint: "LLM 模型名称",
      runAnalysis: "运行分析",
      runStaticOnly: "仅静态分析",
      running: "分析中…",
      idle: "就绪",
      lastRun: "上次运行",
      noLastRun: "尚未运行",
      save: "保存",
      saved: "已保存",
      saving: "保存中…",
      on: "开",
      off: "关",
    };

    const en = {
      nav: "Auth Analyzer",
      cardDesc: "Vue 3 button-permission-API mapping analyzer configuration",
      viewsDir: "Views Directory",
      viewsDirHint: "Vue pages directory relative to project root",
      authDirective: "Auth Directive",
      authDirectiveHint: "The name in v-auth; use \"permission\" for v-permission",
      i18nFile: "i18n File",
      i18nFileHint: "Path to i18n translation file; leave empty to skip",
      excludePatterns: "Exclude Patterns",
      excludePatternsHint: "Comma-separated glob patterns to exclude from scanning",
      aiEnabled: "AI Completion",
      aiEnabledHint: "Use LLM to complete mappings for buttons not covered by static analysis",
      aiModel: "AI Model",
      aiModelHint: "LLM model name",
      runAnalysis: "Run Analysis",
      runStaticOnly: "Static Only",
      running: "Running…",
      idle: "Ready",
      lastRun: "Last Run",
      noLastRun: "Not yet run",
      save: "Save",
      saved: "Saved",
      saving: "Saving…",
      on: "On",
      off: "Off",
    };

    // ─── Settings namespace ─────────────────────────────────
    const NS = "dsh-vue-auth-analyzer";

    // ─── AnalyzerCard component ─────────────────────────────
    function AnalyzerCard(props) {
      var t = props.t;
      var _useState = react.useState(false);
      var open = _useState[0];
      var setOpen = _useState[1];

      // Read current settings from the host
      var _useState2 = react.useState(null);
      var settings = _useState2[0];
      var setSettings = _useState2[1];

      var _useState3 = react.useState("idle");
      var saveState = _useState3[0];
      var setSaveState = _useState3[1];

      var _useState4 = react.useState(null);
      var runStatus = _useState4[0];
      var setRunStatus = _useState4[1];

      var _useState5 = react.useState(false);
      var running = _useState5[0];
      var setRunning = _useState5[1];

      // Local drafts
      var _useState6 = react.useState({});
      var drafts = _useState6[0];
      var setDrafts = _useState6[1];

      // Load settings when card opens
      react.useEffect(function() {
        if (!open || settings) return;
        var live = true;
        (async function() {
          try {
            var res = await fetch("/api/settings/" + NS);
            if (res.ok) {
              var body = await res.json();
              if (live) setSettings(body.value || body);
            }
          } catch(e) {
            // Settings API may not be available; use defaults
            if (live) setSettings({});
          }
        })();
        return function() { live = false; };
      }, [open]);

      var current = function(key, fallback) {
        if (drafts[key] !== undefined) return drafts[key];
        if (settings && settings[key] !== undefined) return settings[key];
        return fallback;
      };

      var setDraft = function(key, value) {
        setDrafts(function(prev) {
          var next = Object.assign({}, prev);
          next[key] = value;
          return next;
        });
      };

      var hasChanges = Object.keys(drafts).length > 0;

      var onSave = async function() {
        if (!hasChanges) return;
        setSaveState("saving");
        try {
          var res = await fetch("/api/settings/" + NS, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(drafts),
          });
          if (res.ok) {
            var body = await res.json();
            setSettings(function(prev) { return Object.assign({}, prev || {}, drafts); });
            setDrafts({});
            setSaveState("saved");
            setTimeout(function() { setSaveState("idle"); }, 2000);
          } else {
            setSaveState("idle");
          }
        } catch(e) {
          setSaveState("idle");
        }
      };

      var onRun = async function(staticOnly) {
        setRunning(true);
        setRunStatus(null);
        try {
          var args = staticOnly ? ["--static-only"] : [];
          var res = await fetch("/api/tools/bash", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              command: "node scripts/vue-auth-api-analyzer.mjs " + args.join(" "),
              description: "Run auth analyzer",
              workdir: ".",
            }),
          });
          if (res.ok) {
            setRunStatus({ ok: true, time: new Date().toLocaleTimeString() });
          } else {
            setRunStatus({ ok: false, error: "HTTP " + res.status });
          }
        } catch(e) {
          setRunStatus({ ok: false, error: e.message || String(e) });
        }
        setRunning(false);
      };

      var h = react.createElement;
      var IconChevronDown = primitives.IconChevronDownOutline14 || primitives.IconSettingsOutline14;
      var Button = primitives.Button;

      var row = function(label, hint, control) {
        return h("div", { className: "ava-row" },
          h("div", { className: "ava-label-box" },
            h("div", { className: "ava-label" }, label),
            h("div", { className: "ava-hint" }, hint)
          ),
          control
        );
      };

      var textInput = function(key, placeholder) {
        return h("input", {
          className: "ava-input",
          type: "text",
          value: current(key, ""),
          placeholder: placeholder || "",
          onChange: function(e) { setDraft(key, e.target.value); },
        });
      };

      var body = open ? h("div", { className: "ava-body" },
        row(t("viewsDir"), t("viewsDirHint"), textInput("viewsDir", "src/views")),
        row(t("authDirective"), t("authDirectiveHint"), textInput("authDirectiveName", "auth")),
        row(t("i18nFile"), t("i18nFileHint"), textInput("i18nFile", "")),
        row(t("excludePatterns"), t("excludePatternsHint"), textInput("excludePatterns", "**/components/**,**/login/**")),
        row(t("aiEnabled"), t("aiEnabledHint"),
          h("div", { className: "ava-seg" },
            h("button", {
              type: "button",
              className: "ava-seg-btn" + (current("aiEnabled", true) ? " ava-seg-on" : ""),
              onClick: function() { setDraft("aiEnabled", true); },
            }, t("on")),
            h("button", {
              type: "button",
              className: "ava-seg-btn" + (!current("aiEnabled", true) ? " ava-seg-on" : ""),
              onClick: function() { setDraft("aiEnabled", false); },
            }, t("off"))
          )
        ),
        row(t("aiModel"), t("aiModelHint"), textInput("aiModel", "qwen3.7-max")),
        // Action row
        h("div", { className: "ava-row" },
          h("div", { className: "ava-label-box" },
            h("div", { className: "ava-label" }, t("runAnalysis")),
            h("div", { className: "ava-hint" },
              runStatus
                ? (runStatus.ok
                    ? h("span", { className: "ava-status ava-status-ok" }, "✓ " + t("lastRun") + ": " + runStatus.time)
                    : h("span", { className: "ava-status ava-status-err" }, "✗ " + runStatus.error))
                : t("noLastRun")
            )
          ),
          h("div", { className: "ava-run-btn" },
            h(Button, {
              variant: "outline",
              size: "sm",
              disabled: running,
              onClick: function() { onRun(true); },
            }, t("runStaticOnly")),
            h(Button, {
              variant: "primary",
              size: "sm",
              disabled: running,
              onClick: function() { onRun(false); },
            }, running ? t("running") : t("runAnalysis"))
          )
        ),
        // Save row
        hasChanges ? h("div", { className: "ava-actions" },
          h("span", { className: "ava-status" },
            saveState === "saved" ? t("saved") : saveState === "saving" ? t("saving") : ""
          ),
          h(Button, {
            variant: "primary",
            size: "sm",
            disabled: saveState === "saving",
            onClick: onSave,
          }, t("save"))
        ) : null
      ) : null;

      return h("div", { className: "ava-card" + (open ? " ava-open" : "") },
        h("button", {
          type: "button",
          className: "ava-header",
          "aria-expanded": open,
          onClick: function() { setOpen(!open); },
        },
          h("div", { className: "ava-head-text" },
            h("div", { className: "ava-name" }, t("nav")),
            h("div", { className: "ava-desc" }, t("cardDesc"))
          ),
          h("span", { className: "ava-chevron" + (open ? " ava-open" : "") },
            h(IconChevronDown, { size: 14 })
          )
        ),
        body
      );
    }

    // ─── Plugin entry ───────────────────────────────────────
    var name = "dsh-vue-auth-analyzer";
    var inject = ["slots", "locale"];

    function apply(ctx) {
      // Register locale dictionaries
      ctx.locale.register(NS, { zh: zh, en: en });
      var t = ctx.locale.bind(NS);

      // Register into settings.plugin.item slot
      var settingsCtx = ctx;
      settingsCtx.inject(["settingsScope"], function(scoped) {
        scoped.slots.inject("settings.plugin.item", function() {
          return scoped.slots.register({
            name: "settings.plugin.item",
            key: NS,
            locale: NS,
            inject: function() { return { t: t }; },
          }, function() {
            return react.createElement(AnalyzerCard, { t: t });
          });
        });
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
