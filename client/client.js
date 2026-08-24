window.__ModuleLoader__.load({
  id: "dsh-vue-auth-analyzer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    // ─── CSS ────────────────────────────────────────────────
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
      ".ava-chevron.ava-chevron-open{transform:rotate(180deg)}",
      ".ava-body{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);margin:0 16px;padding-bottom:8px}",
      ".ava-row{display:flex;align-items:center;gap:12px;padding:12px 0}",
      ".ava-row+.ava-row{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb)}",
      ".ava-label-box{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}",
      ".ava-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2328)}",
      ".ava-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8b93a1)}",
      ".ava-input{border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);height:34px;font:inherit;color:var(--dsw-alias-label-primary,#1f2328);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:280px;max-width:100%;box-sizing:border-box}",
      ".ava-input:focus-visible{border-color:var(--dsw-alias-brand-primary,#4f6ef7);outline:none}",
      ".ava-seg{display:inline-flex;flex-shrink:0;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:8px;padding:2px;gap:2px}",
      ".ava-seg-btn{font:inherit;font-size:12px;line-height:18px;padding:3px 10px;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer}",
      ".ava-seg-on{background:var(--dsw-alias-bg-layer-2,#eef0f4);color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}",
      ".ava-actions{border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
      ".ava-status-msg{font-size:12px;line-height:18px;margin-right:auto}",
      ".ava-ok{color:var(--dsw-alias-state-success-primary,#16a34a)}",
      ".ava-err{color:var(--dsw-alias-state-error-primary,#dc2626)}",
      ".ava-secret{position:relative}",
      ".ava-secret-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--dsw-alias-label-tertiary,#8b93a1);font-size:12px;padding:2px 4px}",
      ".ava-section-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);text-transform:uppercase;letter-spacing:0.5px;padding:16px 0 4px;margin:0}",
      ".ava-section-title:first-child{padding-top:4px}",
      /* Progress panel */
      ".ava-progress{margin-top:12px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-layer-1,#fff)}",
      ".ava-progress-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}",
      ".ava-progress-title{font-size:13px;font-weight:600;flex:1;min-width:0}",
      ".ava-progress-bar-wrap{height:4px;background:var(--dsw-alias-border-l1,#e5e7eb);border-radius:99px;overflow:hidden;flex:1;max-width:200px}",
      ".ava-progress-bar{height:100%;background:var(--dsw-alias-brand-primary,#4f6ef7);border-radius:99px;transition:width .3s ease}",
      ".ava-progress-pct{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);min-width:36px;text-align:right;font-variant-numeric:tabular-nums}",
      ".ava-progress-body{max-height:260px;overflow-y:auto;padding:0}",
      ".ava-log-line{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:12px;line-height:18px;border-bottom:1px solid var(--dsw-alias-border-l2,#f0f1f3)}",
      ".ava-log-line:last-child{border-bottom:none}",
      ".ava-log-icon{flex-shrink:0;width:16px;text-align:center;font-size:13px}",
      ".ava-log-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#1f2328)}",
      ".ava-log-meta{flex-shrink:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b93a1)}",
      ".ava-phase-line{padding:8px 14px;font-size:12px;font-weight:600;color:var(--dsw-alias-brand-primary,#4f6ef7);background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-bottom:1px solid var(--dsw-alias-border-l2,#e5e7eb)}",
      ".ava-summary{padding:10px 14px;font-size:12px;line-height:18px;background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-top:1px solid var(--dsw-alias-border-l2,#e5e7eb);display:flex;flex-wrap:wrap;gap:12px}",
      ".ava-summary-item{display:inline-flex;align-items:center;gap:4px}",
      ".ava-spin{display:inline-block;width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2,#e5e7eb);border-top-color:var(--dsw-alias-brand-primary,#4f6ef7);border-radius:50%;animation:ava-spin .6s linear infinite}",
      "@keyframes ava-spin{to{transform:rotate(360deg)}}",
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
      nav: "Auth Analyzer", cardDesc: "Vue 3 按钮-权限-API 映射分析器配置",
      sectionBasic: "基础配置", sectionAI: "AI 补全配置", sectionRun: "运行分析",
      viewsDir: "页面目录", viewsDirHint: "Vue 页面文件所在目录（相对于项目根目录）",
      authDirective: "权限指令名", authDirectiveHint: 'v-auth 中的 "auth"，若用 v-permission 则填 "permission"',
      i18nFile: "i18n 翻译文件", i18nFileHint: "中文翻译文件路径，留空跳过 i18n 解析",
      excludePatterns: "排除模式", excludePatternsHint: "逗号分隔的 glob 模式，匹配的目录不参与扫描",
      aiEnabled: "AI 补全", aiEnabledHint: "对静态分析未覆盖的按钮调用 LLM 补全映射",
      aiModel: "模型", aiModelHint: "LLM 模型名称",
      aiBaseUrl: "API 地址", aiBaseUrlHint: "OpenAI 兼容 API 的 Base URL",
      aiApiKey: "API Key", aiApiKeyHint: "LLM API Key，留空则从 ~/.dsh/.credentials.yaml 自动读取",
      save: "保存", saved: "✓ 已保存", saving: "保存中…",
      on: "开", off: "关", showKey: "显示", hideKey: "隐藏",
      runFull: "完整分析", runStatic: "仅静态分析", cancel: "取消", retry: "重试",
      running: "分析中…", idle: "就绪", cancelled: "已取消",
      phaseStatic: "静态分析", phaseAI: "AI 补全", phaseMerge: "合并结果",
      cacheHit: "缓存命中", analyzing: "分析中", done: "完成", failed: "失败",
      total: "总计", high: "高置信", medium: "中置信", low: "低置信",
      llmCalls: "LLM 调用", cacheHits: "缓存命中",
      cwdLabel: "项目路径", cwdHint: "分析的目标项目根目录（绝对路径）",
    };
    const en = {
      nav: "Auth Analyzer", cardDesc: "Vue 3 button-permission-API mapping analyzer configuration",
      sectionBasic: "Basic", sectionAI: "AI Completion", sectionRun: "Run Analysis",
      viewsDir: "Views Directory", viewsDirHint: "Vue pages directory relative to project root",
      authDirective: "Auth Directive", authDirectiveHint: 'The name in v-auth; use "permission" for v-permission',
      i18nFile: "i18n File", i18nFileHint: "Path to i18n translation file; leave empty to skip",
      excludePatterns: "Exclude Patterns", excludePatternsHint: "Comma-separated glob patterns to exclude",
      aiEnabled: "AI Completion", aiEnabledHint: "Use LLM to complete mappings for unmatched buttons",
      aiModel: "Model", aiModelHint: "LLM model name",
      aiBaseUrl: "API Base URL", aiBaseUrlHint: "OpenAI-compatible API base URL",
      aiApiKey: "API Key", aiApiKeyHint: "LLM API key; leave empty to auto-detect from credentials",
      save: "Save", saved: "✓ Saved", saving: "Saving…",
      on: "On", off: "Off", showKey: "Show", hideKey: "Hide",
      runFull: "Full Analysis", runStatic: "Static Only", cancel: "Cancel", retry: "Retry",
      running: "Running…", idle: "Ready", cancelled: "Cancelled",
      phaseStatic: "Static Analysis", phaseAI: "AI Completion", phaseMerge: "Merge Results",
      cacheHit: "Cache hit", analyzing: "Analyzing", done: "Done", failed: "Failed",
      total: "Total", high: "High", medium: "Medium", low: "Low",
      llmCalls: "LLM Calls", cacheHits: "Cache Hits",
      cwdLabel: "Project Path", cwdHint: "Absolute path to the project root to analyze",
    };

    const NS = "dsh-vue-auth-analyzer";
    const DEFAULTS = {
      viewsDir: "src/views", authDirectiveName: "auth",
      i18nFile: "src/lang/package/zh-cn.ts",
      excludePatterns: "**/components/**,**/login/**,**/profile/**",
      aiEnabled: true, aiModel: "qwen3.7-max",
      aiBaseUrl: "https://llm-ad4bzaba67piv4fj.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      aiApiKey: "",
    };

    // ─── AnalyzerCard ───────────────────────────────────────
    function AnalyzerCard(props) {
      var t = props.t;
      var h = react.createElement;

      var _s1 = react.useState(false), open = _s1[0], setOpen = _s1[1];
      var _s2 = react.useState(null), settings = _s2[0], setSettings = _s2[1];
      var _s3 = react.useState("idle"), saveState = _s3[0], setSaveState = _s3[1];
      var _s4 = react.useState({}), drafts = _s4[0], setDrafts = _s4[1];
      var _s5 = react.useState(false), showKey = _s5[0], setShowKey = _s5[1];

      // Run state
      var _s6 = react.useState(null), runState = _s6[0], setRunState = _s6[1];
      // null = idle, {phase, logs[], current, total, stats, status, abortController}
      var logEndRef = react.useRef(null);

      react.useEffect(function() {
        if (!open || settings !== null) return;
        var live = true;
        (async function() {
          try {
            var res = await fetch("/api/settings/" + NS);
            if (res.ok) { var body = await res.json(); if (live) setSettings(body.value || body); }
            else { if (live) setSettings({}); }
          } catch(e) { if (live) setSettings({}); }
        })();
        return function() { live = false; };
      }, [open]);

      // Auto-scroll log
      react.useEffect(function() {
        if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
      }, [runState && runState.logs ? runState.logs.length : 0]);

      var current = function(key) {
        if (drafts[key] !== undefined) return drafts[key];
        if (settings && settings[key] !== undefined) return settings[key];
        return DEFAULTS[key];
      };
      var setDraft = function(key, value) {
        setDrafts(function(prev) { var n = Object.assign({}, prev); n[key] = value; return n; });
      };
      var hasChanges = Object.keys(drafts).length > 0;

      var onSave = async function() {
        if (!hasChanges) return;
        setSaveState("saving");
        try {
          var res = await fetch("/api/settings/" + NS, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify(drafts),
          });
          if (res.ok) {
            setSettings(function(p) { return Object.assign({}, p || {}, drafts); });
            setDrafts({}); setSaveState("saved");
            setTimeout(function() { setSaveState("idle"); }, 2000);
          } else { setSaveState("idle"); }
        } catch(e) { setSaveState("idle"); }
      };

      var startRun = async function(staticOnly) {
        var ac = new AbortController();
        setRunState({ phase: "starting", logs: [], current: 0, total: 0, stats: null, status: "running", abortController: ac });
        try {
          var res = await fetch("/dsh-vue-auth-analyzer/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ staticOnly: !!staticOnly, cwd: current("cwd") || undefined }),
            signal: ac.signal,
          });
          if (!res.ok) {
            setRunState(function(s) { return Object.assign({}, s, { status: "error", logs: s.logs.concat([{ type: "error", message: "HTTP " + res.status }]) }); });
            return;
          }
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buffer = "";
          while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            var lines = buffer.split("\n");
            buffer = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line) continue;
              try {
                var evt = JSON.parse(line);
                setRunState(function(s) {
                  var next = Object.assign({}, s);
                  next.logs = s.logs.concat([evt]);
                  if (evt.type === "phase") next.phase = evt.label;
                  if (evt.type === "ai-start") { next.total = evt.total; next.current = 0; }
                  if (evt.type === "ai-progress") { next.current = evt.current; next.total = evt.total; }
                  if (evt.type === "ai-done") next.stats = evt.stats;
                  if (evt.type === "done") next.status = "done";
                  if (evt.type === "cancelled") next.status = "cancelled";
                  if (evt.type === "exit") {
                    if (next.status === "running") next.status = evt.code === 0 ? "done" : "error";
                  }
                  if (evt.type === "error") next.status = "error";
                  return next;
                });
              } catch(e) { /* skip non-JSON lines */ }
            }
          }
        } catch(e) {
          if (e.name !== "AbortError") {
            setRunState(function(s) { return Object.assign({}, s, { status: "error", logs: s.logs.concat([{ type: "error", message: e.message }]) }); });
          }
        }
      };

      var cancelRun = async function() {
        if (runState && runState.abortController) {
          runState.abortController.abort();
        }
        try { await fetch("/dsh-vue-auth-analyzer/cancel", { method: "POST" }); } catch {}
        setRunState(function(s) { return s ? Object.assign({}, s, { status: "cancelled" }) : s; });
      };

      var isRunning = runState && runState.status === "running";
      var pct = runState && runState.total > 0 ? Math.round((runState.current / runState.total) * 100) : 0;

      var IconChevronDown = primitives.IconChevronDownOutline14 || primitives.IconSettingsOutline14;
      var Button = primitives.Button;

      var row = function(label, hint, control) {
        return h("div", { className: "ava-row" },
          h("div", { className: "ava-label-box" },
            h("div", { className: "ava-label" }, label),
            h("div", { className: "ava-hint" }, hint)),
          control);
      };
      var textInput = function(key, ph) {
        return h("input", { className: "ava-input", type: "text", value: current(key) || "", placeholder: ph || "",
          onChange: function(e) { setDraft(key, e.target.value); } });
      };
      var secretInput = function(key, ph) {
        return h("div", { className: "ava-secret" },
          h("input", { className: "ava-input", type: showKey ? "text" : "password", value: current(key) || "", placeholder: ph || "",
            onChange: function(e) { setDraft(key, e.target.value); } }),
          h("button", { type: "button", className: "ava-secret-toggle", onClick: function() { setShowKey(!showKey); } },
            showKey ? t("hideKey") : t("showKey")));
      };
      var sectionTitle = function(text) { return h("div", { className: "ava-section-title" }, text); };

      var statusIcon = function(status) {
        if (status === "analyzing") return h("span", { className: "ava-spin" });
        if (status === "cache-hit") return "💾";
        if (status === "done") return "✅";
        if (status === "failed") return "❌";
        return "⏳";
      };

      var renderProgress = function() {
        if (!runState) return null;
        var logs = runState.logs || [];
        return h("div", { className: "ava-progress" },
          h("div", { className: "ava-progress-head" },
            h("div", { className: "ava-progress-title" },
              runState.status === "running" ? (runState.phase || t("running")) :
              runState.status === "done" ? "✅ " + t("done") :
              runState.status === "cancelled" ? "⏹ " + t("cancelled") :
              "❌ Error"
            ),
            runState.total > 0 ? h("div", { className: "ava-progress-bar-wrap" },
              h("div", { className: "ava-progress-bar", style: { width: pct + "%" } })) : null,
            runState.total > 0 ? h("div", { className: "ava-progress-pct" }, runState.current + "/" + runState.total) : null,
            isRunning ? h(Button, { variant: "outline", size: "sm", onClick: cancelRun }, t("cancel")) : null,
            !isRunning && runState.status !== "idle" ? h(Button, { variant: "outline", size: "sm", onClick: function() { setRunState(null); } }, "✕") : null
          ),
          h("div", { className: "ava-progress-body" },
            logs.map(function(log, idx) {
              if (log.type === "phase") return h("div", { key: idx, className: "ava-phase-line" }, "▸ " + log.label);
              if (log.type === "ai-progress") {
                return h("div", { key: idx, className: "ava-log-line" },
                  h("span", { className: "ava-log-icon" }, statusIcon(log.status)),
                  h("span", { className: "ava-log-text" }, "[" + log.current + "/" + log.total + "] " + log.page + " — " + log.auth),
                  h("span", { className: "ava-log-meta" }, log.name || ""));
              }
              if (log.type === "ai-done" && log.stats) {
                var s = log.stats;
                return h("div", { key: idx, className: "ava-summary" },
                  h("span", { className: "ava-summary-item" }, "📊 " + t("total") + ": " + s.total),
                  h("span", { className: "ava-summary-item ava-ok" }, "🟢 " + s.highConfidence),
                  h("span", { className: "ava-summary-item" }, "🟡 " + s.mediumConfidence),
                  h("span", { className: "ava-summary-item" }, "🔴 " + s.lowConfidence),
                  h("span", { className: "ava-summary-item ava-err" }, "❌ " + s.failed),
                  h("span", { className: "ava-summary-item" }, "💾 " + s.cacheHits + " / 🤖 " + s.llmCalls));
              }
              if (log.type === "stderr") return h("div", { key: idx, className: "ava-log-line" }, h("span", { className: "ava-log-icon" }, "⚠️"), h("span", { className: "ava-log-text ava-err" }, log.message));
              if (log.type === "error") return h("div", { key: idx, className: "ava-log-line" }, h("span", { className: "ava-log-icon" }, "❌"), h("span", { className: "ava-log-text ava-err" }, log.message));
              if (log.type === "exit") return h("div", { key: idx, className: "ava-log-line" }, h("span", { className: "ava-log-icon" }, log.code === 0 ? "✅" : "❌"), h("span", { className: "ava-log-text" }, "Exit code: " + log.code));
              return null;
            }),
            h("div", { ref: logEndRef })
          )
        );
      };

      var body = open ? h("div", { className: "ava-body" },
        sectionTitle(t("sectionBasic")),
        row(t("viewsDir"), t("viewsDirHint"), textInput("viewsDir", "src/views")),
        row(t("authDirective"), t("authDirectiveHint"), textInput("authDirectiveName", "auth")),
        row(t("i18nFile"), t("i18nFileHint"), textInput("i18nFile", "src/lang/package/zh-cn.ts")),
        row(t("excludePatterns"), t("excludePatternsHint"), textInput("excludePatterns", "**/components/**,**/login/**")),
        row(t("cwdLabel"), t("cwdHint"), textInput("cwd", "/path/to/project")),

        sectionTitle(t("sectionAI")),
        row(t("aiEnabled"), t("aiEnabledHint"),
          h("div", { className: "ava-seg" },
            h("button", { type: "button", className: "ava-seg-btn" + (current("aiEnabled") !== false ? " ava-seg-on" : ""), onClick: function() { setDraft("aiEnabled", true); } }, t("on")),
            h("button", { type: "button", className: "ava-seg-btn" + (current("aiEnabled") === false ? " ava-seg-on" : ""), onClick: function() { setDraft("aiEnabled", false); } }, t("off")))),
        row(t("aiModel"), t("aiModelHint"), textInput("aiModel", "qwen3.7-max")),
        row(t("aiBaseUrl"), t("aiBaseUrlHint"), textInput("aiBaseUrl", "https://...")),
        row(t("aiApiKey"), t("aiApiKeyHint"), secretInput("aiApiKey", "sk-...")),

        hasChanges ? h("div", { className: "ava-actions" },
          h("span", { className: "ava-status-msg" + (saveState === "saved" ? " ava-ok" : "") },
            saveState === "saved" ? t("saved") : saveState === "saving" ? t("saving") : ""),
          h(Button, { variant: "primary", size: "sm", disabled: saveState === "saving", onClick: onSave }, t("save"))
        ) : null,

        sectionTitle(t("sectionRun")),
        h("div", { className: "ava-row", style: { gap: "8px" } },
          h(Button, { variant: "primary", size: "sm", disabled: isRunning, onClick: function() { startRun(false); } },
            isRunning ? t("running") : t("runFull")),
          h(Button, { variant: "outline", size: "sm", disabled: isRunning, onClick: function() { startRun(true); } },
            t("runStatic")),
          runState && runState.status !== "running" && runState.status !== "idle" && runState.status !== null
            ? h(Button, { variant: "outline", size: "sm", onClick: function() { startRun(false); } }, t("retry"))
            : null
        ),
        renderProgress()
      ) : null;

      return h("div", { className: "ava-card" + (open ? " ava-open" : "") },
        h("button", { type: "button", className: "ava-header", "aria-expanded": open, onClick: function() { setOpen(!open); } },
          h("div", { className: "ava-head-text" },
            h("div", { className: "ava-name" }, t("nav")),
            h("div", { className: "ava-desc" }, t("cardDesc"))),
          h("span", { className: "ava-chevron" + (open ? " ava-chevron-open" : "") },
            h(IconChevronDown, { size: 14 }))),
        body);
    }

    // ─── Plugin entry ───────────────────────────────────────
    var name = "dsh-vue-auth-analyzer";
    var inject = ["slots", "locale"];

    function apply(ctx) {
      ctx.locale.register(NS, { zh: zh, en: en });
      var t = ctx.locale.bind(NS);
      ctx.inject(["settingsScope"], function(scoped) {
        scoped.slots.inject("settings.plugin.item", function() {
          return scoped.slots.register({
            name: "settings.plugin.item", key: NS, locale: NS,
            inject: function() { return { t: t }; },
          }, function() { return react.createElement(AnalyzerCard, { t: t }); });
        });
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
