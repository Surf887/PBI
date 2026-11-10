# Deneb (certified Vega / Vega-Lite visual)

Reference for the `powerbi-visual-builder` skill, loaded when `SKILL.md` section 5 points here. The guardrails (section 1), validation (section 6) and delivery format (section 7) in `SKILL.md` apply to everything in this file, and nothing here overrides them.

Contents: Facts · Authoring rules · Spec 1 ranked lollipop · Spec 2 actual vs prior year · Spec 3 Gantt · Config · Apply in the UI · Portable template · Embedding in PBIR (Python builder)

**Facts** (Deneb 2.0.1, Oct 2026)

- Certified AppSource visual; GUID `deneb7E15AEF80B9E4D4F8E12924291ECE89A`. Bundles **Vega 6.4.0 / Vega-Lite 6.4.3** → write v6 specs. Get it from AppSource or the org store, never the standalone/alpha/beta builds.
- One data role (the **Values** well). In the spec the data is `{"name": "dataset"}` (Vega: `"data": [{"name": "dataset"}]`).
- Field names = display names (the renamed name if renamed in the well); `\ " . [ ]` become `_`; spaces are kept. Access names with spaces as `datum['Sales Amount']`.
- Up to **30,000 rows** per data window in Deneb 2.x (set in its `capabilities.json`; Deneb 1.x used 10,000, which older docs and skills still quote); *Override row limit* (`dataLimit.override`) loads more windows at a performance cost. One row per unique combination of the columns you add.
- Special fields: `__row__` (row index), `__selected__` (`on` / `off` / `neutral`), and per field `<Field>__highlight`, `__highlightStatus` (`on`/`off`/`neutral`), `__highlightComparator` (`eq`/`neq`/`lt`/`gt`), `__format`, `__formatted` (each support field can be switched per field).
- Expression functions: `pbiFormat(value, format)`, `pbiFormatAutoUnit(value, format)`, `pbiColor(indexOrName, shade)` (names: `good`/`positive`, `bad`/`negative`, `neutral`, `min`, `middle`, `max`), `pbiPatternSVG(...)`, and for Vega advanced cross-filtering `pbiCrossFilterApply(event, filterExpr)` / `pbiCrossFilterClear()`.
- Theme colour schemes: `pbiColorNominal`, `pbiColorOrdinal`, `pbiColorLinear`, `pbiColorDivergent`.
- Deneb always applies `background: transparent` and `customFormatTypes: true`, so `"formatType": "pbiFormat"` works in Deneb (add `customFormatTypes` yourself only when testing outside Power BI).
- Security: the certified build has no WebAccess privilege and its loader allows only `data:` URIs; every external data or image fetch is blocked. Still never author `url` data or remote images (`SKILL.md` guardrail 1).

**Authoring rules**

- Vega-Lite first; Vega only for signals or advanced cross-filtering (`selectionMode: advanced` works only with `provider: vega`).
- `"width": "container"`, `"height": "container"`, `"autosize": {"type": "fit", "contains": "padding"}`.
- Aggregate in DAX (measures) rather than in Vega transforms; keep marks ≲ 5,000; switch `renderMode` to `canvas` for many marks.
- Format with Power BI format strings: `"format": "#,0", "formatType": "pbiFormat"` in axes, text and tooltips.
- Sorting a shared axis by a field in a layered chart: use `"op": "max"` (or `min`). When layer domains are unioned Vega-Lite drops `sum` sorts with only a warning.
- Interactivity: style marks with `__selected__ == 'off'` (cross-filter) and `<Measure>__highlightStatus == 'off'` (cross-highlight); both are absent when the feature is off, so the same test is safe either way. For partial highlights on bars, draw the full value faintly and overlay `<Measure>__highlight`.
- Cross-filter clicks resolve via `__row__`, or by matching field values when marks are aggregated — keep grouping fields in the mark's data.
- Draw with marks instead of embedding SVG images. If an `image` mark is unavoidable, its `data:` URI reaches the browser unencoded: use `rgb()` colours, no `#` or `%`, and never a remote URL.

