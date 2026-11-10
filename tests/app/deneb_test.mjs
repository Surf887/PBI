// Compile + render the offline app's Deneb specs with Vega-Lite 6.4.3, capturing all warnings.
// usage: node tests/app/deneb_test.mjs <absolute path to app/src/core.js>   (after: npm ci --prefix tests/app)
import { createRequire } from "node:module";
import * as vega from "vega";
import * as vl from "vega-lite";

const require = createRequire(import.meta.url);
const PBI = require(process.argv[2]);

const palette = ["#118DFF", "#12239E", "#E66C37"];
const named = { good: "#1AAB40", bad: "#D64554" };
vega.expressionFunction("pbiColor", (v) => named[`${v}`] ?? palette[(parseInt(`${v}`) || 0) % palette.length]);
vega.expressionFunction("pbiFormat", (d) => (d == null ? "" : String(Math.round(d * 100) / 100)));
vega.scheme("pbiColorNominal", palette);

let fails = 0;
const log = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) fails++; };

async function run(label, kind, input, rowsFor) {
  const warnings = [];
  const logger = { level() { return this; }, warn: (...a) => { warnings.push(a.join(" ")); return logger; },
                   info: () => logger, debug: () => logger, error: (...a) => { warnings.push("ERROR " + a.join(" ")); return logger; } };
  try {
    const chart = PBI.denebChart(kind, input);
    const spec = structuredClone(chart.spec);
    spec.config = { background: "transparent", customFormatTypes: true, ...chart.config };   // what Deneb adds
    vl.compile(spec, { logger });
    const fixed = structuredClone(spec);
    fixed.width = 420; fixed.height = 220; delete fixed.autosize;
    const view = new vega.View(vega.parse(vl.compile(fixed, { logger }).spec), { renderer: "none" });
    const rows = rowsFor(chart.fields);
    view.insert("dataset", rows);
    await view.runAsync();
    const svg = await view.toSVG();
    const texts = (svg.match(/<text/g) || []).length;
    log(warnings.length === 0, `${label}: compiles with no warnings${warnings.length ? " -> " + warnings.join(" | ") : ""}`);
    log(view.data("dataset").length === rows.length && texts >= rows.length, `${label}: renders ${rows.length} rows (${texts} text elements)`);
    return { view };
  } catch (e) {
    log(false, `${label}: ${e.message}`);
    return null;
  }
}

const cats = ["North", "South", "East's", "West"];
const lollipopRows = ([c, v]) => cats.map((x, i) => ({ [c]: x, [v]: 1000 * (i + 1), [`${v}__highlightStatus`]: i === 1 ? "off" : "on", __selected__: "neutral" }));
const varianceRows = ([c, a, p]) => cats.map((x, i) => ({ [c]: x, [a]: 900 + 100 * i, [p]: i === 3 ? 0 : 1000 }));

await run("lollipop, plain names", "lollipop", { category: "Region[Region]", value: "Sales[Sales Amount]" }, lollipopRows);
await run("lollipop, dotted and symbol names", "lollipop", { category: "Geo[Region.Name]", value: "KPI[Margin % (YTD)]" }, lollipopRows);
await run("variance, plain names", "variance", { category: "Region[Region]", actual: "Sales[Sales Amount]", prior: "Sales[Sales PY]" }, varianceRows);
await run("variance, symbol names", "variance", { category: "'Cost Centre'[CC #]", actual: "Fin[Actual €]", prior: "Fin[Plan & Budget]" }, varianceRows);
const t = PBI.denebTemplate("variance", {});
const { usermeta, ...tplSpec } = t;
try {
  vl.compile({ ...tplSpec, config: { customFormatTypes: true } });
  log(true, "variance template (placeholders) compiles");
} catch (e) { log(false, "variance template: " + e.message); }
console.log(fails ? `${fails} failed` : "all Deneb checks passed");
process.exit(fails ? 1 : 0);
