# SVG measures (micro-charts in native visuals)

Reference for the `powerbi-visual-builder` skill, loaded when `SKILL.md` section 5 points here. The guardrails (section 1), validation (section 6) and delivery format (section 7) in `SKILL.md` apply to everything in this file, and nothing here overrides them.

Contents: Rules · A Bullet · B Progress bar · C Sparkline · D Status pill · E Escaping data-driven text (UDF) · Wiring into hosts

**Rules**

- Return `"data:image/svg+xml;utf8," & <svg>` and set the measure's **Data category = Image URL** (Desktop: Measure tools → Data category; TMDL: `dataCategory: ImageUrl`). Without it the text shows instead of the image.
- Root element: `<svg xmlns='http://www.w3.org/2000/svg' width='W' height='H' viewBox='0 0 W H'>`. Use **single quotes** for attributes (no DAX `""` escaping needed).
- **Numbers**: format every non-integer coordinate with `FORMAT ( x, "0.0", "en-US" )`. Implicit conversion follows the locale, and a decimal comma (`12,5`) breaks the SVG.
- **Colours in measures**: write plain hex `#RRGGBB` and percent-encode nothing (no `%23`, `%26`, ...); XML-escape text instead. Power BI encodes a measure's data URI itself: DaxLib.SVG 2.0 (2026) emits plain `#`, and Service tests in Sept 2026 showed pre-encoded `%23` breaks colours. The common web advice to write `%23` is outdated for measures. Where the URI is used as-is (SVG icons in a theme file's `icons` section, where community guidance is `%23`, or an image inside Deneb, handed straight to the browser), use `rgb(r,g,b)`, which works either way, and avoid `#` and `%`. If a host renders blank, retry with `rgb()` colours first. Avoid `url(#id)` references (gradients, clip paths, markers).
- **Text from data**: XML-escape it (template E). Use a system font stack (`Segoe UI, sans-serif`) — no web fonts.
- **Totals**: guard with `ISINSCOPE` / `HASONEVALUE` and return BLANK where an image makes no sense.
- **Common scale across rows**: compute the max over `ALLSELECTED` of the host's row field, so rows are comparable. Write one measure per host grain.
- **Size**: keep each string small (hundreds to a few thousand characters). Strings beyond ~32K characters per cell are truncated or blank; check the worst case with `LEN ( [Measure] )`. For long series, aggregate (e.g. 12 points) or move to Deneb.
- **Accessibility and sorting**: the image has no data semantics. Keep the numeric measure in an adjacent column and/or bind alt text (table/matrix `accessibility.altTextColumns`). Image columns sort by their text: to sort by value, put `"<desc>" & FORMAT ( value, "000000000000" ) & "</desc>"` right after the opening `<svg ...>` tag (same `<svg>` attributes on every row, non-negative values; DaxLib.SVG's `sortValue` does this).
- Never use `<script>`, `<foreignObject>`, `<use>`, `xlink:href`, `<image>` (except `data:image/` URIs), `<style>` with `@import`, event attributes, external `href`s or web fonts (`SKILL.md` guardrails 1–2).

**A. Bullet (actual vs target, comparable across rows)**

```dax
Bullet SVG =
VAR _Actual = [Sales Amount]
VAR _Target = [Sales Target]
VAR _Max =
    MAXX ( ALLSELECTED ( 'Region'[Region] ), MAX ( [Sales Amount], [Sales Target] ) ) * 1.1
VAR _W = 120
VAR _H = 24
VAR _ActW = MAX ( 0, COALESCE ( DIVIDE ( _Actual, _Max ), 0 ) ) * _W
VAR _TgtX = COALESCE ( DIVIDE ( _Target, _Max ), 0 ) * _W
VAR _Color = IF ( _Actual >= _Target, "#1AAB40", "#D64554" )
VAR _Svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='" & _W & "' height='" & _H
        & "' viewBox='0 0 " & _W & " " & _H & "'>"
        & "<rect x='0' y='4' width='" & _W & "' height='16' fill='#F3F2F1'/>"
        & "<rect x='0' y='8' width='" & FORMAT ( _ActW, "0.0", "en-US" )
        & "' height='8' fill='" & _Color & "'/>"
        & IF (
            NOT ISBLANK ( _Target ),
            "<rect x='" & FORMAT ( MAX ( 0, _TgtX - 1 ), "0.0", "en-US" )
                & "' y='2' width='2' height='20' fill='#252423'/>"
        )
        & "</svg>"
RETURN
    IF (
        ISINSCOPE ( 'Region'[Region] ) && NOT ISBLANK ( _Actual ),
        "data:image/svg+xml;utf8," & _Svg
    )
```

**B. Progress bar with label**

```dax
Progress SVG =
VAR _Pct = DIVIDE ( [Sales Amount], [Sales Target] )
VAR _BarMax = 140
VAR _W = _BarMax + 44
VAR _Fill = MIN ( MAX ( COALESCE ( _Pct, 0 ), 0 ), 1 ) * _BarMax
VAR _Color = IF ( _Pct >= 1, "#1AAB40", "#118DFF" )
VAR _Svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='" & _W & "' height='20' viewBox='0 0 " & _W & " 20'>"
        & "<rect x='0' y='5' width='" & _BarMax & "' height='10' rx='5' fill='#EDEBE9'/>"
        & "<rect x='0' y='5' width='" & FORMAT ( _Fill, "0.0", "en-US" )
        & "' height='10' rx='5' fill='" & _Color & "'/>"
        & "<text x='" & _BarMax + 6 & "' y='14.5' font-family='Segoe UI, sans-serif' font-size='11' fill='#252423'>"
        & FORMAT ( _Pct, "0%", "en-US" ) & "</text>"
        & "</svg>"
RETURN
    IF ( NOT ISBLANK ( _Pct ), "data:image/svg+xml;utf8," & _Svg )
```

**C. Sparkline (rolling 12 months per row, last point marked)** — needs a marked date table with a `[Month Start]` date column.

```dax
Sparkline SVG =
VAR _W = 120
VAR _H = 28
VAR _Pad = 3
VAR _End = MAX ( 'Date'[Date] )
VAR _Points =
    FILTER (
        ADDCOLUMNS (
            CALCULATETABLE (
                VALUES ( 'Date'[Month Start] ),
                DATESINPERIOD ( 'Date'[Date], _End, -12, MONTH ),
                REMOVEFILTERS ( 'Date' )
            ),
            "@v",
                VAR _m = 'Date'[Month Start]
                RETURN
                    CALCULATE ( [Sales Amount], REMOVEFILTERS ( 'Date' ), 'Date'[Month Start] = _m )
        ),
        NOT ISBLANK ( [@v] )
    )
VAR _MinV = MINX ( _Points, [@v] )
VAR _MaxV = MAXX ( _Points, [@v] )
VAR _MinD = MINX ( _Points, 'Date'[Month Start] )
VAR _Span = DATEDIFF ( _MinD, MAXX ( _Points, 'Date'[Month Start] ), DAY )
VAR _Coords =
    ADDCOLUMNS (
        _Points,
        "@x", _Pad + COALESCE ( DIVIDE ( DATEDIFF ( _MinD, 'Date'[Month Start], DAY ), _Span ), 0 ) * ( _W - 2 * _Pad ),
        "@y", _H - _Pad - COALESCE ( DIVIDE ( [@v] - _MinV, _MaxV - _MinV ), 0.5 ) * ( _H - 2 * _Pad )
    )
VAR _Line =
    CONCATENATEX (
        _Coords,
        FORMAT ( [@x], "0.0", "en-US" ) & "," & FORMAT ( [@y], "0.0", "en-US" ),
        " ",
        'Date'[Month Start], ASC
    )
VAR _Last = TOPN ( 1, _Coords, 'Date'[Month Start], DESC )
VAR _Svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='" & _W & "' height='" & _H
        & "' viewBox='0 0 " & _W & " " & _H & "'>"
        & "<polyline points='" & _Line
        & "' fill='none' stroke='#118DFF' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'/>"
        & "<circle cx='" & FORMAT ( MAXX ( _Last, [@x] ), "0.0", "en-US" )
        & "' cy='" & FORMAT ( MAXX ( _Last, [@y] ), "0.0", "en-US" ) & "' r='2.5' fill='#118DFF'/>"
        & "</svg>"
RETURN
    IF ( COUNTROWS ( _Points ) >= 2, "data:image/svg+xml;utf8," & _Svg )
```

**D. Status pill (text + shape, never colour alone)**

```dax
Status SVG =
VAR _Gap = DIVIDE ( [Sales Amount] - [Sales Target], [Sales Target] )
VAR _Status =
    SWITCH ( TRUE (), ISBLANK ( _Gap ), BLANK (), _Gap >= 0, "On track", _Gap >= -0.05, "At risk", "Behind" )
VAR _Fill = SWITCH ( _Status, "On track", "#DFF6DD", "At risk", "#FFF4CE", "#FDE7E9" )
VAR _Ink = SWITCH ( _Status, "On track", "#107C10", "At risk", "#8A6D00", "#A4262C" )
VAR _Svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='84' height='22' viewBox='0 0 84 22'>"
        & "<rect x='0.5' y='0.5' width='83' height='21' rx='10.5' fill='" & _Fill & "' stroke='" & _Ink & "'/>"
        & "<text x='42' y='15' text-anchor='middle' font-family='Segoe UI, sans-serif' font-size='11' font-weight='600' fill='"
        & _Ink & "'>" & _Status & "</text>"
        & "</svg>"
RETURN
    IF ( NOT ISBLANK ( _Status ), "data:image/svg+xml;utf8," & _Svg )
```

**E. Escaping data-driven text** — DAX user-defined functions are GA (June 2026; compatibility level 1702+; stored in `functions.tmdl` in PBIP). Test in DAX query view, then add to the model:

```dax
DEFINE
    FUNCTION SvgEscapeText = ( txt : STRING ) =>
        SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE (
            txt, "&", "&amp;" ), "<", "&lt;" ), ">", "&gt;" ), "'", "&apos;" ), """", "&quot;" )
EVALUATE
    { SvgEscapeText ( "R&D <West> 'A' ""B""" ) }
```

Community UDF libraries for SVG (e.g. DaxLib.SVG on daxlib.org) can save time: review the code, pin the version, and keep `SKILL.md` guardrails 1–2.

**Wiring into hosts**

- **Table / matrix**: put the measure in `Values` (in a matrix, `Values` is measures-only). Set image size to the SVG size (UI: Format → Image size; PBIR: `objects.grid` → `imageHeight` / `imageWidth`, e.g. `24D` / `120D`). Bind alt text per image column if needed (`accessibility.altTextColumns`).
- **Image visual** (an SVG on its own): Image → *Select from data* → the measure. PBIR: `objects.image` with `sourceType` `'imageData'` and `sourceField` = `{"expr": {"Measure": {...}}}`.
- **New card** (`cardVisual`) and **button/list slicers**: use the visual's image setting with *Image URL from a field*. When editing PBIR, author one instance in Desktop and copy its `image` object shape (property names vary between releases). The legacy `card` does not render SVG.
