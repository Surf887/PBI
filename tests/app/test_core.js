// Core tests for the offline app: templates, validation, scanner parity, recommendations, PBIP writer.
// usage: node tests/app/test_core.js <core.js> <skill references dir> <python scanner> <scanner cases dir> <sample pbip dir> <out dir>
// Optional: PBIR_SCHEMAS = folder fabric/item/report/definition of a microsoft/json-schemas clone; PYTHON = python executable.
"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");

const [corePath, refDir, pyScanner, casesDir, sampleDir, outDir] = process.argv.slice(2);
const PBI = require(path.resolve(corePath));
const PY = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const SCHEMAS = process.env.PBIR_SCHEMAS;
let skips = 0;
function skip(label, why) { skips++; console.log(`SKIP ${label} (${why})`); }
function listTree(dir, exclude, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (exclude.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(path.relative(base, p) + "/", ...listTree(p, exclude, base));
    else out.push(path.relative(base, p) + " " + require("node:crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
  }
  return out.sort();
}
let fails = 0, passes = 0;
function check(label, fn) {
  try { fn(); passes++; console.log("PASS " + label); }
  catch (e) { fails++; console.log("FAIL " + label + "\n     " + String(e.message).split("\n").slice(0, 6).join("\n     ")); }
}
async function checkAsync(label, fn) {
  try { await fn(); passes++; console.log("PASS " + label); }
  catch (e) { fails++; console.log("FAIL " + label + "\n     " + String(e.stack || e.message).split("\n").slice(0, 6).join("\n     ")); }
}

// ---------- code blocks from the tested skill reference files
function blocks(file) {
  const t = fs.readFileSync(path.join(refDir, file), "utf8");
  const out = [];
  const rx = /^```([^\n]*)\n([\s\S]*?)^```\s*$/gm;
  for (const m of t.matchAll(rx)) out.push({ lang: m[1].trim(), body: m[2] });
  return out;
}
const svgB = blocks("svg-measures.md"), denB = blocks("deneb.md"), pbirB = blocks("pbir-native.md");
const hpB = blocks("html-and-python.md"), sdkB = blocks("custom-visual-sdk.md");
const find = (list, needle) => { const b = list.find((x) => x.body.includes(needle)); assert.ok(b, "block not found: " + needle); return b.body; };

// ---------- 1. templates reproduced exactly with default inputs
check("SVG A bullet = tested template", () => assert.equal(PBI.svgBullet({}), find(svgB, "Bullet SVG =")));
check("SVG B progress = tested template", () => assert.equal(PBI.svgProgress({}), find(svgB, "Progress SVG =")));
check("SVG C sparkline = tested template", () => assert.equal(PBI.svgSparkline({}), find(svgB, "Sparkline SVG =")));
check("SVG D status = tested template", () => assert.equal(PBI.svgStatus({}), find(svgB, "Status SVG =")));
check("SVG E escaping UDF = tested template", () => assert.equal(PBI.SVG_ESCAPE_UDF, find(svgB, "FUNCTION SvgEscapeText")));
check("HTML KPI tile = tested template", () => assert.equal(PBI.htmlKpiTile({}), find(hpB, "KPI Tile HTML =")));
check("Python box plot = tested template", () => assert.equal(PBI.pythonBoxplot({}), find(hpB, "import matplotlib")));
check("SDK commands = tested block", () => assert.equal(PBI.SDK_COMMANDS, find(sdkB, "powerbi-visuals-tools@7.2.1 new")));
check("SDK capabilities = tested block", () => assert.equal(PBI.SDK_CAPABILITIES, find(sdkB, "\"privileges\": []")));
check("SDK visual.ts = tested block", () => assert.equal(PBI.SDK_VISUAL_TS, find(sdkB, "export class Visual")));
check("Deneb lollipop spec = tested Spec 1", () => {
  const c = PBI.denebChart("lollipop", { category: "Region[Category]", value: "Sales[Sales]" });
  assert.deepEqual(c.spec, JSON.parse(find(denB, "datum['Sales__highlightStatus']")));
});
check("Deneb variance spec = tested Spec 2", () => {
  const c = PBI.denebChart("variance", { category: "Region[Category]", actual: "Sales[Actual]", prior: "Sales[PY]" });
  assert.deepEqual(c.spec, JSON.parse(find(denB, "\"as\": \"Variance %\"")));
});
check("Deneb config = tested config", () => assert.deepEqual(PBI.DENEB_CONFIG, JSON.parse(find(denB, "\"font\": \"Segoe UI\""))));
check("Native bar visual.json = tested template", () => {
  const s = PBI.nativeSpec({ visualType: "clusteredBarChart", category: "Region[Region]", values: "Sales[Sales Amount]",
                             title: "East leads; West is 52% below the leader", sort: "value" });
  const v = PBI.nativeVisual(s, { schemaUrl: PBI.schemaUrl("2.9.0"), name: "3f9a1c7e5b2d4a6c8e01", x: 24, y: 96, z: 1000, h: 320, w: 560, tab: 1000 });
  assert.deepEqual(v, JSON.parse(find(pbirB, "\"visualType\": \"clusteredBarChart\"")));
});

// Deneb visual.json must equal what the skill's Python builder produces for the same input.
check("Deneb visual.json = skill's Python builder output (byte for byte)", () => {
  const builder = find(denB, "def deneb_visual(");
  const c = PBI.denebChart("lollipop", { category: "Region[Category]", value: "Sales[Sales]" });
  const schema = PBI.schemaUrl("2.13.0");
  const py = builder + `
import sys
spec = json.loads(sys.stdin.read())
fields = [projection("Region", "Column", "Category"), projection("Sales", "Measure", "Sales")]
config = json.loads(${JSON.stringify(JSON.stringify(PBI.DENEB_CONFIG))})
v = deneb_visual(spec, config, fields, "${schema}", x=40, y=60, w=500, h=300, z=2000, tab=3000)
v["name"] = "0123456789abcdef0123"
sys.stdout.write(json.dumps(v, indent=2, ensure_ascii=False) + "\\n")
`;
  const r = spawnSync(PY, ["-I", "-c", py], { input: JSON.stringify(c.spec), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const js = PBI.pretty(PBI.denebVisual(c, { schemaUrl: schema, name: "0123456789abcdef0123", x: 40, y: 60, w: 500, h: 300, z: 2000, tab: 3000 }));
  assert.equal(js, r.stdout);
});

// ---------- 2. custom inputs change only the intended tokens
function swapBack(out, pairs) { let t = out; for (const [a, b] of pairs) t = t.split(a).join(b); return t; }
check("SVG bullet with custom names: only names, width and colours change", () => {
  const out = PBI.svgBullet({ name: "Margin Bullet", actual: "[Gross Margin]", target: "Finance[Margin Target]", row: "'Product Category'[Category Name]", width: 160, good: "#107c10", bad: "#a4262c" });
  assert.equal(swapBack(out, [["Margin Bullet", "Bullet SVG"], ["[Gross Margin]", "[Sales Amount]"], ["[Margin Target]", "[Sales Target]"],
    ["'Product Category'[Category Name]", "'Region'[Region]"], ["VAR _W = 160", "VAR _W = 120"], ["#107C10", "#1AAB40"], ["#A4262C", "#D64554"]]), PBI.svgBullet({}));
});
check("SVG progress with custom names", () => {
  const out = PBI.svgProgress({ name: "Plan Progress", actual: "Orders", target: "Order Plan", barWidth: 100, done: "#107C10", open: "#0078D4" });
  assert.equal(swapBack(out, [["Plan Progress", "Progress SVG"], ["[Orders]", "[Sales Amount]"], ["[Order Plan]", "[Sales Target]"],
    ["VAR _BarMax = 100", "VAR _BarMax = 140"], ["#107C10", "#1AAB40"], ["#0078D4", "#118DFF"]]), PBI.svgProgress({}));
});
check("SVG sparkline with custom date table and 24 months", () => {
  const out = PBI.svgSparkline({ name: "Trend 24M", value: "Revenue", dateTable: "Calendar", dateColumn: "Day", monthColumn: "Month Begin", months: 24, width: 150, height: 30, color: "#E66C37" });
  assert.equal(swapBack(out, [["Trend 24M", "Sparkline SVG"], ["[Revenue]", "[Sales Amount]"], ["'Calendar'[Day]", "'Date'[Date]"],
    ["'Calendar'[Month Begin]", "'Date'[Month Start]"], ["REMOVEFILTERS ( 'Calendar' )", "REMOVEFILTERS ( 'Date' )"], ["-24, MONTH", "-12, MONTH"],
    ["VAR _W = 150", "VAR _W = 120"], ["VAR _H = 30", "VAR _H = 28"], ["#E66C37", "#118DFF"]]), PBI.svgSparkline({}));
});
check("SVG status with custom labels and 10% band", () => {
  const out = PBI.svgStatus({ name: "Delivery Status", actual: "Delivered", target: "Committed", atRiskPct: 10, onTrack: "OK", atRisk: "Watch", behind: "Late" });
  assert.match(out, /_Gap >= -0\.1, "Watch", "Late"/);
  assert.equal(swapBack(out, [["Delivery Status", "Status SVG"], ["[Delivered]", "[Sales Amount]"], ["[Committed]", "[Sales Target]"],
    ["_Gap >= -0.1,", "_Gap >= -0.05,"], ["\"OK\"", "\"On track\""], ["\"Watch\"", "\"At risk\""], ["\"Late\"", "\"Behind\""]]), PBI.svgStatus({}));
});
check("At-risk band formatting avoids float noise", () => {
  for (const [p, want] of [[1.1, "-0.011"], [2.5, "-0.025"], [33.3, "-0.333"], [50, "-0.5"]]) {
    assert.match(PBI.svgStatus({ atRiskPct: p }), new RegExp(`_Gap >= ${want.replace(".", "\\.")}, `));
  }
});
check("Python script with other columns: only names change", () => {
  const out = PBI.pythonBoxplot({ category: "Plant", value: "Downtime Hours" });
  assert.ok(out.startsWith("# Python visual: downtime-hours distribution by plant"));
  assert.ok(out.includes('ax.set_xlabel("Downtime hours")'));
  assert.equal(swapBack(out, [["downtime-hours distribution by plant", "order-value distribution by region"], ["\"Plant\"", "\"Region\""],
    ["\"Downtime Hours\"", "\"Order Value\""], ["\"Downtime hours\"", "\"Order value\""]]), PBI.pythonBoxplot({}));
});
check("Deneb field names: dots become underscores, quotes escaped in expressions", () => {
  const c = PBI.denebChart("lollipop", { category: "Geo[Region.Name]", value: "Sales[Sales Amount]" });
  assert.equal(c.spec.encoding.y.field, "Region_Name");
  assert.equal(c.spec.transform[0].calculate, "datum['Sales Amount__highlightStatus'] == 'off' || datum['__selected__'] == 'off' ? 0.3 : 1");
  assert.equal(c.projections[0].nativeQueryRef, "Region.Name");
});

// ---------- 3. input validation blocks injection
const bad = [
  ["measure name with quote", () => PBI.svgBullet({ name: 'X" & "<script>' })],
  ["column with bracket", () => PBI.svgBullet({ row: "Region[Reg]ion]" })],
  ["missing table", () => PBI.svgBullet({ row: "Region" })],
  ["colour not hex", () => PBI.svgBullet({ good: "red" })],
  ["colour with injection", () => PBI.svgBullet({ good: "#1AAB40' onload='x" })],
  ["width out of range", () => PBI.svgBullet({ width: 5000 })],
  ["same actual and target", () => PBI.svgProgress({ actual: "A", target: "A" })],
  ["label with angle bracket", () => PBI.svgStatus({ onTrack: "<b>ok</b>" })],
  ["label too long", () => PBI.svgStatus({ onTrack: "On track nicely" })],
  ["duplicate labels", () => PBI.svgStatus({ onTrack: "OK", atRisk: "OK" })],
  ["html all-text with quote", () => PBI.htmlKpiTile({ allText: 'All" & x' })],
  ["unknown number format", () => PBI.htmlKpiTile({ format: "0;evil" })],
  ["python column with quote", () => PBI.pythonBoxplot({ category: 'Region", os.system("x' })],
  ["deneb reserved field", () => PBI.denebChart("variance", { actual: "Sales[Variance]" })],
  ["deneb field starting with __", () => PBI.denebChart("lollipop", { value: "Sales[__selected__]" })],
  ["deneb duplicate fields", () => PBI.denebChart("lollipop", { category: "A[Sales]", value: "B[Sales]" })],
  ["native: series with two measures", () => PBI.nativeSpec({ visualType: "lineChart", category: "D[Month]", values: "S[A]\nS[B]", series: "R[Region]" })],
  ["native: unknown visual type", () => PBI.nativeSpec({ visualType: "scriptVisual" })],
  ["native: title with angle bracket", () => PBI.nativeSpec({ visualType: "cardVisual", values: "S[A]", title: "<img src=x>" })],
  ["native: image size half given", () => PBI.nativeSpec({ visualType: "tableEx", columns: "R[Region]", imageHeight: 24 })],
  ["schema URL elsewhere", () => PBI.schemaUrl("https://evil.example/schema.json")],
];
for (const [label, fn] of bad) check(`rejects ${label}`, () => assert.throws(fn, PBI.InputError));

// ---------- 4. every generated output passes the scanner
check("all generated outputs scan clean", () => {
  const outs = [
    ["bullet.dax", PBI.svgBullet({})], ["progress.dax", PBI.svgProgress({})], ["sparkline.dax", PBI.svgSparkline({})],
    ["status.dax", PBI.svgStatus({})], ["udf.dax", PBI.SVG_ESCAPE_UDF], ["tile.dax", PBI.htmlKpiTile({})], ["box.py", PBI.pythonBoxplot({})],
    ["spec.json", PBI.pretty(PBI.denebChart("lollipop", {}).spec)], ["variance.json", PBI.pretty(PBI.denebChart("variance", {}).spec)],
    ["template.json", PBI.pretty(PBI.denebTemplate("lollipop", {}))], ["template2.json", PBI.pretty(PBI.denebTemplate("variance", {}))],
    ["visual.json", PBI.pretty(PBI.denebVisual(PBI.denebChart("variance", {}), { schemaUrl: PBI.schemaUrl("2.9.0"), name: "a".repeat(20), x: 0, y: 0, z: 0, w: 1, h: 1, tab: 0 }))],
    ["capabilities.json", PBI.SDK_CAPABILITIES], ["visual.ts", PBI.SDK_VISUAL_TS],
  ];
  const hits = outs.flatMap(([n, t]) => PBI.scanText(t, n));
  assert.deepEqual(hits, []);
});

// ---------- 5. Deneb template structure
check("Deneb templates: placeholders, fresh UUID, config string", () => {
  for (const kind of ["lollipop", "variance"]) {
    const t = PBI.denebTemplate(kind, {});
    const u = t.usermeta;
    assert.match(u.information.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(typeof u.config, "string");
    assert.deepEqual(JSON.parse(u.config), PBI.DENEB_CONFIG);
    assert.equal(u.deneb.metaVersion, 2);
    const s = JSON.stringify(t);
    for (const d of u.datasets.dataset) { assert.ok(d.key.length <= 30); assert.ok(s.includes(`"field":"${d.key}"`)); }
    assert.ok(!s.includes("Sales Amount"), "real field names must not leak into a template");
    assert.notEqual(PBI.denebTemplate(kind, {}).usermeta.information.uuid, u.information.uuid);
  }
});

// ---------- 6. recommendations
const rec = (a) => PBI.recommend({ interactive: false, manyItems: false, reuse: false, deneb: true, html: true, orgVisuals: false, python: false, ...a });
const cases = [
  [{ task: "target", place: "incell" }, "svg:bullet"], [{ task: "trend", place: "incell" }, "svg:sparkline"],
  [{ task: "status", place: "incell" }, "svg:status"], [{ task: "part", place: "incell" }, "svg:progress"],
  [{ task: "compare", place: "incell" }, "native:tableEx"], [{ task: "compare", place: "standalone" }, "native:clusteredBarChart"],
  [{ task: "compare", place: "standalone", manyItems: true }, "deneb:lollipop"], [{ task: "compare", place: "standalone", manyItems: true, deneb: false }, "native:clusteredBarChart"],
  [{ task: "target", place: "standalone" }, "deneb:variance"], [{ task: "target", place: "standalone", deneb: false }, "native:clusteredBarChart"],
  [{ task: "trend", place: "standalone" }, "native:lineChart"], [{ task: "text", place: "card" }, "html:tile"],
  [{ task: "text", place: "card", html: false }, null], [{ task: "distribution", place: "standalone", deneb: false, python: true }, "python:boxplot"],
  [{ task: "distribution", place: "standalone", deneb: false }, "native:clusteredColumnChart"], [{ task: "compare", place: "standalone", reuse: true, orgVisuals: true }, "sdk"],
  [{ task: "trend", place: "card" }, "svg:sparkline"], [{ task: "bridge", place: "incell" }, null],
];
for (const [a, want] of cases) check(`recommend ${a.task}/${a.place}${a.deneb === false ? " (no Deneb)" : ""} -> ${want}`, () => assert.equal(rec(a).generator, want));
check("recommend notes the missing tooltips for in-cell SVG", () => assert.ok(rec({ task: "target", place: "incell", interactive: true }).notes.length === 1));

// ---------- 7. scanner parity with the Python scanner on all regression cases
check("JS scanner = Python scanner on every regression case", () => {
  const expected = JSON.parse(fs.readFileSync(path.join(path.dirname(casesDir), "expected.json"), "utf8"));
  const mismatches = [];
  for (const rel of Object.keys(expected)) {
    const f = path.join(casesDir, rel);
    const r = spawnSync(PY, ["-I", pyScanner, f], { encoding: "utf8" });
    const pyHits = r.stdout.trim().startsWith("clean") ? [] : r.stdout.trim().split("\n").map((l) => {
      const m = /^(.*?):(\d+): ([^:]+): (.*)$/.exec(l); return `${m[2]}|${m[3]}|${m[4].trimEnd()}`;
    });
    const jsHits = PBI.scanText(PBI.decode(new Uint8Array(fs.readFileSync(f))), rel).map((h) => `${h.line}|${h.rule}|${h.match.trimEnd()}`);
    if (JSON.stringify(pyHits) !== JSON.stringify(jsHits)) mismatches.push(`${rel}: py=${JSON.stringify(pyHits)} js=${JSON.stringify(jsHits)}`);
    if ((jsHits.length > 0) !== (expected[rel] === "hit")) mismatches.push(`${rel}: expected ${expected[rel]}`);
  }
  assert.deepEqual(mismatches, []);
  console.log(`     (${Object.keys(expected).length} cases)`);
});
check("JS scanner reads UTF-16 and CRLF like the Python scanner", () => {
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('M = "<svg><script>x()</script></svg>"\r\nN = 1\r\n', "utf16le")]);
  const h = PBI.scanText(PBI.decode(new Uint8Array(u16)), "u16.dax");
  assert.equal(h.length, 1); assert.equal(h[0].line, 1); assert.equal(h[0].rule, "active content");
  const crlf = PBI.scanText(PBI.decode(new Uint8Array(Buffer.from('{\r\n "a": 1,\r\n "data": {"url": "x.csv"}\r\n}\r\n'))), "c.json");
  assert.equal(crlf[0].line, 3);
});
check("JS scanner catches IDN protocol-relative URLs and Unicode tag names like Python", () => {
  const t = '<img src="//bücher.example/x.png"><svgé onload="x()">';
  fs.writeFileSync(path.join(outDir, "idn.html"), t);
  const r = spawnSync(PY, ["-I", pyScanner, path.join(outDir, "idn.html")], { encoding: "utf8" });
  const py = r.stdout.trim().split("\n").map((l) => l.split(": ").slice(1).join(": "));
  const js = PBI.scanText(t, "idn.html").map((x) => `${x.rule}: ${x.match}`);
  assert.deepEqual(js, py);
});

// ---------- 8. PBIP writer through a File System Access API stand-in over real folders
function fsErr(name) { const e = new Error(name); e.name = name; return e; }
class FileH {
  constructor(p) { this.kind = "file"; this.name = path.basename(p); this.p = p; }
  async getFile() { const b = await fsp.readFile(this.p); return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }
  async createWritable() { const parts = []; const p = this.p; return { write: async (d) => { parts.push(Buffer.from(d, "utf8")); }, close: async () => fsp.writeFile(p, Buffer.concat(parts)) }; }
}
class DirH {
  constructor(p) { this.kind = "directory"; this.name = path.basename(p); this.p = p; }
  async getDirectoryHandle(n, o = {}) {
    const p = path.join(this.p, n);
    try { if (!(await fsp.stat(p)).isDirectory()) throw fsErr("TypeMismatchError"); }
    catch (e) { if (e.code !== "ENOENT") throw e; if (!o.create) throw fsErr("NotFoundError"); await fsp.mkdir(p); }
    return new DirH(p);
  }
  async getFileHandle(n, o = {}) {
    const p = path.join(this.p, n);
    try { if (!(await fsp.stat(p)).isFile()) throw fsErr("TypeMismatchError"); }
    catch (e) { if (e.code !== "ENOENT") throw e; if (!o.create) throw fsErr("NotFoundError"); await fsp.writeFile(p, ""); }
    return new FileH(p);
  }
  async *entries() {
    for (const d of await fsp.readdir(this.p, { withFileTypes: true })) {
      yield [d.name, d.isDirectory() ? new DirH(path.join(this.p, d.name)) : new FileH(path.join(this.p, d.name))];
    }
  }
  async removeEntry(n, o = {}) {                       // like the browser: an empty folder needs no recursive flag
    const p = path.join(this.p, n);
    if ((await fsp.stat(p)).isDirectory()) { if (o.recursive) await fsp.rm(p, { recursive: true }); else await fsp.rmdir(p); }
    else await fsp.rm(p);
  }
}

(async () => {
  const work = path.join(outDir, "pbip");
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.cp(sampleDir, work, { recursive: true });
  const s1 = new DirH(path.join(work, "sample1"));
  const reportJson = path.join(work, "sample1/Sales.Report/definition/report.json");
  const originalReport = await fsp.readFile(reportJson);
  const written = [];

  await checkAsync("finds the PBIR report and reads pages, sizes and visuals", async () => {
    const reps = await PBI.findReports(s1);
    assert.deepEqual(reps.map((r) => [r.name, r.format]), [["Sales.Report", "pbir"]]);
    const info = await PBI.loadReport(reps[0]);
    assert.deepEqual(info.pages.map((p) => [p.displayName, p.visuals.length, p.width, p.height]), [["Overview", 2, 1280, 720], ["Details", 0, 1280, 720]]);
    assert.equal(info.visualSchema, PBI.schemaUrl("2.9.0"));
    assert.equal(info.denebType, null);
  });

  let nativeSummary, denebSummary, deneb2;
  await checkAsync("adds a native table visual without overlapping, copying the project's schema", async () => {
    const s = PBI.nativeSpec({ visualType: "tableEx", columns: "Region[Region]", values: "Sales[Sales Amount]\nSales[Bullet SVG]", imageHeight: 24, imageWidth: 120, title: "Sales by region" });
    nativeSummary = await PBI.addVisual(s1, { reportName: "Sales.Report", pageId: "a1b2c3d4e5f6a7b8c9d0", width: 560, height: 300,
      fallbackSchema: "2.13.0", build: (o) => PBI.nativeVisual(s, o) });
    const v = JSON.parse(await fsp.readFile(path.join(work, "sample1", nativeSummary.path), "utf8"));
    assert.equal(v.$schema, PBI.schemaUrl("2.9.0"));
    assert.equal(nativeSummary.schemaFrom, "project");
    assert.equal(v.position.z, 2000); assert.equal(v.position.tabOrder, 2000);
    const others = [{ x: 16, y: 16, w: 300, h: 120 }, { x: 16, y: 152, w: 600, h: 400 }];
    const p = v.position;
    for (const r of others) assert.ok(!(p.x < r.x + r.w && p.x + p.width > r.x && p.y < r.y + r.h && p.y + p.height > r.y), "overlaps an existing visual");
    assert.ok(p.x + p.width <= 1280 && p.y + p.height <= 720);
    assert.equal(nativeSummary.reportChanged, false);
    assert.deepEqual(await fsp.readFile(reportJson), originalReport);
    written.push(path.join(work, "sample1", nativeSummary.path));
  });

  await checkAsync("adds a Deneb visual: registers the AppSource GUID once, backs up report.json, keeps CRLF", async () => {
    const c = PBI.denebChart("variance", { category: "Region[Region]", actual: "Sales[Sales Amount]", prior: "Sales[Sales PY]" });
    denebSummary = await PBI.addVisual(s1, { reportName: "Sales.Report", pageId: "a1b2c3d4e5f6a7b8c9d0", width: 520, height: 320,
      customVisual: PBI.DENEB_GUID, denebSource: "appsource", fallbackSchema: "2.13.0", now: new Date(2026, 10, 9, 19, 30, 5),
      build: (o) => PBI.denebVisual(c, o) });
    assert.equal(denebSummary.reportChanged, true);
    assert.equal(denebSummary.backup, ".pbi-visual-builder-backups/20261109-193005/Sales.Report/definition/report.json");
    assert.deepEqual(await fsp.readFile(path.join(work, "sample1", denebSummary.backup)), originalReport);
    const after = await fsp.readFile(reportJson, "utf8");
    assert.ok(after.includes("\r\n") && !/[^\r]\n/.test(after), "line endings must stay CRLF");
    const rep = JSON.parse(after);
    assert.deepEqual(rep.publicCustomVisuals, [PBI.DENEB_GUID]);
    const orig = JSON.parse(originalReport.toString("utf8"));
    assert.deepEqual({ ...rep, publicCustomVisuals: undefined }, { ...orig, publicCustomVisuals: undefined });
    assert.deepEqual(Object.keys(rep), [...Object.keys(orig), "publicCustomVisuals"]);
    written.push(path.join(work, "sample1", denebSummary.path), reportJson);
  });

  await checkAsync("second Deneb visual reuses the registration and changes nothing else", async () => {
    const before = await fsp.readFile(reportJson);
    const c = PBI.denebChart("lollipop", {});
    deneb2 = await PBI.addVisual(s1, { reportName: "Sales.Report", pageId: "b2c3d4e5f6a7b8c9d0e1", width: 520, height: 320,
      customVisual: PBI.DENEB_GUID, denebSource: "appsource", fallbackSchema: "2.13.0", build: (o) => PBI.denebVisual(c, o) });
    assert.equal(deneb2.reportChanged, false);
    assert.deepEqual(await fsp.readFile(reportJson), before);
    assert.equal(deneb2.position.x, 16); assert.equal(deneb2.position.y, 16); assert.equal(deneb2.position.z, 0);
    written.push(path.join(work, "sample1", deneb2.path));
  });

  if (!SCHEMAS) skip("all written files validate against Microsoft's PBIR schemas", "set PBIR_SCHEMAS to run it");
  else await checkAsync("all written files validate against Microsoft's PBIR schemas", async () => {
    const r = spawnSync(PY, [path.join(__dirname, "..", "..", "tools", "validate_pbir.py"), SCHEMAS, ...written], { encoding: "utf8" });
    console.log("     " + r.stdout.trim().split("\n").join("\n     "));
    assert.equal(r.status, 0, r.stderr);
  });

  await checkAsync("undo in reverse order restores the original project", async () => {
    await PBI.undoAdd(s1, deneb2);
    await PBI.undoAdd(s1, denebSummary);
    await PBI.undoAdd(s1, nativeSummary);
    assert.deepEqual(await fsp.readFile(reportJson), originalReport);
    assert.deepEqual(listTree(path.join(work, "sample1"), [".pbi-visual-builder-backups"]), listTree(path.join(sampleDir, "sample1"), []));
  });

  await checkAsync("undo refuses when Desktop changed the visual afterwards", async () => {
    const s = PBI.nativeSpec({ visualType: "cardVisual", values: "Sales[Sales Amount]" });
    const sum = await PBI.addVisual(s1, { reportName: "Sales.Report", pageId: "b2c3d4e5f6a7b8c9d0e1", width: 300, height: 120,
      fallbackSchema: "2.13.0", build: (o) => PBI.nativeVisual(s, o) });
    const f = path.join(work, "sample1", sum.path);
    await fsp.writeFile(f, (await fsp.readFile(f, "utf8")).replace('"cardVisual"', '"cardVisual" '));
    await assert.rejects(PBI.undoAdd(s1, sum), PBI.InputError);
  });

  await checkAsync("org-store Deneb already in the report: reuses its visual type, no report change", async () => {
    const s2 = new DirH(path.join(work, "sample2"));
    const rj = path.join(work, "sample2/Ops.Report/definition/report.json");
    const before = await fsp.readFile(rj);
    const c = PBI.denebChart("lollipop", {});
    const sum = await PBI.addVisual(s2, { reportName: "Ops.Report", pageId: "c3d4e5f6a7b8c9d0e1f2", width: 400, height: 300,
      customVisual: PBI.DENEB_GUID, denebSource: "orgstore", fallbackSchema: "2.13.0", build: (o) => PBI.denebVisual(c, o) });
    assert.equal(sum.visualType, "deneb7E15AEF80B9E4D4F8E12924291ECE89A_OrgStore");
    assert.equal(sum.reportChanged, false);
    assert.deepEqual(await fsp.readFile(rj), before);
  });

  await checkAsync("org-store Deneb not yet in the report: refuses and explains", async () => {
    const c = PBI.denebChart("lollipop", {});
    await assert.rejects(PBI.addVisual(s1, { reportName: "Sales.Report", pageId: "b2c3d4e5f6a7b8c9d0e1", width: 400, height: 300,
      customVisual: PBI.DENEB_GUID, denebSource: "orgstore", fallbackSchema: "2.13.0", build: (o) => PBI.denebVisual(c, o) }), /organizational store/);
  });

  await checkAsync("legacy (non-PBIR) report is detected and refused", async () => {
    const s3 = new DirH(path.join(work, "sample3"));
    const reps = await PBI.findReports(s3);
    assert.deepEqual(reps.map((r) => r.format), ["legacy"]);
    await assert.rejects(PBI.addVisual(s3, { reportName: "Old.Report", pageId: "x", width: 100, height: 100, fallbackSchema: "2.9.0", build: () => ({}) }), /PBIR/);
  });

  await checkAsync("placement: fills free space, flags a full page", async () => {
    const full = [{ x: 0, y: 0, w: 1280, h: 720 }];
    assert.equal(PBI.placeRect(1280, 720, full, 200, 100).overlaps, true);
    const p = PBI.placeRect(1280, 720, [{ x: 16, y: 16, w: 600, h: 688 }], 400, 300);
    assert.equal(p.overlaps, false); assert.ok(p.x >= 624);
  });

  await checkAsync("folder scan finds the same hits as the Python scanner on the regression folder", async () => {
    const res = await PBI.scanFolder(new DirH(casesDir));
    const r = spawnSync(PY, ["-I", pyScanner, casesDir], { encoding: "utf8" });
    const py = r.stdout.trim().split("\n").map((l) => { const m = /^(.*?):(\d+): ([^:]+): (.*)$/.exec(l); return `${path.relative(casesDir, m[1])}|${m[2]}|${m[3]}|${m[4].trimEnd()}`; }).sort();
    const js = res.hits.map((h) => `${h.file}|${h.line}|${h.rule}|${h.match.trimEnd()}`).sort();
    assert.deepEqual(js, py);
  });

  console.log(`\n${passes} passed, ${fails} failed${skips ? `, ${skips} skipped` : ""}`);
  process.exit(fails ? 1 : 0);
})();
