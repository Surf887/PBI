# Native visuals in PBIR (mode B)

Reference for the `powerbi-visual-builder` skill, loaded when `SKILL.md` section 5 points here. The guardrails (section 1), validation (section 6) and delivery format (section 7) in `SKILL.md` apply to everything in this file, and nothing here overrides them.

Contents: Folder map · Before editing · Minimal `visual.json` · Field references · Literal encoding · Visual types and roles · Adding a visual · Pitfalls

PBIR (the enhanced report format) is the default report format in Power BI Desktop and the Service as of 2026. A PBIP report folder looks like this:

```
<Name>.Report/
  definition.pbir                      # binding to the semantic model
  definition/
    version.json  report.json          # report.json: theme, custom visual registrations
    pages/pages.json                   # page order: a page missing here is invisible
    pages/<pageId>/page.json           # size, background
    pages/<pageId>/visuals/<visualId>/visual.json
    bookmarks/  reportExtensions.json
  StaticResources/RegisteredResources/ # images, custom themes
  CustomVisuals/<GUID>/                # only for private (side-loaded) visuals
```

**Before editing**: git status clean (or backup taken); Desktop closed or no unsaved changes; read sibling files and copy their `$schema` values (never bump a schema version yourself; newer schemas than the user's Desktop can be rejected). Keep `**/.pbi/localSettings.json` and `**/.pbi/cache.abf` in `.gitignore` (Desktop's default): `cache.abf` holds the model's imported data, so never commit, attach or share it.

**Minimal `visual.json`** (validated against `visualContainer` 2.9.0 and 2.13.0):

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json",
  "name": "3f9a1c7e5b2d4a6c8e01",
  "position": {"x": 24, "y": 96, "z": 1000, "height": 320, "width": 560, "tabOrder": 1000},
  "visual": {
    "visualType": "clusteredBarChart",
    "query": {
      "queryState": {
        "Category": {
          "projections": [{
            "field": {"Column": {"Expression": {"SourceRef": {"Entity": "Region"}}, "Property": "Region"}},
            "queryRef": "Region.Region",
            "nativeQueryRef": "Region",
            "active": true
          }]
        },
        "Y": {
          "projections": [{
            "field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Sales"}}, "Property": "Sales Amount"}},
            "queryRef": "Sales.Sales Amount",
            "nativeQueryRef": "Sales Amount"
          }]
        }
      },
      "sortDefinition": {
        "sort": [{
          "field": {"Measure": {"Expression": {"SourceRef": {"Entity": "Sales"}}, "Property": "Sales Amount"}},
          "direction": "Descending"
        }],
        "isDefaultSort": true
      }
    },
    "objects": {
      "dataPoint": [{"properties": {"defaultColor": {"solid": {"color": {"expr": {"ThemeDataColor": {"ColorId": 0, "Percent": 0}}}}}}}],
      "labels": [{"properties": {"show": {"expr": {"Literal": {"Value": "true"}}}}}],
      "valueAxis": [{"properties": {"start": {"expr": {"Literal": {"Value": "0D"}}}}}]
    },
    "visualContainerObjects": {
      "title": [{"properties": {
        "show": {"expr": {"Literal": {"Value": "true"}}},
        "text": {"expr": {"Literal": {"Value": "'East leads; West is 52% below the leader'"}}}
      }}]
    },
    "drillFilterOtherVisuals": true
  }
}
```

**Field references**: `Column` for columns, `Measure` for measures, `Aggregation` for implicit aggregation of a column: `{"Aggregation": {"Expression": {"Column": {...}}, "Function": 0}}` with Function 0 Sum, 1 Average, 2 Distinct count, 3 Min, 4 Max, 5 Count (non-blank), 6 Median, 7 Std dev, 8 Variance. `queryRef` is `Table.Field` (or `Sum(Table.Column)` for aggregations); `nativeQueryRef` is the field name; add `displayName` when the field is renamed in the visual. `queryRef`/`nativeQueryRef` are siblings of `field`, never inside it.

**Literal encoding** (inside `{"expr": {"Literal": {"Value": ...}}}`): text `"'text'"` (double inner apostrophes: `'It''s'`), decimal `"12D"`, integer `"12L"`, boolean `"true"`/`"false"`. Colours: `{"solid": {"color": {"expr": {"Literal": {"Value": "'#118DFF'"}}}}}` or `{"ThemeDataColor": {"ColorId": 0, "Percent": 0}}`; use Literal hex (not `ThemeDataColor`) when a `metadata` selector is involved.

**Visual types and roles you can rely on**: `clusteredBarChart`, `clusteredColumnChart`, `lineChart`, `areaChart` (roles `Category`, `Y`, optional `Series`); `tableEx` (`Values`); `pivotTable` (`Rows`, `Columns`, `Values` = measures only); `cardVisual` (`Data`, one or more measures — not the legacy `Fields`); slicers `slicer` (classic: dropdown, between and relative-date modes; `Values`), `listSlicer` (`Values`, `Tooltips`) and `advancedSlicerVisual` (button/tile slicer: one `Values` column, optional `Label` measure); `image`; `azureMap`. Use `cardVisual`, `tableEx`, `pivotTable`, `azureMap` — not the deprecated `card`, `multiRowCard`, `map`, `filledMap`. For any other type, role or formatting property, copy it from a visual authored in Desktop (or Microsoft's report-authoring CLI `catalog`/`formatting describe`) — never guess.

**Adding a visual**

1. Pick the page; read `page.json` width/height and the other visuals' positions to avoid overlap.
2. Name: 20 lowercase hex characters, unique in the report (`python3 -c "import secrets;print(secrets.token_hex(10))"`). Create `visuals/<name>/visual.json`.
3. Set `position` inside the page, unique `z` and a logical `tabOrder` (reading order).
4. New page? Add its id to `pages/pages.json` → `pageOrder`.
5. Custom visual? Register it in `report.json`: AppSource → GUID in `publicCustomVisuals`; organizational store → a `resourcePackages` entry of type `OrganizationalStoreCustomVisual` named `<GUID>_OrgStore` (and `visualType` = `<GUID>_OrgStore`); private `.pbiviz` (dev/test only) → unpack to `CustomVisuals/<GUID>/` **and** add a `CustomVisual` package. Never guess a GUID: read it from the `.pbiviz` `package.json` or from a Desktop-authored instance.
6. Validate (`SKILL.md` section 6), then reload Desktop and check the render.

**Pitfalls that break visuals silently**: `sortDefinition` outside `query`; `visualContainerObjects` outside `visual`; missing `nativeQueryRef`; reused names; wrong role names; mixing `Column`/`Measure`; numbers without `D`/`L`; double-quoted text literals; regex edits and PowerShell `ConvertTo-Json` (default depth 2) mangling JSON (if PowerShell is unavoidable, pass `-Depth 100`); `dataPoint.fill` without a selector (invisible bars; use `defaultColor`); a page not listed in `pages.json`; editing while Desktop holds unsaved changes (Desktop overwrites your edits).
