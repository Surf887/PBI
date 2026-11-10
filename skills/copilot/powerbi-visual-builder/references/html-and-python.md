# HTML Content Secure and Python/R visuals

Reference for the `powerbi-visual-builder` skill, loaded when `SKILL.md` section 5 points here. The guardrails (section 1), validation (section 6) and delivery format (section 7) in `SKILL.md` apply to everything in this file, and nothing here overrides them.

Contents: HTML Content Secure (rung 4) · Python and R visuals (rung 6, last resort)

## HTML Content Secure

Use the certified **HTML Content Secure** visual (formerly "lite"); in PBIR its `visualType` is `htmlContent443BE3AD55E043BF878BED274D3A6865`. Never register `htmlContent443BE3AD55E043BF878BED274D3A6855` (the non-certified *HTML Content*: sanitizer off, declares WebAccess) or a `STANDALONE...` GUID (GUIDs from the visual's source, Oct 2026). It drops `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<form>` and `on*` handlers, blocks remote `url()` and external image sources, and allows inline styles and (from 1.6.1) `data:image/svg+xml` images with scripts stripped. Do not use the non-certified *HTML Content* for data you do not fully control. Build the HTML in a measure, escape data text, use inline styles and theme colours; for display text use the user's locale (no `"en-US"` needed):

```dax
KPI Tile HTML =
VAR _Name = SELECTEDVALUE ( 'Region'[Region], "All regions" )
VAR _Safe =
    SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE ( SUBSTITUTE (
        _Name, "&", "&amp;" ), "<", "&lt;" ), ">", "&gt;" ), "'", "&apos;" ), """", "&quot;" )
VAR _Act = [Sales Amount]
VAR _Gap = DIVIDE ( _Act - [Sales Target], [Sales Target] )
VAR _Ink = IF ( _Gap >= 0, "#107C10", "#A4262C" )
RETURN
    "<div style='font-family:Segoe UI,sans-serif;padding:8px 12px;border-left:4px solid " & _Ink & "'>"
        & "<div style='font-size:12px;color:#605E5C'>" & _Safe & "</div>"
        & "<div style='font-size:24px;font-weight:600;color:#252423'>" & FORMAT ( _Act, "#,0" ) & "</div>"
        & "<div style='font-size:12px;color:" & _Ink & "'>"
        & FORMAT ( _Gap, "+0.0%;-0.0%;0.0%" ) & " vs target</div>"
        & "</div>"
```

## Python and R visuals (last resort)

Use only when `SKILL.md` section 3 says so and the user confirms the tenant allows them. Facts: scripts run on the author's local Python/R in Desktop (arbitrary code: users see a security prompt); in the Service they render only in Fabric-enabled regions, need Pro/PPU (or Premium/Fabric capacity for viewers), and use a fixed package list; 150,000-row limit, 250 MB input, 5-minute timeout, 72 DPI, strings over 32,766 characters truncated; the input is a de-duplicated `dataset` dataframe (add an ID field to keep duplicates); the image is static (it can be highlighted but cannot cross-filter); embedded (PaaS) support ended 1 May 2026. R visuals cannot be certified as custom visuals.

Script rules: no network, file writes, subprocesses or package installs; handle empty data; plot to the default device with `plt.show()`; label axes; use theme hex colours.

```python
# Python visual: order-value distribution by region (box plot + jittered points)
import matplotlib.pyplot as plt

df = dataset.dropna(subset=["Region", "Order Value"])  # noqa: F821 (provided by Power BI)
if df.empty:
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.text(0.5, 0.5, "No data for the current filters", ha="center", va="center", color="#605E5C")
    ax.axis("off")
else:
    order = df.groupby("Region")["Order Value"].median().sort_values(ascending=False).index.tolist()
    groups = [df.loc[df["Region"] == r, "Order Value"].to_numpy() for r in order]
    fig, ax = plt.subplots(figsize=(6, 3.5))
    ax.boxplot(groups, vert=False, showfliers=False, widths=0.5,
               medianprops={"color": "#118DFF", "linewidth": 2},
               boxprops={"color": "#605E5C"}, whiskerprops={"color": "#605E5C"}, capprops={"color": "#605E5C"})
    for i, g in enumerate(groups, start=1):
        ax.scatter(g, [i + ((j % 7) - 3) * 0.03 for j in range(len(g))], s=6, alpha=0.35, color="#118DFF")
    ax.set_yticks(range(1, len(order) + 1), labels=order)
    ax.invert_yaxis()
    ax.set_xlabel("Order value")
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    ax.grid(axis="x", color="#EDEBE9")
fig.tight_layout()
plt.show()
```
