"use strict";
/* Power BI Visual Builder (offline) - page wiring. Uses only DOM APIs, the clipboard and the File System Access API. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else e.setAttribute(k, v === true ? "" : String(v));
    }
    for (const k of kids) if (k !== null && k !== undefined) e.append(k);
    return e;
  }
  const debounce = (fn, ms = 120) => { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; };
  const fileName = (n, ext) => `${String(n).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "output"}${ext}`;
  const ver = (url) => (/visualContainer\/(\d+\.\d+\.\d+)\//.exec(url) || [])[1] || url;
  const SCHEMA_VERSIONS = ["2.13.0", "2.12.0", "2.11.0", "2.10.0", "2.9.0"];
  const DEFAULT_SCHEMA = "2.9.0";

  // ---------------------------------------------------------------- clipboard and downloads
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
    const ta = el("textarea", { class: "offscreen", readonly: true, "aria-hidden": "true" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
  function download(name, text) {
    const type = name.endsWith(".json") ? "application/json" : "text/plain";
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------------------------------------------------------------- output boxes
  const outputs = new Map();
  function initOut(box) {
    const badge = box.dataset.noscan === "true" ? null : el("span", { class: "badge" });   // shell commands are not report files
    const head = el("div", { class: "out-head" }, el("span", { class: "out-title", text: box.dataset.title }), badge);
    const state = { text: "", file: box.dataset.file, badge, box, write: null, code: el("code") };
    if (box.dataset.collapsed === "true") {
      box.classList.add("collapsed");
      const toggle = el("button", { type: "button", class: "btn small ghost", "aria-expanded": "false", text: "Show" });
      toggle.addEventListener("click", () => {
        const open = !box.classList.toggle("collapsed");
        toggle.textContent = open ? "Hide" : "Show";
        toggle.setAttribute("aria-expanded", String(open));
      });
      head.append(toggle);
    }
    if (box.dataset.write) {
      state.write = el("button", { type: "button", class: "btn small", text: "Add to page", disabled: true, title: "Open a PBIP folder first" });
      state.write.addEventListener("click", () => addToPage(box.dataset.write));
      head.append(state.write);
    }
    const copy = el("button", { type: "button", class: "btn small", text: "Copy" });
    copy.addEventListener("click", async () => {
      const ok = await copyText(state.text);
      copy.textContent = ok ? "Copied" : "Copy failed";
      setTimeout(() => { copy.textContent = "Copy"; }, 1500);
    });
    const dl = el("button", { type: "button", class: "btn small ghost", text: "Download" });
    dl.addEventListener("click", () => download(state.file, state.text));
    head.append(copy, dl);
    box.append(head, el("pre", { tabindex: "0" }, state.code));
    outputs.set(box.id, state);
  }
  function setOut(id, text, file) {
    const s = outputs.get(id);
    s.text = text;
    if (file) s.file = file;
    s.code.textContent = text;
    s.box.classList.remove("stale");
    if (!s.badge) return;
    const hits = PBI.scanText(text, s.file);
    s.badge.className = `badge ${hits.length ? "bad" : "ok"}`;
    s.badge.textContent = hits.length ? `Scan: ${hits.length} issue${hits.length > 1 ? "s" : ""}` : "Scan: clean";
    s.badge.title = hits.length ? hits.map((h) => `line ${h.line}: ${h.rule}`).join("\n") : "No external URLs, scripts or other unsafe content";
  }
  const stale = (...ids) => ids.forEach((id) => outputs.get(id).box.classList.add("stale"));
  function steps(listId, items) { $(listId).replaceChildren(...items.map((t) => el("li", { text: t }))); }
  function showError(form, e) {
    const p = $(".error", form);
    p.hidden = !e;
    p.textContent = !e ? "" : e instanceof PBI.InputError ? e.message : `Something went wrong: ${e.message}`;
  }

  // ---------------------------------------------------------------- form helpers
  function values(root) {
    const o = {};
    for (const i of $$("input, select, textarea", root)) {
      if (!i.name) continue;
      const key = i.name.split(".").pop();
      if (i.type === "checkbox") o[key] = i.checked;
      else if (i.type === "radio") { if (i.checked) o[key] = i.value; }
      else o[key] = i.value;
    }
    return o;
  }
  function fill(form, prefix, vals) {
    for (const [k, v] of Object.entries(vals)) {
      const i = form.elements[prefix ? `${prefix}.${k}` : k];
      if (!i || i instanceof RadioNodeList) continue;
      if (i.type === "checkbox") i.checked = !!v; else i.value = String(v);
    }
  }
  function options(select, items, selected) {
    select.replaceChildren(...items.map(([value, label]) => el("option", { value, text: label })));
    if (selected !== undefined) select.value = selected;
  }
  function size(v) {
    const w = Number(v.width), h = Number(v.height);
    if (!Number.isInteger(w) || w < 80 || w > 1920 || !Number.isInteger(h) || h < 80 || h > 1080) {
      throw new PBI.InputError("Size: width 80–1920 and height 80–1080 pixels, whole numbers.");
    }
    return { w, h };
  }
  function live(form, render) {
    form.addEventListener("input", debounce(render));
    form.addEventListener("change", render);
    form.addEventListener("submit", (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- tabs
  const tabs = $$('[role="tab"]');
  function showTab(id, focus) {
    for (const t of tabs) {
      const on = t.id === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute("aria-controls")}`).hidden = !on;
      if (on && focus) t.focus();
    }
    $("#project").hidden = !(id === "tab-deneb" || id === "tab-native");
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => showTab(t.id));
    t.addEventListener("keydown", (e) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (k === undefined) return;
      e.preventDefault();
      showTab(tabs[(k + tabs.length) % tabs.length].id, true);
    });
  });

  // ---------------------------------------------------------------- recommend
  const fRec = $("#f-recommend");
  options(fRec.elements.task, Object.entries(PBI.TASKS), "compare");
  options(fRec.elements.place, Object.entries(PBI.PLACES), "standalone");
  function renderRecommend() {
    const r = PBI.recommend(values(fRec));
    const out = $("#recommend-out");
    out.replaceChildren(...[
      el("span", { class: "rung", text: `Level ${r.rung} of 6 · ${r.technology}` }),
      el("p", { class: "chart", text: r.chart }),
      el("p", { text: r.why }),
      r.notes.length ? el("ul", {}, ...r.notes.map((n) => el("li", { text: n }))) : null,
      el("p", { class: "avoid", text: `Avoid: ${r.avoid}.` }),
    ].filter(Boolean));                                         // replaceChildren would print "null"
    if (r.generator) {
      const b = el("button", { type: "button", class: "btn", text: "Open the generator" });
      b.addEventListener("click", () => openGenerator(r.generator));
      out.append(b);
    } else {
      out.append(el("p", { class: "hint", text: "Build this one directly in Power BI Desktop; no code is needed." }));
    }
    out.append(el("p", { class: "hint", text: "Lower levels are quicker to build, work on mobile and export, and are easier for others to maintain." }));
  }
  live(fRec, renderRecommend);

  // ---------------------------------------------------------------- SVG measures
  const fSvg = $("#f-svg");
  for (const k of ["bullet", "progress", "sparkline", "status"]) fill(fSvg, k, PBI.DEFAULTS[k]);
  const SVG_GEN = { bullet: PBI.svgBullet, progress: PBI.svgProgress, sparkline: PBI.svgSparkline, status: PBI.svgStatus };
  function svgSteps(tpl, v) {
    const dataCategory = "With the measure selected: Measure tools > Data category > Image URL. Without this the text shows instead of the picture.";
    const len = `Check the longest result in DAX query view with LEN ( [${v.name}] ): it must stay well under 32,000 characters.`;
    const add = `In Power BI Desktop: Modeling > New measure, then paste the DAX (measure "${v.name}").`;
    switch (tpl) {
      case "bullet": return [add, dataCategory,
        `Add a table or matrix with ${v.row} on rows and the measure in Values. Keep the actual number in the next column so it stays readable and sortable.`,
        `Format > Image size: height 24, width ${v.width}.`, "The bar is green at or above target and red below; the dark tick is the target.", len];
      case "progress": return [add, dataCategory, "Put it in a table, matrix, new card or image visual.",
        `Image size: height 20, width ${Number(v.barWidth) + 44}.`, len];
      case "sparkline": return [add, dataCategory,
        `${v.dateTable} must be marked as the date table and have a ${v.monthColumn} column (first day of each month).`,
        `Put it in a table or matrix row, or in a new card's image. Image size: height ${v.height}, width ${v.width}.`,
        "Each line uses its own min-max scale; the dot marks the latest month. Keep the number in an adjacent column.", len];
      case "status": return [add, dataCategory, "Put it in a table or matrix next to the numbers. Image size: height 22, width 84.",
        "The pill shows the status as text, so it never relies on colour alone.", len];
      default: return ["Paste it into DAX query view and run it: the result shows the escaped text.",
        "Then add the function to the model (from DAX query view, or in a PBIP project in functions.tmdl). DAX user-defined functions need compatibility level 1702 or later.",
        "Wrap every piece of text from data that goes into an SVG measure, for example SvgEscapeText ( 'Product'[Name] )."];
    }
  }
  function renderSvg() {
    const tpl = fSvg.elements.template.value;
    for (const n of $$("[data-for]", fSvg)) n.hidden = n.dataset.for !== tpl;
    try {
      if (tpl === "udf") {
        setOut("o-svg", PBI.SVG_ESCAPE_UDF, "SvgEscapeText.dax");
        steps("#steps-svg", svgSteps(tpl, {}));
      } else {
        const v = values($(`fieldset[data-for="${tpl}"]`, fSvg));
        setOut("o-svg", SVG_GEN[tpl](v), fileName(v.name, ".dax"));
        steps("#steps-svg", svgSteps(tpl, v));
      }
      showError(fSvg, null);
    } catch (e) { showError(fSvg, e); stale("o-svg"); }
  }
  live(fSvg, renderSvg);

  // ---------------------------------------------------------------- Deneb
  const fDeneb = $("#f-deneb");
  const formatOptions = PBI.NUMBER_FORMATS.map((f) => [f, f]);
  options(fDeneb.elements.format, formatOptions, "#,0");
  options(fDeneb.elements.schema, SCHEMA_VERSIONS.map((v) => [v, `visualContainer ${v}`]), DEFAULT_SCHEMA);
  fill(fDeneb, "", { category: PBI.DEFAULTS.lollipop.category, value: PBI.DEFAULTS.lollipop.value,
                     actual: PBI.DEFAULTS.variance.actual, prior: PBI.DEFAULTS.variance.prior });
  const denebName = PBI.randomHex(20);
  const templateMeta = { uuid: null, generated: new Date().toISOString() };
  function renderDeneb() {
    const v = values(fDeneb);
    for (const n of $$("[data-for]", fDeneb)) n.hidden = n.dataset.for !== v.chart;
    try {
      const chart = PBI.denebChart(v.chart, v);
      const sz = size(v);
      templateMeta.uuid = templateMeta.uuid || PBI.denebTemplate(v.chart, v).usermeta.information.uuid;
      setOut("o-deneb-spec", PBI.pretty(chart.spec));
      setOut("o-deneb-config", PBI.pretty(chart.config));
      setOut("o-deneb-template", PBI.pretty(PBI.denebTemplate(v.chart, v, templateMeta)), `deneb-template-${v.chart}.json`);
      setOut("o-deneb-visual", PBI.pretty(PBI.denebVisual(chart, { schemaUrl: PBI.schemaUrl(v.schema), name: denebName,
        x: 24, y: 96, z: 1000, tab: 1000, w: sz.w, h: sz.h })));
      const fields = chart.projections.map((p) => `${p.queryRef.split(".")[0]}[${p.nativeQueryRef}]`).join(", ");
      steps("#steps-deneb", [
        `Add the certified Deneb visual to the page (from AppSource or your organizational store) and put ${fields} in its Values well. Don't rename them in the well: the spec uses these names (${chart.fields.join(", ")}).`,
        "Select Edit, create a new Vega-Lite specification, then paste the Specification and, on the Config tab, the Config.",
        `In Deneb's settings, set tooltips ${v.tooltips ? "on" : "off"}, cross-filtering ${v.selection ? "on" : "off"} and cross-highlighting ${v.highlight ? "on" : "off"} to match.`,
        "To share the chart without your field names, download the template; others import it in Deneb (Existing template) and map their own fields.",
        "Or write it straight into your PBIP project with Add to page (Desktop closed). That also registers Deneb in report.json the first time, after backing it up.",
      ]);
      showError(fDeneb, null);
    } catch (e) { showError(fDeneb, e); stale("o-deneb-spec", "o-deneb-config", "o-deneb-template", "o-deneb-visual"); }
  }
  live(fDeneb, renderDeneb);

  // ---------------------------------------------------------------- native visual
  const fNative = $("#f-native");
  options(fNative.elements.visualType, Object.entries(PBI.NATIVE_TYPES).map(([k, v]) => [k, v.label]), "clusteredBarChart");
  options(fNative.elements.schema, SCHEMA_VERSIONS.map((v) => [v, `visualContainer ${v}`]), DEFAULT_SCHEMA);
  fill(fNative, "", {
    category: "Region[Region]", values: "Sales[Sales Amount]", series: "",
    tableColumns: "Region[Region]", tableValues: "Sales[Sales Amount]\nSales[Bullet SVG]",
    rows: "Region[Region]", matrixColumns: "", matrixValues: "Sales[Sales Amount]",
    cardValues: "Sales[Sales Amount]\nSales[Sales Target]", title: "", imageHeight: "", imageWidth: "",
  });
  const nativeName = PBI.randomHex(20);
  function nativeInput(v) {
    const shape = PBI.NATIVE_TYPES[v.visualType].shape;
    const raw = { visualType: v.visualType, title: v.title };
    if (shape === "chart") Object.assign(raw, { category: v.category, values: v.values, series: v.series, sort: v.sort });
    else if (shape === "table") Object.assign(raw, { columns: v.tableColumns, values: v.tableValues, imageHeight: v.imageHeight, imageWidth: v.imageWidth });
    else if (shape === "matrix") Object.assign(raw, { rows: v.rows, columns: v.matrixColumns, values: v.matrixValues, imageHeight: v.imageHeight, imageWidth: v.imageWidth });
    else raw.values = v.cardValues;
    return raw;
  }
  function renderNative() {
    const v = values(fNative);
    const shape = PBI.NATIVE_TYPES[v.visualType].shape;
    for (const n of $$("[data-shape]", fNative)) n.hidden = !n.dataset.shape.split(" ").includes(shape);
    try {
      const spec = PBI.nativeSpec(nativeInput(v));
      const sz = size(v);
      setOut("o-native", PBI.pretty(PBI.nativeVisual(spec, { schemaUrl: PBI.schemaUrl(v.schema), name: nativeName,
        x: 24, y: 96, z: 1000, tab: 1000, w: sz.w, h: sz.h })));
      steps("#steps-native", [
        "Easiest: open your PBIP project above, pick the page and select Add to page. The app finds free space, copies your project's schema version and checks the result.",
        `By hand: close Desktop, create the folder <Report>.Report/definition/pages/<page>/visuals/${nativeName}/ and save the file there as visual.json.`,
        "Reopen the report in Power BI Desktop and check the visual.",
        spec.image ? "SVG measures in this visual need Data category = Image URL." : "Add alt text in Desktop (Format > General > Alt text).",
      ]);
      showError(fNative, null);
    } catch (e) { showError(fNative, e); stale("o-native"); }
  }
  fNative.elements.visualType.addEventListener("change", () => {
    const t = fNative.elements.visualType.value;
    fNative.elements.sort.value = t === "lineChart" || t === "areaChart" ? "none" : "value";
  });
  live(fNative, renderNative);

  // ---------------------------------------------------------------- HTML Content Secure and Python
  const fHtml = $("#f-htmlpy");
  fill(fHtml, "html", PBI.DEFAULTS.html);
  fill(fHtml, "python", PBI.DEFAULTS.python);
  options(fHtml.elements["html.format"], formatOptions, "#,0");
  function renderHtmlPy() {
    const kind = fHtml.elements.kind.value;
    for (const n of $$("[data-for]", fHtml)) n.hidden = n.dataset.for !== kind;
    try {
      const v = values($(`fieldset[data-for="${kind}"]`, fHtml));
      if (kind === "html") {
        setOut("o-htmlpy", PBI.htmlKpiTile(v), fileName(v.name, ".dax"));
        steps("#steps-htmlpy", [
          `Modeling > New measure, paste the DAX (measure "${v.name}").`,
          "Add the certified HTML Content Secure visual (not the non-certified HTML Content) and put the measure in its field well.",
          "Data text is escaped in the measure, and HTML Content Secure removes scripts, external images and remote styles anyway.",
        ]);
      } else {
        setOut("o-htmlpy", PBI.pythonBoxplot(v), "python-visual.py");
        steps("#steps-htmlpy", [
          "Only if Python visuals are allowed in your tenant: they run code on your PC and show a static image.",
          `Add a Python visual, then put ${v.category} and ${v.value} in its Values well.`,
          "Paste the script into the Python script editor and run it. Limits: 150,000 rows, 5-minute run time, no support in embedded reports.",
        ]);
      }
      showError(fHtml, null);
    } catch (e) { showError(fHtml, e); stale("o-htmlpy"); }
  }
  live(fHtml, renderHtmlPy);

  // ---------------------------------------------------------------- recommend -> generator
  function openGenerator(g) {
    const [area, what] = g.split(":");
    if (area === "svg") { fSvg.elements.template.value = what; renderSvg(); showTab("tab-svg", true); }
    else if (area === "deneb") { fDeneb.elements.chart.value = what; renderDeneb(); showTab("tab-deneb", true); }
    else if (area === "native") {
      fNative.elements.visualType.value = what;
      fNative.elements.visualType.dispatchEvent(new Event("change"));
      renderNative(); showTab("tab-native", true);
    }
    else if (area === "html" || area === "python") { fHtml.elements.kind.value = area; renderHtmlPy(); showTab("tab-htmlpy", true); }
    else if (area === "sdk") showTab("tab-sdk", true);
  }

  // ---------------------------------------------------------------- PBIP project
  const project = { root: null, reports: [], report: null, info: null, last: null };
  const supportsFS = typeof window.showDirectoryPicker === "function";
  if (!supportsFS) { $("#project-unsupported").hidden = false; $("#project-open").disabled = true; }
  function status(msg, kind = "") { const s = $("#project-status"); s.textContent = msg; s.className = `status ${kind}`; }
  const confirmed = () => $("#confirm-desktop").checked && $("#confirm-backup").checked;
  function updateWriteButtons() {
    const ready = !!(project.root && project.info && project.info.pages.length && confirmed());
    for (const s of outputs.values()) {
      if (!s.write) continue;
      s.write.disabled = !ready;
      s.write.title = ready ? "Write this visual into the selected page" : project.root ? "Tick both confirmations first" : "Open a PBIP folder first";
    }
  }
  async function openProject() {
    let root;
    try { root = await window.showDirectoryPicker({ id: "pbip-project", mode: "readwrite" }); }
    catch (e) { if (e.name !== "AbortError") status(`Could not open the folder: ${e.message}`, "bad"); return; }
    status("Reading the project…");
    try {
      const reports = await PBI.findReports(root);
      if (!reports.length) { status("No .Report folder here. Pick the folder that contains your .pbip file.", "bad"); return; }
      Object.assign(project, { root, reports, last: null });
      $("#project-result").hidden = true;
      options($("#project-report"), reports.map((r) => [r.name, r.format === "pbir" ? r.name : `${r.name} (not PBIR)`]));
      $("#project-body").hidden = false;
      await loadSelectedReport(false);
    } catch (e) { status(`Could not read the folder: ${e.message}`, "bad"); }
  }
  async function loadSelectedReport(keepPage) {
    const r = project.reports.find((x) => x.name === $("#project-report").value);
    const pageSel = $("#project-page");
    const previous = keepPage ? pageSel.value : null;
    project.report = r;
    project.info = null;
    if (!r || r.format !== "pbir") {
      pageSel.replaceChildren();
      $("#project-schema").textContent = "";
      status("This report is not saved in the PBIR format. In Power BI Desktop, save it as PBIR first.", "bad");
      updateWriteButtons();
      return;
    }
    const info = await PBI.loadReport(r);
    project.info = info;
    options(pageSel, info.pages.map((p) => [p.id, `${p.displayName} (${p.width}×${p.height}, ${p.visuals.length} visual${p.visuals.length === 1 ? "" : "s"})${p.listed ? "" : " (hidden: not in pages.json)"}`]));
    if (previous && info.pages.some((p) => p.id === previous)) pageSel.value = previous;
    const parts = [info.visualSchema ? `New visuals copy this project's schema: visualContainer ${ver(info.visualSchema)}.` : "No visuals yet: new visuals use the schema version in PBIR options."];
    if (info.denebType) parts.push("Deneb is already registered in this report.");
    $("#project-schema").textContent = parts.join(" ");
    status(info.pages.length ? `Opened ${r.name}.` : `${r.name} has no pages.`, info.pages.length ? "ok" : "bad");
    updateWriteButtons();
  }
  async function addToPage(kind) {
    if (!project.root || !project.info || !confirmed()) return;
    const pageId = $("#project-page").value;
    status("Writing…");
    try {
      let summary;
      if (kind === "native") {
        const v = values(fNative);
        const spec = PBI.nativeSpec(nativeInput(v));
        const sz = size(v);
        summary = await PBI.addVisual(project.root, { reportName: project.report.name, pageId, width: sz.w, height: sz.h,
          fallbackSchema: v.schema, build: (o) => PBI.nativeVisual(spec, o) });
      } else {
        const v = values(fDeneb);
        const chart = PBI.denebChart(v.chart, v);
        const sz = size(v);
        summary = await PBI.addVisual(project.root, { reportName: project.report.name, pageId, width: sz.w, height: sz.h,
          fallbackSchema: v.schema, customVisual: PBI.DENEB_GUID, denebSource: v.source, build: (o) => PBI.denebVisual(chart, o) });
      }
      project.last = summary;
      $("#project-result-list").replaceChildren(...[
        el("li", { text: `Added ${summary.path}` }),
        el("li", { text: `Page "${summary.page}": x ${summary.position.x}, y ${summary.position.y}, ${summary.position.w} × ${summary.position.h}${summary.overlaps ? ". No free space was left, so it overlaps other visuals: move it in Desktop." : ""}` }),
        el("li", { text: `Schema visualContainer ${ver(summary.schemaUrl)} (${summary.schemaFrom === "project" ? "copied from your project" : "from PBIR options"})` }),
        summary.reportChanged ? el("li", { text: `Registered Deneb in report.json. Backup: ${summary.backup}` }) : null,
      ].filter(Boolean));
      $("#project-result").hidden = false;
      await loadSelectedReport(true);
      status("Done. Reopen the report in Power BI Desktop to see the visual.", "ok");
    } catch (e) {
      status(e instanceof PBI.InputError ? e.message : `Nothing was written: ${e.message}`, "bad");
    }
  }
  $("#project-open").addEventListener("click", openProject);
  $("#project-report").addEventListener("change", () => loadSelectedReport(false).catch((e) => status(e.message, "bad")));
  $("#confirm-desktop").addEventListener("change", updateWriteButtons);
  $("#confirm-backup").addEventListener("change", updateWriteButtons);
  $("#project-undo").addEventListener("click", async () => {
    if (!project.last) return;
    try {
      await PBI.undoAdd(project.root, project.last);
      const msg = `Undone: the visual was removed${project.last.reportChanged ? " and report.json restored" : ""}.`;
      project.last = null;
      $("#project-result").hidden = true;
      await loadSelectedReport(true);
      status(msg, "ok");                                       // after the reload, which sets its own status
    } catch (e) { status(e.message, "bad"); }
  });

  // ---------------------------------------------------------------- scan
  function renderScan(res, label) {
    const out = $("#scan-out");
    out.replaceChildren();
    if (!res.files) { out.append(el("p", { class: "scan-summary bad", text: `No files to check in ${label}.` })); return; }
    const ok = res.hits.length === 0;
    out.append(el("p", { class: `scan-summary ${ok ? "ok" : "bad"}`,
      text: ok ? `Clean: ${res.files} file${res.files === 1 ? "" : "s"} checked in ${label}.`
               : `${res.hits.length} issue${res.hits.length === 1 ? "" : "s"} in ${res.files} file${res.files === 1 ? "" : "s"} checked in ${label}. Fix each one, or be sure it is safe.` }));
    if (!ok) {
      out.append(el("table", { class: "scan-table" },
        el("thead", {}, el("tr", {}, ...["File", "Line", "Rule", "Match"].map((h) => el("th", { text: h })))),
        el("tbody", {}, ...res.hits.map((h) => el("tr", {}, el("td", { text: h.file }), el("td", { text: String(h.line) }),
          el("td", { text: h.rule }), el("td", { text: h.match })))),
      ));
    }
  }
  async function scanFileList(files, pathOf) {
    const hits = [];
    for (const f of files) hits.push(...PBI.scanText(PBI.decode(new Uint8Array(await f.arrayBuffer())), pathOf(f)));
    return { files: files.length, hits };
  }
  $("#scan-folder").addEventListener("click", async () => {
    if (!supportsFS) { $("#scan-dir-input").click(); return; }
    let dir;
    try { dir = await window.showDirectoryPicker({ id: "scan", mode: "read" }); }
    catch (e) { if (e.name !== "AbortError") renderScan({ files: 0, hits: [] }, e.message); return; }
    renderScan(await PBI.scanFolder(dir), dir.name);
  });
  $("#scan-dir-input").addEventListener("change", async (e) => {
    const all = Array.from(e.target.files);
    const rootName = all.length ? all[0].webkitRelativePath.split("/")[0] : "the folder";
    const files = all.filter((f) => {
      const parts = f.webkitRelativePath.split("/");
      return !parts.slice(1, -1).some((p) => PBI.SKIP_DIRS.has(p)) && PBI.eligible(f.name);
    });
    renderScan(await scanFileList(files, (f) => f.webkitRelativePath.split("/").slice(1).join("/")), rootName);
    e.target.value = "";
  });
  $("#scan-files").addEventListener("click", () => $("#scan-file-input").click());
  $("#scan-file-input").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    renderScan(await scanFileList(files, (f) => f.name), files.length === 1 ? files[0].name : "the selected files");
    e.target.value = "";
  });

  // ---------------------------------------------------------------- start
  for (const box of $$(".out")) initOut(box);
  setOut("o-sdk-commands", PBI.SDK_COMMANDS);
  setOut("o-sdk-caps", PBI.SDK_CAPABILITIES);
  setOut("o-sdk-visual", PBI.SDK_VISUAL_TS);
  $("#version").textContent = `Version ${PBI.VERSION}`;
  renderRecommend();
  renderSvg();
  renderDeneb();
  renderNative();
  renderHtmlPy();
  updateWriteButtons();
  document.documentElement.dataset.ready = "true";
})();