**Spec 1 — ranked lollipop** (fields `Category`, `Sales`; tested with Vega-Lite 6.4.3)

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "data": {"name": "dataset"},
  "width": "container",
  "height": "container",
  "autosize": {"type": "fit", "contains": "padding"},
  "transform": [
    {"calculate": "datum['Sales__highlightStatus'] == 'off' || datum['__selected__'] == 'off' ? 0.3 : 1", "as": "__opacity"}
  ],
  "encoding": {
    "y": {
      "field": "Category", "type": "nominal", "title": null,
      "sort": {"field": "Sales", "op": "max", "order": "descending"},
      "axis": {"labelLimit": 160, "ticks": false, "domain": false}
    },
    "x": {"field": "Sales", "type": "quantitative", "title": null,
          "axis": {"format": "#,0", "formatType": "pbiFormat", "tickCount": 4}},
    "opacity": {"field": "__opacity", "type": "quantitative", "scale": null, "legend": null},
    "tooltip": [
      {"field": "Category", "type": "nominal"},
      {"field": "Sales", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"}
    ]
  },
  "layer": [
    {"mark": {"type": "rule", "strokeWidth": 2, "color": "#C8C6C4"}, "encoding": {"x2": {"datum": 0}}},
    {"mark": {"type": "circle", "size": 140, "color": {"expr": "pbiColor(0)"}}},
    {"mark": {"type": "text", "align": "left", "baseline": "middle", "dx": 10, "fontSize": 11},
     "encoding": {"text": {"field": "Sales", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"}}}
  ]
}
```

**Spec 2 — actual vs prior year with variance %** (fields `Category`, `Actual`, `PY`; IBCS-style; prior year 0 → no label)

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "data": {"name": "dataset"},
  "width": "container",
  "height": "container",
  "autosize": {"type": "fit", "contains": "padding"},
  "transform": [
    {"calculate": "datum['Actual'] - datum['PY']", "as": "Variance"},
    {"calculate": "datum['PY'] ? (datum['Actual'] - datum['PY']) / abs(datum['PY']) : null", "as": "Variance %"},
    {"calculate": "datum['Variance'] < 0 ? pbiColor('bad') : pbiColor('good')", "as": "__varColor"},
    {"calculate": "datum['Actual__highlightStatus'] == 'off' || datum['__selected__'] == 'off' ? 0.3 : 1", "as": "__opacity"}
  ],
  "encoding": {
    "y": {"field": "Category", "type": "nominal", "title": null,
          "sort": {"field": "Actual", "op": "max", "order": "descending"},
          "axis": {"ticks": false, "domain": false, "labelLimit": 160}},
    "opacity": {"field": "__opacity", "type": "quantitative", "scale": null, "legend": null},
    "tooltip": [
      {"field": "Category", "type": "nominal"},
      {"field": "Actual", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
      {"field": "PY", "title": "Prior year", "type": "quantitative", "format": "#,0", "formatType": "pbiFormat"},
      {"field": "Variance %", "type": "quantitative", "format": "+0.0%;-0.0%;0.0%", "formatType": "pbiFormat"}
    ]
  },
  "layer": [
    {"mark": {"type": "bar", "color": "#C8C6C4", "height": {"band": 0.55}, "yOffset": 5},
     "encoding": {"x": {"field": "PY", "type": "quantitative", "title": null,
                        "axis": {"format": "#,0", "formatType": "pbiFormat", "tickCount": 4}}}},
    {"mark": {"type": "bar", "color": "#404040", "height": {"band": 0.55}, "yOffset": -3},
     "encoding": {"x": {"field": "Actual", "type": "quantitative"}}},
    {"mark": {"type": "text", "align": "left", "baseline": "middle", "dx": 6, "fontSize": 11, "fontWeight": "bold"},
     "transform": [{"calculate": "max(datum['Actual'], datum['PY'])", "as": "__labelX"}],
     "encoding": {
       "x": {"field": "__labelX", "type": "quantitative"},
       "text": {"field": "Variance %", "type": "quantitative", "format": "+0.0%;-0.0%;0.0%", "formatType": "pbiFormat"},
       "color": {"field": "__varColor", "type": "nominal", "scale": null, "legend": null}}}
  ]
}
```

**Spec 3 — Gantt with progress and a today line** (fields `Task`, `Start`, `Finish`, `Progress` as 0–1; one row per task; tested with Vega-Lite 6.4.3 on text dates, date objects, and blank or out-of-range progress)

```json
{
  "$schema": "https://vega.github.io/schema/vega-lite/v6.json",
  "data": {"name": "dataset"},
  "width": "container",
  "height": "container",
  "autosize": {"type": "fit", "contains": "padding"},
  "transform": [
    {"calculate": "toDate(datum['Start'])", "as": "__start"},
    {"calculate": "toDate(datum['Finish'])", "as": "__finish"},
    {"calculate": "time(datum.__start) + (time(datum.__finish) - time(datum.__start)) * clamp(datum['Progress'] || 0, 0, 1)", "as": "__done"},
    {"calculate": "datum['__selected__'] == 'off' ? 0.3 : 1", "as": "__opacity"}
  ],
  "layer": [
    {
      "encoding": {
        "y": {"field": "Task", "type": "nominal", "title": null,
              "sort": {"field": "__start", "op": "min", "order": "ascending"},
              "axis": {"ticks": false, "domain": false, "labelLimit": 180}},
        "x": {"field": "__start", "type": "temporal", "title": null,
              "axis": {"format": "%b %Y", "tickCount": 6, "grid": true}},
        "opacity": {"field": "__opacity", "type": "quantitative", "scale": null, "legend": null},
        "tooltip": [
          {"field": "Task", "type": "nominal"},
          {"field": "__start", "title": "Start", "type": "temporal", "format": "%d %b %Y"},
          {"field": "__finish", "title": "Finish", "type": "temporal", "format": "%d %b %Y"},
          {"field": "Progress", "title": "Complete", "type": "quantitative", "format": "0%", "formatType": "pbiFormat"}
        ]
      },
      "layer": [
        {"mark": {"type": "bar", "color": "#C8C6C4", "height": {"band": 0.6}, "cornerRadius": 2},
         "encoding": {"x2": {"field": "__finish"}}},
        {"mark": {"type": "bar", "color": {"expr": "pbiColor(0)"}, "height": {"band": 0.6}, "cornerRadius": 2},
         "encoding": {"x2": {"field": "__done"}}}
      ]
    },
    {
      "data": {"values": [{}]},
      "mark": {"type": "rule", "color": "#252423", "strokeDash": [4, 3], "strokeWidth": 1.5},
      "encoding": {"x": {"datum": {"expr": "now()"}, "type": "temporal"}}
    }
  ]
}
```

`Start` and `Finish` are date columns, or measures such as the earliest and latest date per task. The coloured bar fills to `Progress`: blank counts as 0 and values are clamped to 0–1. Date axes and tooltips use D3 time formats (`%b %Y`); numbers keep `pbiFormat`. The last layer is the today line: delete it to drop the line, and expect it to stretch the axis when today falls outside the tasks' dates. The inline `values` in that layer is one empty row, not data (`SKILL.md` guardrail 6 still holds).

**Config** (Config tab / `jsonConfig`; Power BI look):

```json
{
  "font": "Segoe UI",
  "view": {"stroke": "transparent"},
  "axis": {"labelColor": "#605E5C", "titleColor": "#605E5C", "labelFontSize": 11, "titleFontSize": 12,
           "titleFontWeight": "normal", "domainColor": "#C8C6C4", "tickColor": "#C8C6C4", "gridColor": "#EDEBE9"},
  "legend": {"labelColor": "#605E5C", "titleColor": "#605E5C", "labelFontSize": 11, "orient": "top"},
  "text": {"color": "#605E5C", "fontSize": 11},
  "range": {"category": {"scheme": "pbiColorNominal"}}
}
```

**Apply in the UI (mode A)**: add Deneb → put the fields in *Values* → *Edit* → paste the spec and config → in Settings turn on Tooltips / Cross-filtering / Cross-highlighting as designed → apply.

**Portable template (Deneb 2.x)** — what you share instead of a report. Replace field names with placeholders `__dataset.N__` (zero-based, ≤ 30 characters); support fields keep their suffix (`__dataset.1____highlightStatus`). Add a `usermeta` block to the spec:

```json
{
  "usermeta": {
    "deneb": {"build": "2.0.1.0", "metaVersion": 2, "provider": "vegaLite", "providerVersion": "6.4.3"},
    "information": {
      "name": "Ranked lollipop",
      "description": "Ranks a category by one measure. Supports tooltips, cross-filtering and cross-highlighting.",
      "author": "Your team",
      "uuid": "6f0d8a52-3c1e-4b7a-9d2f-1e5c7b9a4d30",
      "generated": "2026-11-09T00:00:00.000Z"
    },
    "datasets": {
      "dataset": [
        {"key": "__dataset.0__", "name": "Category", "description": "Column to rank (one row per item)", "kind": "column", "type": "text"},
        {"key": "__dataset.1__", "name": "Value", "description": "Measure to rank by", "kind": "measure", "type": "numeric"}
      ]
    },
    "interactivity": {"tooltip": true, "contextMenu": true, "selection": true, "selectionMode": "simple", "highlight": true, "dataPointLimit": 50},
    "config": "{\"font\":\"Segoe UI\",\"view\":{\"stroke\":\"transparent\"}}"
  }
}
```

Rules: `uuid` is a fresh random v4 UUID; `kind` ∈ column, measure, parameter, any; `type` ∈ bool, text, numeric, dateTime, other; `config` is a JSON **string**; `dataPointLimit` 1–250. Import: Deneb → *Create New Specification* → *Existing template* → map each placeholder. Before importing anyone else's template, review it (guardrails 1, 2, 10).

**Embedding in PBIR (mode B)** — register the GUID in `report.json` → `publicCustomVisuals`, then build `visual.json` with code (never hand-escape the spec):

```python
import json, secrets

DENEB = "deneb7E15AEF80B9E4D4F8E12924291ECE89A"

def text(s):    # PBIR text literal: single-quoted, inner single quotes doubled
    return {"expr": {"Literal": {"Value": "'" + s.replace("'", "''") + "'"}}}
def boolean(b): return {"expr": {"Literal": {"Value": "true" if b else "false"}}}
def number(n):  return {"expr": {"Literal": {"Value": f"{n}D"}}}

def projection(entity, kind, prop):   # kind: "Column" or "Measure"
    return {"field": {kind: {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}},
            "queryRef": f"{entity}.{prop}", "nativeQueryRef": prop}

def deneb_visual(spec, config, fields, schema_url, x=0, y=0, w=520, h=320, z=0, tab=0,
                 provider="vegaLite", tooltips=True, selection=True, highlight=True):
    spec = {k: v for k, v in spec.items() if k != "$schema"}  # Deneb's editor warns on a root $schema
    compact = (",", ":")
    return {"$schema": schema_url, "name": secrets.token_hex(10),
            "position": {"x": x, "y": y, "z": z, "height": h, "width": w, "tabOrder": tab},
            "visual": {"visualType": DENEB,
                       "query": {"queryState": {"dataset": {"projections": fields}}},
                       "objects": {"vega": [{"properties": {
                           "jsonSpec": text(json.dumps(spec, separators=compact, ensure_ascii=False)),
                           "jsonConfig": text(json.dumps(config, separators=compact, ensure_ascii=False)),
                           "provider": text(provider), "renderMode": text("svg"),
                           "enableTooltips": boolean(tooltips), "enableContextMenu": boolean(True),
                           "enableSelection": boolean(selection), "enableHighlight": boolean(highlight),
                           "selectionMaxDataPoints": number(50)}}]},
                       "drillFilterOtherVisuals": True}}
```

`schema_url` = the `$schema` of a sibling `visual.json`. Write the result with `json.dump(..., indent=2)`. Other `objects.vega` properties (defaults): `enableContextMenuSelector` true, `selectionMode` `'simple'`, `logLevel` `3D`; `objects.dataLimit`: `override` false, `enableIncrementalDataUpdates` false, `incrementalUpdateThreshold` `500D` (5–5000). Leave `version`, `denebMetaVersion`, `viewportWidth/Height` to Deneb.
