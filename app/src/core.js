"use strict";
/* Power BI Visual Builder (offline) - core logic.
   No DOM access and no network: generators, scanner, recommendation rules and the PBIP writer.
   The templates are the ones tested for the powerbi-visual-builder skill (November 2026). */
const PBI = (() => {
  const VERSION = "1.0.0";

  class InputError extends Error {
    constructor(message) { super(message); this.name = "InputError"; }
  }

  // ------------------------------------------------------------------ input validation
  const NAME_RE = /^[\p{L}\p{N}\p{Sc} _\-.,%#&()\/+]{1,100}$/u;   // table, column and measure names (currency symbols allowed)
  const TEXT_RE = /^[\p{L}\p{N} .,%()\/+\-]+$/u;               // short display text
  const TITLE_RE = /^[\p{L}\p{N} .,%()\/+\-;:'&!?]+$/u;       // visual titles (JSON-escaped on output)
  const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
  const SCHEMA_PREFIX = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/";
  const SCHEMA_RE = /^https:\/\/developer\.microsoft\.com\/json-schemas\/fabric\/item\/report\/definition\/visualContainer\/\d+\.\d+\.\d+\/schema\.json$/;

  function name(v, what) {
    const s = String(v ?? "").trim();
    if (!NAME_RE.test(s)) {
      throw new InputError(`${what}: use letters, digits, spaces, currency symbols or _ - . , % # & ( ) / + (no quotes or brackets, at most 100 characters).`);
    }
    return s;
  }
  function ref(v, what, example) {                             // Table[Field] or 'Table'[Field]
    const m = /^\s*(?:'([^'\[\]]+)'|([^'\[\]]+?))\s*\[([^\[\]]+)\]\s*$/u.exec(String(v ?? ""));
    if (!m) throw new InputError(`${what}: write it as Table[Field], for example ${example}.`);
    return { table: name(m[1] ?? m[2], `${what} (table)`), field: name(m[3], `${what} (field)`) };
  }
  const columnRef = (v, what) => ref(v, what, "Region[Region]");
  const measureRef = (v, what) => ref(v, what, "Sales[Sales Amount] (the measure's home table)");
  function measureName(v, what) {                              // "Sales Amount", "[Sales Amount]" or "Sales[Sales Amount]"
    const s = String(v ?? "").trim();
    const m = /^(?:(?:'[^'\[\]]+'|[^'\[\]]+?)\s*)?\[([^\[\]]+)\]$/u.exec(s);
    return name(m ? m[1] : s, what);
  }
  function int(v, what, min, max) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`${what}: a whole number from ${min} to ${max}.`);
    return n;
  }
  function num(v, what, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${what}: a number from ${min} to ${max}.`);
    return n;
  }
  function hex(v, what) {
    const s = String(v ?? "").trim();
    if (!HEX_RE.test(s)) throw new InputError(`${what}: a colour written as #RRGGBB.`);
    return s.toUpperCase();
  }
  function text(v, what, max = 40) {
    const s = String(v ?? "").trim();
    if (!s || s.length > max || !TEXT_RE.test(s)) {
      throw new InputError(`${what}: up to ${max} letters, digits, spaces or . , % ( ) / + - characters.`);
    }
    return s;
  }
  function title(v, what) {
    const s = String(v ?? "").trim();
    if (s.length > 100 || !TITLE_RE.test(s)) {
      throw new InputError(`${what}: up to 100 letters, digits, spaces or . , % ( ) / + - ; : ' & ! ? characters.`);
    }
    return s;
  }
  function oneOf(v, what, allowed) {
    if (!allowed.includes(v)) throw new InputError(`${what}: choose one of ${allowed.join(", ")}.`);
    return v;
  }
  function distinct(values, what) {
    if (new Set(values).size !== values.length) throw new InputError(`${what} must all be different.`);
  }
  function lines(v) {
    return String(v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  function schemaUrl(v) {
    const s = String(v ?? "").trim();
    if (/^\d+\.\d+\.\d+$/.test(s)) return `${SCHEMA_PREFIX}${s}/schema.json`;
    if (!SCHEMA_RE.test(s)) throw new InputError("Schema: a visualContainer version such as 2.9.0, or its schema URL.");
    return s;
  }
  function randomHex(n) {
    const bytes = new Uint8Array(Math.ceil(n / 2));
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  }
  function uuid4() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const daxCol = (r) => `'${r.table}'[${r.field}]`;
  const daxMeasure = (m) => `[${m}]`;
  const denebField = (s) => s.replace(/[\\".\[\]]/g, "_");    // Deneb renames these characters to _
  const vq = (s) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";   // Vega expression string
  const join = (rows) => rows.join("\n") + "\n";

  // ------------------------------------------------------------------ SVG measures (DAX)
  const DEFAULTS = {
    bullet: { name: "Bullet SVG", actual: "Sales Amount", target: "Sales Target", row: "'Region'[Region]", width: 120, good: "#1AAB40", bad: "#D64554" },
    progress: { name: "Progress SVG", actual: "Sales Amount", target: "Sales Target", barWidth: 140, done: "#1AAB40", open: "#118DFF" },
    sparkline: { name: "Sparkline SVG", value: "Sales Amount", dateTable: "Date", dateColumn: "Date", monthColumn: "Month Start", months: 12, width: 120, height: 28, color: "#118DFF" },
    status: { name: "Status SVG", actual: "Sales Amount", target: "Sales Target", atRiskPct: 5, onTrack: "On track", atRisk: "At risk", behind: "Behind" },
    html: { name: "KPI Tile HTML", label: "'Region'[Region]", allText: "All regions", actual: "Sales Amount", target: "Sales Target", format: "#,0" },
    python: { category: "Region", value: "Order Value", xLabel: "" },
    lollipop: { category: "Region[Region]", value: "Sales[Sales Amount]", format: "#,0", tooltips: true, selection: true, highlight: true },
    variance: { category: "Region[Region]", actual: "Sales[Sales Amount]", prior: "Sales[Sales PY]", format: "#,0", tooltips: true, selection: true, highlight: true },
  };
  const NUMBER_FORMATS = ["#,0", "#,0.0", "#,0.00", "0%", "0.0%", "$#,0", "€#,0", "£#,0", "₹#,0"];

  function svgBullet(raw) {
    const p = { ...DEFAULTS.bullet, ...raw };
    const nm = name(p.name, "Measure name");
    const act = measureName(p.actual, "Actual measure"), tgt = measureName(p.target, "Target measure");
    distinct([act, tgt], "Actual and target measures");
    const A = daxMeasure(act), T = daxMeasure(tgt);
    const row = daxCol(columnRef(p.row, "Row field"));
    const w = int(p.width, "Width", 40, 400);
    const good = hex(p.good, "Colour at or above target"), bad = hex(p.bad, "Colour below target");
    return join([
      `${nm} =`,
      `VAR _Actual = ${A}`,
      `VAR _Target = ${T}`,
      "VAR _Max =",
      `    MAXX ( ALLSELECTED ( ${row} ), MAX ( ${A}, ${T} ) ) * 1.1`,
      `VAR _W = ${w}`,
      "VAR _H = 24",
      "VAR _ActW = MAX ( 0, COALESCE ( DIVIDE ( _Actual, _Max ), 0 ) ) * _W",
      "VAR _TgtX = COALESCE ( DIVIDE ( _Target, _Max ), 0 ) * _W",
      `VAR _Color = IF ( _Actual >= _Target, "${good}", "${bad}" )`,
      "VAR _Svg =",
      "    \"<svg xmlns='http://www.w3.org/2000/svg' width='\" & _W & \"' height='\" & _H",
      "        & \"' viewBox='0 0 \" & _W & \" \" & _H & \"'>\"",
      "        & \"<rect x='0' y='4' width='\" & _W & \"' height='16' fill='#F3F2F1'/>\"",
      "        & \"<rect x='0' y='8' width='\" & FORMAT ( _ActW, \"0.0\", \"en-US\" )",
      "        & \"' height='8' fill='\" & _Color & \"'/>\"",
      "        & IF (",
      "            NOT ISBLANK ( _Target ),",
      "            \"<rect x='\" & FORMAT ( MAX ( 0, _TgtX - 1 ), \"0.0\", \"en-US\" )",
      "                & \"' y='2' width='2' height='20' fill='#252423'/>\"",
      "        )",
      "        & \"</svg>\"",
      "RETURN",
      "    IF (",
      `        ISINSCOPE ( ${row} ) && NOT ISBLANK ( _Actual ),`,
      "        \"data:image/svg+xml;utf8,\" & _Svg",
      "    )",
    ]);
  }

  function svgProgress(raw) {
    const p = { ...DEFAULTS.progress, ...raw };
    const nm = name(p.name, "Measure name");
    const act = measureName(p.actual, "Actual measure"), tgt = measureName(p.target, "Target measure");
    distinct([act, tgt], "Actual and target measures");
    const bw = int(p.barWidth, "Bar width", 40, 400);
    const done = hex(p.done, "Colour when target is reached"), open = hex(p.open, "Colour below target");
    return join([
      `${nm} =`,
      `VAR _Pct = DIVIDE ( ${daxMeasure(act)}, ${daxMeasure(tgt)} )`,
      `VAR _BarMax = ${bw}`,
      "VAR _W = _BarMax + 44",
      "VAR _Fill = MIN ( MAX ( COALESCE ( _Pct, 0 ), 0 ), 1 ) * _BarMax",
      `VAR _Color = IF ( _Pct >= 1, "${done}", "${open}" )`,
      "VAR _Svg =",
      "    \"<svg xmlns='http://www.w3.org/2000/svg' width='\" & _W & \"' height='20' viewBox='0 0 \" & _W & \" 20'>\"",
      "        & \"<rect x='0' y='5' width='\" & _BarMax & \"' height='10' rx='5' fill='#EDEBE9'/>\"",
      "        & \"<rect x='0' y='5' width='\" & FORMAT ( _Fill, \"0.0\", \"en-US\" )",
      "        & \"' height='10' rx='5' fill='\" & _Color & \"'/>\"",
      "        & \"<text x='\" & _BarMax + 6 & \"' y='14.5' font-family='Segoe UI, sans-serif' font-size='11' fill='#252423'>\"",
      "        & FORMAT ( _Pct, \"0%\", \"en-US\" ) & \"</text>\"",
      "        & \"</svg>\"",
      "RETURN",
      "    IF ( NOT ISBLANK ( _Pct ), \"data:image/svg+xml;utf8,\" & _Svg )",
    ]);
  }

  function svgSparkline(raw) {
    const p = { ...DEFAULTS.sparkline, ...raw };
    const nm = name(p.name, "Measure name");
    const val = daxMeasure(measureName(p.value, "Value measure"));
    const t = name(p.dateTable, "Date table");
    const dateCol = daxCol({ table: t, field: name(p.dateColumn, "Date column") });
    const monthCol = daxCol({ table: t, field: name(p.monthColumn, "Month start column") });
    distinct([dateCol, monthCol], "Date column and month start column");
    const tab = `'${t}'`;
    const months = int(p.months, "Months", 2, 36);
    const w = int(p.width, "Width", 40, 400), h = int(p.height, "Height", 12, 80);
    const color = hex(p.color, "Line colour");
    return join([
      `${nm} =`,
      `VAR _W = ${w}`,
      `VAR _H = ${h}`,
      "VAR _Pad = 3",
      `VAR _End = MAX ( ${dateCol} )`,
      "VAR _Points =",
      "    FILTER (",
      "        ADDCOLUMNS (",
      "            CALCULATETABLE (",
      `                VALUES ( ${monthCol} ),`,
      `                DATESINPERIOD ( ${dateCol}, _End, -${months}, MONTH ),`,
      `                REMOVEFILTERS ( ${tab} )`,
      "            ),",
      "            \"@v\",",
      `                VAR _m = ${monthCol}`,
      "                RETURN",
      `                    CALCULATE ( ${val}, REMOVEFILTERS ( ${tab} ), ${monthCol} = _m )`,
      "        ),",
      "        NOT ISBLANK ( [@v] )",
      "    )",
      "VAR _MinV = MINX ( _Points, [@v] )",
      "VAR _MaxV = MAXX ( _Points, [@v] )",
      `VAR _MinD = MINX ( _Points, ${monthCol} )`,
      `VAR _Span = DATEDIFF ( _MinD, MAXX ( _Points, ${monthCol} ), DAY )`,
      "VAR _Coords =",
      "    ADDCOLUMNS (",
      "        _Points,",
      `        "@x", _Pad + COALESCE ( DIVIDE ( DATEDIFF ( _MinD, ${monthCol}, DAY ), _Span ), 0 ) * ( _W - 2 * _Pad ),`,
      "        \"@y\", _H - _Pad - COALESCE ( DIVIDE ( [@v] - _MinV, _MaxV - _MinV ), 0.5 ) * ( _H - 2 * _Pad )",
      "    )",
      "VAR _Line =",
      "    CONCATENATEX (",
      "        _Coords,",
      "        FORMAT ( [@x], \"0.0\", \"en-US\" ) & \",\" & FORMAT ( [@y], \"0.0\", \"en-US\" ),",
      "        \" \",",
      `        ${monthCol}, ASC`,
      "    )",
      `VAR _Last = TOPN ( 1, _Coords, ${monthCol}, DESC )`,
      "VAR _Svg =",
      "    \"<svg xmlns='http://www.w3.org/2000/svg' width='\" & _W & \"' height='\" & _H",
      "        & \"' viewBox='0 0 \" & _W & \" \" & _H & \"'>\"",
      "        & \"<polyline points='\" & _Line",
      `        & "' fill='none' stroke='${color}' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'/>"`,
      "        & \"<circle cx='\" & FORMAT ( MAXX ( _Last, [@x] ), \"0.0\", \"en-US\" )",
      `        & "' cy='" & FORMAT ( MAXX ( _Last, [@y] ), "0.0", "en-US" ) & "' r='2.5' fill='${color}'/>"`,
      "        & \"</svg>\"",
      "RETURN",
      "    IF ( COUNTROWS ( _Points ) >= 2, \"data:image/svg+xml;utf8,\" & _Svg )",
    ]);
  }

  function svgStatus(raw) {
    const p = { ...DEFAULTS.status, ...raw };
    const nm = name(p.name, "Measure name");
    const act = measureName(p.actual, "Actual measure"), tgt = measureName(p.target, "Target measure");
    distinct([act, tgt], "Actual and target measures");
    const A = daxMeasure(act), T = daxMeasure(tgt);
    const pct = num(p.atRiskPct, "At-risk band (%)", 0.5, 50);
    const floor = String(-parseFloat((pct / 100).toFixed(4)));
    const l1 = text(p.onTrack, "On-track label", 12), l2 = text(p.atRisk, "At-risk label", 12), l3 = text(p.behind, "Behind label", 12);
    distinct([l1, l2, l3], "Status labels");
    return join([
      `${nm} =`,
      `VAR _Gap = DIVIDE ( ${A} - ${T}, ${T} )`,
      "VAR _Status =",
      `    SWITCH ( TRUE (), ISBLANK ( _Gap ), BLANK (), _Gap >= 0, "${l1}", _Gap >= ${floor}, "${l2}", "${l3}" )`,
      `VAR _Fill = SWITCH ( _Status, "${l1}", "#DFF6DD", "${l2}", "#FFF4CE", "#FDE7E9" )`,
      `VAR _Ink = SWITCH ( _Status, "${l1}", "#107C10", "${l2}", "#8A6D00", "#A4262C" )`,
      "VAR _Svg =",
      "    \"<svg xmlns='http://www.w3.org/2000/svg' width='84' height='22' viewBox='0 0 84 22'>\"",
      "        & \"<rect x='0.5' y='0.5' width='83' height='21' rx='10.5' fill='\" & _Fill & \"' stroke='\" & _Ink & \"'/>\"",
      "        & \"<text x='42' y='15' text-anchor='middle' font-family='Segoe UI, sans-serif' font-size='11' font-weight='600' fill='\"",
      "        & _Ink & \"'>\" & _Status & \"</text>\"",
      "        & \"</svg>\"",
      "RETURN",
      "    IF ( NOT ISBLANK ( _Status ), \"data:image/svg+xml;utf8,\" & _Svg )",
    ]);
  }

  const SVG_ESCAPE_UDF = join([
    "DEFINE",
    "    FUNCTION SvgEscapeText = ( txt : STRING ) =>",
    "        SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE (",
    "            txt, \"&\", \"&amp;\" ), \"<\", \"&lt;\" ), \">\", \"&gt;\" ), \"'\", \"&apos;\" ), \"\"\"\", \"&quot;\" )",
    "EVALUATE",
    "    { SvgEscapeText ( \"R&D <West> 'A' \"\"B\"\"\" ) }",
  ]);

  // ------------------------------------------------------------------ HTML Content Secure and Python
  function htmlKpiTile(raw) {
    const p = { ...DEFAULTS.html, ...raw };
    const nm = name(p.name, "Measure name");
    const label = daxCol(columnRef(p.label, "Label field"));
    const all = text(p.allText, "Text when several items are selected", 40);
    const act = measureName(p.actual, "Actual measure"), tgt = measureName(p.target, "Target measure");
    distinct([act, tgt], "Actual and target measures");
    const fmt = oneOf(p.format, "Number format", NUMBER_FORMATS);
    return join([
      `${nm} =`,
      `VAR _Name = SELECTEDVALUE ( ${label}, "${all}" )`,
      "VAR _Safe =",
      "    SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE (",
      "        _Name, \"&\", \"&amp;\" ), \"<\", \"&lt;\" ), \">\", \"&gt;\" ), \"'\", \"&apos;\" ), \"\"\"\", \"&quot;\" )",
      `VAR _Act = ${daxMeasure(act)}`,
      `VAR _Gap = DIVIDE ( _Act - ${daxMeasure(tgt)}, ${daxMeasure(tgt)} )`,
      "VAR _Ink = IF ( _Gap >= 0, \"#107C10\", \"#A4262C\" )",
      "RETURN",
      "    \"<div style='font-family:Segoe UI,sans-serif;padding:8px 12px;border-left:4px solid \" & _Ink & \"'>\"",
      "        & \"<div style='font-size:12px;color:#605E5C'>\" & _Safe & \"</div>\"",
      `        & "<div style='font-size:24px;font-weight:600;color:#252423'>" & FORMAT ( _Act, "${fmt}" ) & "</div>"`,
      "        & \"<div style='font-size:12px;color:\" & _Ink & \"'>\"",
      "        & FORMAT ( _Gap, \"+0.0%;-0.0%;0.0%\" ) & \" vs target</div>\"",
      "        & \"</div>\"",
    ]);
  }

  function pythonBoxplot(raw) {
    const p = { ...DEFAULTS.python, ...raw };
    const cat = name(p.category, "Category column"), val = name(p.value, "Value column");
    distinct([cat, val], "Category and value columns");
    const xl = p.xLabel ? text(p.xLabel, "Axis title", 40) : val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
    return join([
      `# Python visual: ${val.toLowerCase().replace(/\s+/g, "-")} distribution by ${cat.toLowerCase()} (box plot + jittered points)`,
      "import matplotlib.pyplot as plt",
      "",
      `df = dataset.dropna(subset=["${cat}", "${val}"])  # noqa: F821 (provided by Power BI)`,
      "if df.empty:",
      "    fig, ax = plt.subplots(figsize=(6, 3.5))",
      "    ax.text(0.5, 0.5, \"No data for the current filters\", ha=\"center\", va=\"center\", color=\"#605E5C\")",
      "    ax.axis(\"off\")",
      "else:",
      `    order = df.groupby("${cat}")["${val}"].median().sort_values(ascending=False).index.tolist()`,
      `    groups = [df.loc[df["${cat}"] == r, "${val}"].to_numpy() for r in order]`,
      "    fig, ax = plt.subplots(figsize=(6, 3.5))",
      "    ax.boxplot(groups, vert=False, showfliers=False, widths=0.5,",
      "               medianprops={\"color\": \"#118DFF\", \"linewidth\": 2},",
      "               boxprops={\"color\": \"#605E5C\"}, whiskerprops={\"color\": \"#605E5C\"}, capprops={\"color\": \"#605E5C\"})",
      "    for i, g in enumerate(groups, start=1):",
      "        ax.scatter(g, [i + ((j % 7) - 3) * 0.03 for j in range(len(g))], s=6, alpha=0.35, color=\"#118DFF\")",
      "    ax.set_yticks(range(1, len(order) + 1), labels=order)",
      "    ax.invert_yaxis()",
      `    ax.set_xlabel("${xl}")`,
      "    for side in (\"top\", \"right\"):",
      "        ax.spines[side].set_visible(False)",
      "    ax.grid(axis=\"x\", color=\"#EDEBE9\")",
      "fig.tight_layout()",
      "plt.show()",
    ]);
  }

  // ------------------------------------------------------------------ Deneb (Vega-Lite 6)
  const DENEB_GUID = "deneb7E15AEF80B9E4D4F8E12924291ECE89A";
  const VL_SCHEMA = "https://vega.github.io/schema/vega-lite/v6.json";
  const DENEB_CONFIG = {
    font: "Segoe UI",
    view: { stroke: "transparent" },
    axis: { labelColor: "#605E5C", titleColor: "#605E5C", labelFontSize: 11, titleFontSize: 12,
            titleFontWeight: "normal", domainColor: "#C8C6C4", tickColor: "#C8C6C4", gridColor: "#EDEBE9" },
    legend: { labelColor: "#605E5C", titleColor: "#605E5C", labelFontSize: 11, orient: "top" },
    text: { color: "#605E5C", fontSize: 11 },
    range: { category: { scheme: "pbiColorNominal" } },
  };
  const RESERVED_FIELDS = ["Variance", "Variance %"];

  function lollipopSpec(cat, val, fmt) {
    return {
      "$schema": VL_SCHEMA,
      data: { name: "dataset" },
      width: "container",
      height: "container",
      autosize: { type: "fit", contains: "padding" },
      transform: [
        { calculate: `datum[${vq(val + "__highlightStatus")}] == 'off' || datum['__selected__'] == 'off' ? 0.3 : 1`, as: "__opacity" },
      ],
      encoding: {
        y: {
          field: cat, type: "nominal", title: null,
          sort: { field: val, op: "max", order: "descending" },
          axis: { labelLimit: 160, ticks: false, domain: false },
        },
        x: { field: val, type: "quantitative", title: null,
             axis: { format: fmt, formatType: "pbiFormat", tickCount: 4 } },
        opacity: { field: "__opacity", type: "quantitative", scale: null, legend: null },
        tooltip: [
          { field: cat, type: "nominal" },
          { field: val, type: "quantitative", format: fmt, formatType: "pbiFormat" },
        ],
      },
      layer: [
        { mark: { type: "rule", strokeWidth: 2, color: "#C8C6C4" }, encoding: { x2: { datum: 0 } } },
        { mark: { type: "circle", size: 140, color: { expr: "pbiColor(0)" } } },
        { mark: { type: "text", align: "left", baseline: "middle", dx: 10, fontSize: 11 },
          encoding: { text: { field: val, type: "quantitative", format: fmt, formatType: "pbiFormat" } } },
      ],
    };
  }

  function varianceSpec(cat, act, py, fmt) {
    const A = vq(act), P = vq(py);
    const PCT = "+0.0%;-0.0%;0.0%";
    return {
      "$schema": VL_SCHEMA,
      data: { name: "dataset" },
      width: "container",
      height: "container",
      autosize: { type: "fit", contains: "padding" },
      transform: [
        { calculate: `datum[${A}] - datum[${P}]`, as: "Variance" },
        { calculate: `datum[${P}] ? (datum[${A}] - datum[${P}]) / abs(datum[${P}]) : null`, as: "Variance %" },
        { calculate: "datum['Variance'] < 0 ? pbiColor('bad') : pbiColor('good')", as: "__varColor" },
        { calculate: `datum[${vq(act + "__highlightStatus")}] == 'off' || datum['__selected__'] == 'off' ? 0.3 : 1`, as: "__opacity" },
      ],
      encoding: {
        y: { field: cat, type: "nominal", title: null,
             sort: { field: act, op: "max", order: "descending" },
             axis: { ticks: false, domain: false, labelLimit: 160 } },
        opacity: { field: "__opacity", type: "quantitative", scale: null, legend: null },
        tooltip: [
          { field: cat, type: "nominal" },
          { field: act, type: "quantitative", format: fmt, formatType: "pbiFormat" },
          { field: py, title: "Prior year", type: "quantitative", format: fmt, formatType: "pbiFormat" },
          { field: "Variance %", type: "quantitative", format: PCT, formatType: "pbiFormat" },
        ],
      },
      layer: [
        { mark: { type: "bar", color: "#C8C6C4", height: { band: 0.55 }, yOffset: 5 },
          encoding: { x: { field: py, type: "quantitative", title: null,
                           axis: { format: fmt, formatType: "pbiFormat", tickCount: 4 } } } },
        { mark: { type: "bar", color: "#404040", height: { band: 0.55 }, yOffset: -3 },
          encoding: { x: { field: act, type: "quantitative" } } },
        { mark: { type: "text", align: "left", baseline: "middle", dx: 6, fontSize: 11, fontWeight: "bold" },
          transform: [{ calculate: `max(datum[${A}], datum[${P}])`, as: "__labelX" }],
          encoding: {
            x: { field: "__labelX", type: "quantitative" },
            text: { field: "Variance %", type: "quantitative", format: PCT, formatType: "pbiFormat" },
            color: { field: "__varColor", type: "nominal", scale: null, legend: null } } },
      ],
    };
  }

  const TEMPLATE_INFO = {
    lollipop: {
      name: "Ranked lollipop",
      description: "Ranks a category by one measure. Supports tooltips, cross-filtering and cross-highlighting.",
      datasets: [
        { key: "__dataset.0__", name: "Category", description: "Column to rank (one row per item)", kind: "column", type: "text" },
        { key: "__dataset.1__", name: "Value", description: "Measure to rank by", kind: "measure", type: "numeric" },
      ],
    },
    variance: {
      name: "Actual vs prior year",
      description: "Actual and prior-year bars per category with variance %. Supports tooltips, cross-filtering and cross-highlighting.",
      datasets: [
        { key: "__dataset.0__", name: "Category", description: "Column to compare (one row per item)", kind: "column", type: "text" },
        { key: "__dataset.1__", name: "Actual", description: "Actual measure", kind: "measure", type: "numeric" },
        { key: "__dataset.2__", name: "Prior year", description: "Prior-year or plan measure", kind: "measure", type: "numeric" },
      ],
    },
  };

  function denebChart(kind, raw) {
    oneOf(kind, "Chart", ["lollipop", "variance"]);
    const p = { ...DEFAULTS[kind], ...raw };
    const fmt = oneOf(p.format, "Number format", NUMBER_FORMATS);
    const cat = columnRef(p.category, "Category column");
    const measures = kind === "lollipop"
      ? [measureRef(p.value, "Value measure")]
      : [measureRef(p.actual, "Actual measure"), measureRef(p.prior, "Prior-year measure")];
    const fields = [cat, ...measures].map((r) => denebField(r.field));
    distinct(fields, "Field names used in the chart");
    for (const f of fields) {
      if (f.startsWith("__") || RESERVED_FIELDS.includes(f)) throw new InputError(`"${f}" is used inside the chart; rename the field in the visual or the model.`);
    }
    const spec = kind === "lollipop" ? lollipopSpec(fields[0], fields[1], fmt) : varianceSpec(fields[0], fields[1], fields[2], fmt);
    const projections = [projection(cat.table, "Column", cat.field), ...measures.map((m) => projection(m.table, "Measure", m.field))];
    const interactivity = { tooltips: !!p.tooltips, selection: !!p.selection, highlight: !!p.highlight };
    return { kind, spec, config: DENEB_CONFIG, projections, interactivity, fields, format: fmt };
  }

  function denebTemplate(kind, raw = {}, meta = {}) {
    const chart = denebChart(kind, raw);
    const keys = TEMPLATE_INFO[kind].datasets.map((d) => d.key);
    const spec = kind === "lollipop" ? lollipopSpec(keys[0], keys[1], chart.format) : varianceSpec(keys[0], keys[1], keys[2], chart.format);
    const { $schema, ...body } = spec;
    const info = TEMPLATE_INFO[kind];
    return {
      "$schema": $schema,
      usermeta: {
        deneb: { build: "2.0.1.0", metaVersion: 2, provider: "vegaLite", providerVersion: "6.4.3" },
        information: {
          name: info.name,
          description: info.description,
          author: meta.author ? text(meta.author, "Author", 40) : "Your team",
          uuid: meta.uuid ?? uuid4(),
          generated: meta.generated ?? new Date().toISOString(),
        },
        datasets: { dataset: info.datasets.map((d) => ({ ...d })) },
        interactivity: { tooltip: chart.interactivity.tooltips, contextMenu: true, selection: chart.interactivity.selection,
                         selectionMode: "simple", highlight: chart.interactivity.highlight, dataPointLimit: 50 },
        config: JSON.stringify(DENEB_CONFIG),
      },
      ...body,
    };
  }

  // ------------------------------------------------------------------ PBIR visual.json
  const lit = {
    text: (s) => ({ expr: { Literal: { Value: "'" + s.replace(/'/g, "''") + "'" } } }),
    bool: (b) => ({ expr: { Literal: { Value: b ? "true" : "false" } } }),
    num: (n) => ({ expr: { Literal: { Value: `${n}D` } } }),
  };
  function projection(entity, kind, prop, extra) {
    const p = { field: { [kind]: { Expression: { SourceRef: { Entity: entity } }, Property: prop } },
                queryRef: `${entity}.${prop}`, nativeQueryRef: prop };
    return extra ? Object.assign(p, extra) : p;
  }
  function fieldOnly(entity, kind, prop) {
    return { [kind]: { Expression: { SourceRef: { Entity: entity } }, Property: prop } };
  }
  function position(o) {
    return { x: o.x, y: o.y, z: o.z, height: o.h, width: o.w, tabOrder: o.tab };
  }

  function denebVisual(chart, o) {
    const spec = {};
    for (const [k, v] of Object.entries(chart.spec)) if (k !== "$schema") spec[k] = v;   // Deneb's editor warns on a root $schema
    return {
      "$schema": o.schemaUrl,
      name: o.name,
      position: position(o),
      visual: {
        visualType: o.visualType ?? DENEB_GUID,
        query: { queryState: { dataset: { projections: chart.projections } } },
        objects: { vega: [{ properties: {
          jsonSpec: lit.text(JSON.stringify(spec)),
          jsonConfig: lit.text(JSON.stringify(chart.config)),
          provider: lit.text("vegaLite"),
          renderMode: lit.text("svg"),
          enableTooltips: lit.bool(chart.interactivity.tooltips),
          enableContextMenu: lit.bool(true),
          enableSelection: lit.bool(chart.interactivity.selection),
          enableHighlight: lit.bool(chart.interactivity.highlight),
          selectionMaxDataPoints: lit.num(50),
        } }] },
        drillFilterOtherVisuals: true,
      },
    };
  }

  const NATIVE_TYPES = {
    clusteredBarChart: { label: "Bar chart (horizontal)", shape: "chart" },
    clusteredColumnChart: { label: "Column chart", shape: "chart" },
    lineChart: { label: "Line chart", shape: "chart" },
    areaChart: { label: "Area chart", shape: "chart" },
    tableEx: { label: "Table", shape: "table" },
    pivotTable: { label: "Matrix", shape: "matrix" },
    cardVisual: { label: "Card (new card visual)", shape: "card" },
  };

  function nativeSpec(raw) {                                   // validate everything before any file is touched
    const type = oneOf(raw.visualType, "Visual type", Object.keys(NATIVE_TYPES));
    const shape = NATIVE_TYPES[type].shape;
    const cols = (v, what) => lines(v).map((l, i) => columnRef(l, `${what}, line ${i + 1}`));
    const meas = (v, what) => lines(v).map((l, i) => measureRef(l, `${what}, line ${i + 1}`));
    const s = { type, shape, title: String(raw.title ?? "").trim() ? title(raw.title, "Title") : "" };
    if (shape === "chart") {
      const c = cols(raw.category, "Axis (category)");
      if (c.length !== 1) throw new InputError("Axis (category): exactly one column.");
      s.category = c[0];
      s.values = meas(raw.values, "Values (measures)");
      if (!s.values.length) throw new InputError("Values (measures): at least one measure.");
      const series = cols(raw.series, "Legend (series)");
      if (series.length > 1) throw new InputError("Legend (series): at most one column.");
      if (series.length && s.values.length > 1) throw new InputError("Legend (series) works with a single measure only.");
      s.series = series[0] ?? null;
      s.sort = oneOf(raw.sort ?? (type === "lineChart" || type === "areaChart" ? "none" : "value"), "Sort", ["value", "category", "none"]);
    } else if (shape === "table") {
      s.columns = cols(raw.columns, "Columns");
      s.values = meas(raw.values, "Measures");
      if (!s.columns.length && !s.values.length) throw new InputError("Add at least one column or measure.");
    } else if (shape === "matrix") {
      s.rows = cols(raw.rows, "Rows");
      s.columns = cols(raw.columns, "Columns");
      s.values = meas(raw.values, "Values (measures)");
      if (!s.rows.length || !s.values.length) throw new InputError("A matrix needs at least one row field and one measure.");
    } else {
      s.values = meas(raw.values, "Measures");
      if (!s.values.length) throw new InputError("Measures: at least one measure.");
    }
    if (shape === "table" || shape === "matrix") {
      const ih = raw.imageHeight === "" || raw.imageHeight == null ? null : int(raw.imageHeight, "Image height", 8, 400);
      const iw = raw.imageWidth === "" || raw.imageWidth == null ? null : int(raw.imageWidth, "Image width", 8, 800);
      if ((ih === null) !== (iw === null)) throw new InputError("Image size: give both height and width, or neither.");
      s.image = ih === null ? null : { h: ih, w: iw };
    }
    const all = [...(s.category ? [s.category] : []), ...(s.series ? [s.series] : []), ...(s.rows ?? []), ...(s.columns ?? []), ...s.values];
    distinct(all.map((r) => `${r.table}.${r.field}`), "Fields in one visual");
    return s;
  }

  function nativeVisual(s, o) {
    const proj = (r, kind, extra) => projection(r.table, kind, r.field, extra);
    const queryState = {};
    let sortDefinition = null;
    const objects = {};
    if (s.shape === "chart") {
      queryState.Category = { projections: [proj(s.category, "Column", { active: true })] };
      queryState.Y = { projections: s.values.map((m) => proj(m, "Measure")) };
      if (s.series) queryState.Series = { projections: [proj(s.series, "Column")] };
      if (s.sort === "value") {
        sortDefinition = { sort: [{ field: fieldOnly(s.values[0].table, "Measure", s.values[0].field), direction: "Descending" }], isDefaultSort: true };
      } else if (s.sort === "category") {
        sortDefinition = { sort: [{ field: fieldOnly(s.category.table, "Column", s.category.field), direction: "Ascending" }], isDefaultSort: true };
      }
      if (s.type === "clusteredBarChart" || s.type === "clusteredColumnChart") {
        if (!s.series) objects.dataPoint = [{ properties: { defaultColor: { solid: { color: { expr: { ThemeDataColor: { ColorId: 0, Percent: 0 } } } } } } }];
        objects.labels = [{ properties: { show: lit.bool(true) } }];
        objects.valueAxis = [{ properties: { start: lit.num(0) } }];
      } else if (s.type === "areaChart") {
        objects.valueAxis = [{ properties: { start: lit.num(0) } }];
      }
    } else if (s.shape === "table") {
      queryState.Values = { projections: [...s.columns.map((c) => proj(c, "Column")), ...s.values.map((m) => proj(m, "Measure"))] };
    } else if (s.shape === "matrix") {
      queryState.Rows = { projections: s.rows.map((c, i) => proj(c, "Column", i === 0 ? { active: true } : undefined)) };
      if (s.columns.length) queryState.Columns = { projections: s.columns.map((c, i) => proj(c, "Column", i === 0 ? { active: true } : undefined)) };
      queryState.Values = { projections: s.values.map((m) => proj(m, "Measure")) };
    } else {
      queryState.Data = { projections: s.values.map((m) => proj(m, "Measure")) };
    }
    if (s.image) objects.grid = [{ properties: { imageHeight: lit.num(s.image.h), imageWidth: lit.num(s.image.w) } }];
    const query = { queryState };
    if (sortDefinition) query.sortDefinition = sortDefinition;
    const visual = { visualType: s.type, query };
    if (Object.keys(objects).length) visual.objects = objects;
    if (s.title) {
      visual.visualContainerObjects = { title: [{ properties: { show: lit.bool(true), text: lit.text(s.title) } }] };
    }
    visual.drillFilterOtherVisuals = true;
    return { "$schema": o.schemaUrl, name: o.name, position: position(o), visual };
  }

  const pretty = (obj) => JSON.stringify(obj, null, 2) + "\n";

  // ------------------------------------------------------------------ custom visual (SDK) starter
  const SDK_COMMANDS = join([
    "npx --yes powerbi-visuals-tools@7.2.1 new <visualName>   # scaffold (API 5.11.1, ESLint config included)",
    "cd <visualName>",
    "npm install --save-dev --save-exact powerbi-visuals-tools@7.2.1   # pin the CLI inside the project",
    "npx pbiviz start                                   # dev server: only in a dev workspace where your admin allows developer visuals",
    "npx eslint .                                       # eslint-plugin-powerbi-visuals recommended rules",
    "npx pbiviz package --certification-audit           # flags fetch / XMLHttpRequest / eval; produces dist/*.pbiviz",
    "npm audit --audit-level=moderate                   # certification bar: no moderate/high findings",
  ]);
  const SDK_CAPABILITIES = join([
    "{",
    "  \"privileges\": [],",
    "  \"supportsKeyboardFocus\": true,",
    "  \"supportsLandingPage\": true,",
    "  \"supportsMultiVisualSelection\": true,",
    "  \"tooltips\": {\"supportedTypes\": {\"default\": true, \"canvas\": true}, \"roles\": [\"tooltips\"]}",
    "}",
  ]);
  const SDK_VISUAL_TS = join([
    "\"use strict\";",
    "import powerbi from \"powerbi-visuals-api\";",
    "import { FormattingSettingsService } from \"powerbi-visuals-utils-formattingmodel\";",
    "import \"./../style/visual.less\";",
    "import { VisualFormattingSettingsModel } from \"./settings\";",
    "",
    "import IVisual = powerbi.extensibility.visual.IVisual;",
    "import IVisualHost = powerbi.extensibility.visual.IVisualHost;",
    "import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;",
    "import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;",
    "import ISelectionManager = powerbi.extensibility.ISelectionManager;",
    "import ISelectionId = powerbi.visuals.ISelectionId;",
    "",
    "const SVG_NS = \"http://www.w3.org/2000/svg\";",
    "interface Bar { label: string; value: number; id: ISelectionId; }",
    "",
    "export class Visual implements IVisual {",
    "    private host: IVisualHost;",
    "    private svg: SVGSVGElement;",
    "    private selection: ISelectionManager;",
    "    private formatting = new FormattingSettingsService();",
    "    private settings: VisualFormattingSettingsModel;",
    "",
    "    constructor(options: VisualConstructorOptions) {",
    "        this.host = options.host;",
    "        this.selection = this.host.createSelectionManager();",
    "        this.svg = document.createElementNS(SVG_NS, \"svg\");",
    "        options.element.appendChild(this.svg);",
    "        this.svg.addEventListener(\"contextmenu\", (e: MouseEvent) => {",
    "            this.selection.showContextMenu({}, { x: e.clientX, y: e.clientY });",
    "            e.preventDefault();",
    "        });",
    "    }",
    "",
    "    public update(options: VisualUpdateOptions): void {",
    "        this.host.eventService.renderingStarted(options);",
    "        try {",
    "            const dv = options.dataViews?.[0];",
    "            this.settings = this.formatting.populateFormattingSettingsModel(VisualFormattingSettingsModel, dv);",
    "            const cat = dv?.categorical?.categories?.[0];",
    "            const val = dv?.categorical?.values?.find(v => v.source.roles?.[\"measure\"]);",
    "            this.svg.replaceChildren();",
    "            if (!cat || !val) {                                    // landing page, plain text",
    "                const t = document.createElementNS(SVG_NS, \"text\");",
    "                t.setAttribute(\"x\", \"8\"); t.setAttribute(\"y\", \"20\"); t.setAttribute(\"fill\", this.ink());",
    "                t.textContent = \"Add a Category and a Measure\";",
    "                this.svg.appendChild(t);",
    "            } else {",
    "                this.render(cat.values.map((c, i) => ({",
    "                    label: String(c ?? \"(Blank)\"),",
    "                    value: Number(val.values[i] ?? 0),",
    "                    id: this.host.createSelectionIdBuilder().withCategory(cat, i).createSelectionId()",
    "                })), options.viewport.width, options.viewport.height);",
    "            }",
    "            this.host.eventService.renderingFinished(options);",
    "        } catch (e) {",
    "            this.host.eventService.renderingFailed(options, String(e));",
    "        }",
    "    }",
    "",
    "    private render(bars: Bar[], width: number, height: number): void {",
    "        const p = this.host.colorPalette;",
    "        const fill = p.isHighContrast ? p.foreground.value : (this.settings.dataPointCard.defaultColor.value.value || \"#118DFF\");",
    "        const max = bars.reduce((m, b) => Math.max(m, b.value), 1);    // no spread: safe for any row count",
    "        const labelW = 90, rowH = Math.max(14, Math.min(28, height / Math.max(1, bars.length)));",
    "        this.svg.setAttribute(\"width\", String(width));",
    "        this.svg.setAttribute(\"height\", String(height));",
    "        bars.forEach((b, i) => {",
    "            const g = document.createElementNS(SVG_NS, \"g\");",
    "            g.setAttribute(\"tabindex\", \"0\");",
    "            g.setAttribute(\"aria-label\", `${b.label}: ${b.value}`);",
    "            const text = document.createElementNS(SVG_NS, \"text\");",
    "            text.setAttribute(\"x\", \"4\"); text.setAttribute(\"y\", String(i * rowH + rowH * 0.7));",
    "            text.setAttribute(\"fill\", this.ink());                   // SVG text defaults to black",
    "            text.textContent = b.label;                            // never innerHTML",
    "            const rect = document.createElementNS(SVG_NS, \"rect\");",
    "            rect.setAttribute(\"x\", String(labelW)); rect.setAttribute(\"y\", String(i * rowH + 2));",
    "            rect.setAttribute(\"height\", String(rowH - 4));",
    "            rect.setAttribute(\"width\", String(Math.max(0, (width - labelW - 8) * b.value / max)));",
    "            rect.setAttribute(\"fill\", fill);",
    "            g.append(text, rect);",
    "            const select = (multi: boolean) => {",
    "                if (this.host.hostCapabilities.allowInteractions) { void this.selection.select(b.id, multi); }",
    "            };",
    "            g.addEventListener(\"click\", (e: MouseEvent) => select(e.ctrlKey || e.metaKey));",
    "            g.addEventListener(\"keydown\", (e: KeyboardEvent) => { if (e.key === \"Enter\" || e.key === \" \") select(e.ctrlKey); });",
    "            g.addEventListener(\"contextmenu\", (e: MouseEvent) => {",
    "                this.selection.showContextMenu(b.id, { x: e.clientX, y: e.clientY });",
    "                e.preventDefault(); e.stopPropagation();",
    "            });",
    "            g.addEventListener(\"mousemove\", (e: MouseEvent) => this.host.tooltipService.show({",
    "                coordinates: [e.clientX, e.clientY], isTouchEvent: false,",
    "                dataItems: [{ displayName: b.label, value: String(b.value) }], identities: [b.id]",
    "            }));",
    "            g.addEventListener(\"mouseleave\", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));",
    "            this.svg.appendChild(g);",
    "        });",
    "    }",
    "",
    "    private ink(): string {                                       // readable in high-contrast themes",
    "        const p = this.host.colorPalette;",
    "        return p.isHighContrast ? p.foreground.value : \"#252423\";",
    "    }",
    "",
    "    public getFormattingModel(): powerbi.visuals.FormattingModel {",
    "        return this.formatting.buildFormattingModel(this.settings);",
    "    }",
    "}",
  ]);

  // ------------------------------------------------------------------ scanner (port of scan_visuals.py)
  const SCAN = (() => {
    const ALLOWED = /^(?:https:\/\/developer\.microsoft\.com\/json-schemas\/|https:\/\/vega\.github\.io\/schema\/|http:\/\/www\.w3\.org\/2000\/svg)/i;
    const RULES = [
      ["external URL", /\b(?:https?|wss?|ftp):\/\/[^\s'"<>)\\]+|(?<=['"(=])\/\/[\p{L}\p{N}_\-]+(?:\.[\p{L}\p{N}_\-]+)+[^\s'"<>)\\]*/giu],
      ["active content", /<\s*(?:script|iframe|object|embed|foreignObject|use)\b|javascript:|xlink:href|<[a-zA-Z][\p{L}\p{N}_:.\-]*[\s\/][^<>]*?\bon[a-z]+\s*=/giu],
      ["remote CSS", /@import|url\((?!\s*\\?['"]?(?:#|data:image\/))/giu],
      ["dynamic code", /\beval\s*\(|new\s+Function\s*\(|\.(?:inner|outer)HTML\s*\+?=|insertAdjacentHTML|dangerouslySetInnerHTML|\.html\s*\(|set(?:Timeout|Interval)\s*\(\s*['"`]/giu],
      ["remote data/link key", /\\?"(?:url|href)\\?"\s*:(?!\s*\\?"data:image\/)/giu],
      ["network privilege", /WebAccess|XMLHttpRequest|\bfetch\s*\(|WebSocket/giu],
      ["pre-encoded colour", /%23[0-9a-f]{3,8}\b/giu],
    ];
    const EXT = new Set([".json", ".dax", ".tmdl", ".svg", ".html", ".css", ".less", ".ts", ".tsx", ".js", ".jsx", ".py", ".r", ".txt", ".md"]);
    const SKIP_DIRS = new Set(["node_modules", ".tmp", "dist", ".git", ".vscode", ".pbi"]);
    const SKIP_FILES = new Set(["package-lock.json"]);
    const META_KEYS = /"(?:supportUrl|gitHubUrl|\$schema)"\s*:/u;

    const suffix = (n) => { const i = n.lastIndexOf("."); return i > 0 && i < n.length - 1 ? n.slice(i).toLowerCase() : ""; };
    const base = (p) => p.split(/[\\/]/).pop();
    const eligible = (fileName) => EXT.has(suffix(fileName)) && !SKIP_FILES.has(fileName) && !fileName.startsWith("webpack.statistics");

    function decode(bytes) {                                   // UTF-8 (BOM tolerated) or UTF-16 with BOM; universal newlines
      let t;
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) t = new TextDecoder("utf-16le").decode(bytes);
      else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) t = new TextDecoder("utf-16be").decode(bytes);
      else t = new TextDecoder("utf-8").decode(bytes);
      return t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    function scanText(t, fileName) {
      const measures = [".dax", ".tmdl"].includes(suffix(base(fileName))) || base(fileName) === "reportExtensions.json";
      const hits = [];
      for (const [rule, rx] of RULES) {
        if (rule === "pre-encoded colour" && !measures) continue;
        rx.lastIndex = 0;
        for (const m of t.matchAll(rx)) {
          const start = m.index;
          const lineStart = start === 0 ? 0 : t.lastIndexOf("\n", start - 1) + 1;
          const nl = t.indexOf("\n", start);
          const line = t.slice(lineStart, nl === -1 ? t.length : nl);
          if (rule === "external URL" && (ALLOWED.test(m[0]) || META_KEYS.test(line))) continue;
          let n = 1;
          for (let i = t.indexOf("\n"); i !== -1 && i < start; i = t.indexOf("\n", i + 1)) n++;
          hits.push({ file: fileName, line: n, rule, match: Array.from(m[0]).slice(0, 80).join("") });
        }
      }
      return hits;
    }
    return { scanText, decode, eligible, SKIP_DIRS, EXT, RULES };
  })();

  // ------------------------------------------------------------------ recommendation (technology ladder)
  const TASKS = {
    compare: "Compare or rank categories",
    trend: "Trend over time",
    target: "Actual vs target, plan or prior year",
    part: "Part of a whole",
    distribution: "Distribution of values",
    relationship: "Relationship between two measures",
    bridge: "Bridge or change breakdown",
    status: "Status at a glance",
    text: "Formatted text or narrative",
  };
  const PLACES = { standalone: "A chart of its own", incell: "Inside table or matrix rows", card: "In a card or KPI tile" };
  const AVOID = {
    compare: "unsorted bars and pies",
    trend: "stacked areas with many series",
    target: "gauges for many items",
    part: "pies or donuts beyond about 5 slices, and 3D",
    distribution: "showing only averages",
    relationship: "dual axes without clear labels",
    bridge: "stacked columns",
    status: "traffic lights without text",
    text: "images of text",
  };

  function recommend(a) {
    const task = oneOf(a.task, "Task", Object.keys(TASKS));
    const place = oneOf(a.place, "Placement", Object.keys(PLACES));
    const r = (rung, tech, chart, generator, why, notes = []) => ({ rung, technology: tech, chart, generator, why, notes, avoid: AVOID[task] });
    const RUNG = ["", "Native visual", "SVG measure in a native visual", "Deneb (certified)", "HTML Content Secure", "Custom visual (SDK)", "Python or R visual"];
    const native = (chart, gen, why, notes) => r(1, RUNG[1], chart, gen, why, notes);
    const extra = [];
    if (a.interactive && place === "incell") extra.push("SVG images have no per-mark tooltips or clicks. If that matters, use a Deneb chart beside the table.");

    if (a.reuse) {
      if (a.orgVisuals) return r(5, RUNG[5], "Your own reusable visual", "sdk", "The same custom chart is needed in many reports, so build it once with the Visuals SDK and publish it through the organizational store, with an owner and a review process.", extra);
      extra.push("Reuse across many reports usually calls for an org-store custom visual; ask your admin whether that is allowed.");
    }
    if (task === "text") {
      if (a.html) return r(4, RUNG[4], "Narrative KPI tile", "html:tile", "Rich text assembled from measures fits the certified HTML Content Secure visual (sanitised: no scripts, no external content).", extra);
      return native("New card or text box with dynamic values", null, "Without HTML Content Secure, use the new card visual or a text box with field values.", extra);
    }
    if (place === "incell") {
      if (task === "target") return r(2, RUNG[2], "Bullet chart in each row", "svg:bullet", "Actual vs target per row, on a common scale so rows compare.", extra);
      if (task === "trend") return r(2, RUNG[2], "Sparkline in each row", "svg:sparkline", "A rolling trend per row; keep the numbers in an adjacent column.", extra);
      if (task === "status") return r(2, RUNG[2], "Status pill in each row", "svg:status", "Text plus shape, so status never relies on colour alone.", extra);
      if (task === "part") return r(2, RUNG[2], "Progress bar in each row", "svg:progress", "Share of a target or total, with the percentage as text.", extra);
      if (task === "compare") return native("Table or matrix with data bars", "native:tableEx", "Built-in data bars (conditional formatting) compare rows without any custom code; use the bullet SVG when there is a target.", extra);
      extra.push("This kind of chart does not fit inside a row; consider a chart of its own.");
    }
    if (place === "card") {
      if (task === "trend") return r(2, RUNG[2], "New card with a sparkline image", "svg:sparkline", "Use the new card's image setting (Image URL from a field) for the sparkline measure.", extra);
      if (task === "status") return r(2, RUNG[2], "New card with a status pill", "svg:status", "Use the new card's image setting (Image URL from a field) for the status measure.", extra);
      if (task === "target") return native("KPI visual or new card with target", "native:cardVisual", "Built-in KPI and new card visuals show actual vs target with trend and conditional colour.", extra);
      return native("New card (multi-value)", "native:cardVisual", "The new card visual shows several measures with reference labels.", extra);
    }
    switch (task) {
      case "compare":
        if (a.manyItems && a.deneb) return r(3, RUNG[3], "Ranked lollipop", "deneb:lollipop", "Many items rank more legibly as a lollipop, with tooltips, cross-filtering and cross-highlighting in the certified Deneb visual.", extra);
        return native("Sorted horizontal bar chart", "native:clusteredBarChart", "A sorted bar chart answers ranking questions with no custom code; label bars directly.", extra);
      case "trend":
        return native("Line chart (column chart for 12 or fewer periods)", "native:lineChart", "The built-in line chart handles time axes, tooltips and drill-down.", extra);
      case "target":
        if (a.deneb) return r(3, RUNG[3], "Actual vs prior year with variance % (IBCS style)", "deneb:variance", "Actual dark, prior year grey and coloured variance labels are not possible in a native visual; Deneb does it with full interactivity.", extra);
        return native("Clustered bar with actual and target, or the KPI visual", "native:clusteredBarChart", "Without Deneb, compare actual and target bars side by side, or use the built-in KPI visual.", extra);
      case "part":
        return native("100% stacked bar (5 parts or fewer) or treemap", null, "Use the built-in 100% stacked bar or treemap; keep slices to about five.", extra);
      case "distribution":
        if (a.deneb) return r(3, RUNG[3], "Box or strip plot", null, "Deneb draws distributions with interactivity. This app has no distribution template yet: start from a reviewed Deneb example and keep the safety rules.", extra);
        if (a.python) return r(6, RUNG[6], "Box plot with jittered points", "python:boxplot", "Python visuals are static images and run code on your PC; use only because nothing else is allowed.", extra);
        return native("Histogram with a binned column chart", "native:clusteredColumnChart", "Create bins (Group > New group > Bin) and plot counts in a column chart.", extra);
      case "relationship":
        return native("Scatter chart (with trend line)", null, "Use the built-in scatter chart with a trend line from the Analytics pane.", extra);
      case "bridge":
        return native("Waterfall chart", null, "The built-in waterfall chart explains change between two points.", extra);
      case "status":
        return native("New card or KPI visual", "native:cardVisual", "Show the number with its status in words; add an SVG status pill in tables.", extra);
      default:
        return native("Built-in visual", null, "Start with the built-in visual that fits.", extra);
    }
  }

  // ------------------------------------------------------------------ PBIP project (File System Access API handles)
  const notFound = (e) => e && (e.name === "NotFoundError" || e.name === "TypeMismatchError");

  async function getDir(dir, parts, create = false) {
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return dir;
  }
  async function listDir(dir) {
    const out = [];
    for await (const [entryName, handle] of dir.entries()) out.push({ name: entryName, kind: handle.kind, handle });
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  async function readBytes(fileHandle) {
    return new Uint8Array(await (await fileHandle.getFile()).arrayBuffer());
  }
  async function readText(dir, parts) {
    const d = await getDir(dir, parts.slice(0, -1));
    return SCAN.decode(await readBytes(await d.getFileHandle(parts[parts.length - 1])));
  }
  async function readRaw(dir, parts) {                         // exact text, no newline normalisation
    const d = await getDir(dir, parts.slice(0, -1));
    const bytes = await readBytes(await d.getFileHandle(parts[parts.length - 1]));
    return new TextDecoder("utf-8").decode(bytes);
  }
  async function tryJson(dir, parts) {
    try { return JSON.parse(await readText(dir, parts)); } catch (e) { if (notFound(e)) return null; throw e; }
  }
  async function writeText(dir, parts, content) {
    const d = await getDir(dir, parts.slice(0, -1), true);
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  async function findReports(root) {
    const reports = [];
    for (const e of await listDir(root)) {
      if (e.kind !== "directory" || !/\.Report$/i.test(e.name)) continue;
      const sub = await listDir(e.handle);
      const hasDef = sub.some((s) => s.kind === "directory" && s.name === "definition");
      const legacy = sub.some((s) => s.kind === "file" && s.name === "report.json");
      reports.push({ name: e.name, dir: e.handle, format: hasDef ? "pbir" : legacy ? "legacy" : "unknown" });
    }
    return reports;
  }

  async function loadVisuals(pagesDir, pageId) {
    let vdir;
    try { vdir = await getDir(pagesDir, [pageId, "visuals"]); } catch (e) { if (notFound(e)) return []; throw e; }
    const out = [];
    for (const e of await listDir(vdir)) {
      if (e.kind !== "directory") continue;
      const v = await tryJson(e.handle, ["visual.json"]);
      if (!v) continue;
      const p = v.position || {};
      out.push({ name: e.name, schema: v.$schema, visualType: v.visual?.visualType ?? (v.visualGroup ? "(group)" : ""),
                 x: +p.x || 0, y: +p.y || 0, w: +p.width || 0, h: +p.height || 0, z: +p.z || 0, tab: +p.tabOrder || 0 });
    }
    return out;
  }

  async function loadReport(report) {
    const def = await report.dir.getDirectoryHandle("definition");
    const meta = (await tryJson(def, ["pages", "pages.json"])) ?? {};
    const pagesDir = await getDir(def, ["pages"]);
    const ids = (await listDir(pagesDir)).filter((e) => e.kind === "directory").map((e) => e.name);
    const listedOrder = Array.isArray(meta.pageOrder) ? meta.pageOrder : [];
    const order = [...listedOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !listedOrder.includes(id))];
    const pages = [];
    const schemas = new Map();
    let denebType = null;
    for (const id of order) {
      const page = await tryJson(pagesDir, [id, "page.json"]);
      if (!page) continue;
      const visuals = await loadVisuals(pagesDir, id);
      for (const v of visuals) {
        if (typeof v.schema === "string") schemas.set(v.schema, (schemas.get(v.schema) || 0) + 1);
        if (!denebType && typeof v.visualType === "string" && v.visualType.startsWith(DENEB_GUID)) denebType = v.visualType;
      }
      pages.push({ id, displayName: String(page.displayName ?? id), width: +page.width || 1280, height: +page.height || 720,
                   listed: listedOrder.includes(id), visuals });
    }
    const best = [...schemas.entries()].sort((a, b) => b[1] - a[1])[0];
    return { pages, visualSchema: best && SCHEMA_RE.test(best[0]) ? best[0] : null, denebType,
             hasReportJson: (await tryJson(def, ["report.json"])) !== null };
  }

  function placeRect(pageW, pageH, rects, w, h, margin = 16, gap = 8, step = 8) {
    const W = Math.min(w, pageW - 2 * margin), H = Math.min(h, pageH - 2 * margin);
    const free = (x, y) => !rects.some((r) => x < r.x + r.w + gap && x + W + gap > r.x && y < r.y + r.h + gap && y + H + gap > r.y);
    for (let y = margin; y + H <= pageH - margin; y += step) {
      for (let x = margin; x + W <= pageW - margin; x += step) if (free(x, y)) return { x, y, w: W, h: H, overlaps: false };
    }
    return { x: margin, y: margin, w: W, h: H, overlaps: true };
  }
  const nextOrder = (values) => (values.length ? Math.max(...values) + 1000 : 0);

  function reindent(original, obj) {                           // keep the file's indent, line ending and final newline
    const m = /\n([ \t]+)\S/.exec(original);
    const indent = m ? m[1] : "  ";
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const body = JSON.stringify(obj, null, indent).replace(/\n/g, eol);
    return /\r?\n$/.test(original) ? body + eol : body;
  }
  function stamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }
  const BACKUP_DIR = ".pbi-visual-builder-backups";

  // Adds one visual to a page. build(o) must return the visual.json object for the given position/name/schema.
  async function addVisual(root, o) {
    const report = (await findReports(root)).find((r) => r.name === o.reportName);
    if (!report) throw new InputError(`Report folder ${o.reportName} not found in the chosen folder.`);
    if (report.format !== "pbir") throw new InputError("This report is not saved in the PBIR format. Save it as PBIR in Power BI Desktop first.");
    const info = await loadReport(report);
    const page = info.pages.find((p) => p.id === o.pageId);
    if (!page) throw new InputError("Page not found; reopen the project.");
    const schema = info.visualSchema ?? schemaUrl(o.fallbackSchema);
    const pos = placeRect(page.width, page.height, page.visuals, o.width, o.height);
    const z = nextOrder(page.visuals.map((v) => v.z)), tab = nextOrder(page.visuals.map((v) => v.tab));
    const taken = new Set(page.visuals.map((v) => v.name));
    let vname = randomHex(20);
    while (taken.has(vname)) vname = randomHex(20);

    const def = await report.dir.getDirectoryHandle("definition");
    let visualType;
    let reportPlan = null;
    if (o.customVisual) {
      if (o.customVisual !== DENEB_GUID) throw new InputError("Only the certified Deneb visual can be registered by this app.");
      if (info.denebType) {
        visualType = info.denebType;                            // reuse the registration Desktop already made (AppSource or org store)
      } else {
        if (o.denebSource !== "appsource") {
          throw new InputError("Deneb is not in this report yet. Add one Deneb visual from your organizational store in Desktop, save, then try again (this app only registers the AppSource visual).");
        }
        const raw = await readRaw(def, ["report.json"]);
        if (/[:\[,]\s*-?\d{16,}/.test(raw)) throw new InputError("report.json holds very large numbers this app cannot rewrite safely; register Deneb in Desktop instead.");
        const rep = JSON.parse(raw);
        visualType = DENEB_GUID;
        const list = Array.isArray(rep.publicCustomVisuals) ? rep.publicCustomVisuals : [];
        if (!list.includes(DENEB_GUID)) {
          const next = { ...rep, publicCustomVisuals: [...list, DENEB_GUID] };   // existing key keeps its place
          reportPlan = { before: raw, after: reindent(raw, next) };
        }
      }
    }
    const visual = o.build({ schemaUrl: schema, name: vname, x: pos.x, y: pos.y, z, tab, w: pos.w, h: pos.h, visualType });
    const content = pretty(visual);
    const hits = SCAN.scanText(content, "visual.json");
    if (hits.length) throw new InputError(`Blocked by the safety scan: ${hits.map((h) => h.rule).join(", ")}.`);

    let backup = null;
    if (reportPlan) {
      const when = stamp(o.now ?? new Date());
      backup = [BACKUP_DIR, when, report.name, "definition", "report.json"];
      await writeText(root, backup, reportPlan.before);
      if ((await readRaw(root, backup)) !== reportPlan.before) throw new Error("Backup check failed; nothing was changed.");
    }
    const vparts = ["pages", page.id, "visuals", vname, "visual.json"];
    let createdVisualsDir = false;
    try { await getDir(def, ["pages", page.id, "visuals"]); } catch (e) { if (notFound(e)) createdVisualsDir = true; else throw e; }
    await writeText(def, vparts, content);
    if ((await readRaw(def, vparts)) !== content) {
      await removeVisualFolder(def, page.id, vname);
      throw new Error("visual.json did not read back correctly; it was removed again.");
    }
    if (reportPlan) {
      try {
        await writeText(def, ["report.json"], reportPlan.after);
        if ((await readRaw(def, ["report.json"])) !== reportPlan.after) throw new Error("report.json did not read back correctly.");
      } catch (e) {
        await writeText(def, ["report.json"], reportPlan.before);
        await removeVisualFolder(def, page.id, vname);
        throw new Error(`${e.message} The change was rolled back.`);
      }
    }
    return {
      report: report.name, pageId: page.id, page: page.displayName, name: vname,
      path: `${report.name}/definition/${vparts.join("/")}`,
      position: { x: pos.x, y: pos.y, w: pos.w, h: pos.h, z, tab }, overlaps: pos.overlaps,
      schemaUrl: schema, schemaFrom: info.visualSchema ? "project" : "fallback",
      visualType: visual.visual.visualType,
      reportChanged: !!reportPlan, backup: backup ? backup.join("/") : null, createdVisualsDir,
      written: { visual: content, report: reportPlan ? reportPlan.after : null, reportBefore: reportPlan ? reportPlan.before : null },
    };
  }

  async function removeVisualFolder(def, pageId, vname) {
    const vdir = await getDir(def, ["pages", pageId, "visuals"]);
    await vdir.removeEntry(vname, { recursive: true });
  }

  async function undoAdd(root, s) {
    const report = (await findReports(root)).find((r) => r.name === s.report);
    if (!report) throw new InputError("Report folder not found.");
    const def = await report.dir.getDirectoryHandle("definition");
    const vparts = ["pages", s.pageId, "visuals", s.name, "visual.json"];
    let current;
    try { current = await readRaw(def, vparts); } catch (e) { if (notFound(e)) current = null; else throw e; }
    if (current !== null && current !== s.written.visual) throw new InputError("The visual was changed after it was added (probably by Desktop); undo it in Desktop instead.");
    if (s.reportChanged) {
      const now = await readRaw(def, ["report.json"]);
      if (now !== s.written.report) throw new InputError("report.json changed after the visual was added; restore it from the backup by hand if needed.");
    }
    if (current !== null) await removeVisualFolder(def, s.pageId, s.name);
    if (s.createdVisualsDir) {                                  // leave the page folder as it was
      const pdir = await getDir(def, ["pages", s.pageId]);
      const vdir = await pdir.getDirectoryHandle("visuals");
      if ((await listDir(vdir)).length === 0) await pdir.removeEntry("visuals");
    }
    if (s.reportChanged) await writeText(def, ["report.json"], s.written.reportBefore);
    return true;
  }

  async function collectFiles(dir, prefix = []) {
    const out = [];
    for (const e of await listDir(dir)) {
      if (e.kind === "directory") {
        if (!SCAN.SKIP_DIRS.has(e.name)) out.push(...(await collectFiles(e.handle, [...prefix, e.name])));
      } else if (SCAN.eligible(e.name)) {
        out.push({ path: [...prefix, e.name].join("/"), handle: e.handle });
      }
    }
    return out;
  }
  async function scanFolder(dir) {
    const files = await collectFiles(dir);
    const hits = [];
    for (const f of files) hits.push(...SCAN.scanText(SCAN.decode(await readBytes(f.handle)), f.path));
    return { files: files.length, hits };
  }

  return {
    VERSION, InputError, DEFAULTS, NUMBER_FORMATS, NATIVE_TYPES, TASKS, PLACES, DENEB_GUID, DENEB_CONFIG, SCHEMA_PREFIX,
    svgBullet, svgProgress, svgSparkline, svgStatus, SVG_ESCAPE_UDF, htmlKpiTile, pythonBoxplot,
    denebChart, denebTemplate, denebVisual, lollipopSpec, varianceSpec,
    nativeSpec, nativeVisual, pretty, schemaUrl, randomHex,
    SDK_COMMANDS, SDK_CAPABILITIES, SDK_VISUAL_TS,
    scanText: SCAN.scanText, decode: SCAN.decode, eligible: SCAN.eligible, SKIP_DIRS: SCAN.SKIP_DIRS,
    recommend, findReports, loadReport, placeRect, addVisual, undoAdd, scanFolder, reindent,
  };
})();
if (typeof module !== "undefined") module.exports = PBI;
