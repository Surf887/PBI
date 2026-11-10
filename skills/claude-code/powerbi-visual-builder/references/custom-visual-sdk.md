# Custom visuals with the Power BI Visuals SDK (mode C)

Reference for the `powerbi-visual-builder` skill, loaded when `SKILL.md` section 5 points here. The guardrails (section 1), validation (section 6) and delivery format (section 7) in `SKILL.md` apply to everything in this file, and nothing here overrides them.

Contents: Toolchain · `capabilities.json` essentials · Secure coding rules · Skeleton `src/visual.ts` · Distribution

Only when rung 5 applies (`SKILL.md` section 3). Agree on an owner, a code review, an org-store publishing path and an update cadence first.

**Toolchain (pinned; Node ≥ 20.19)**

```bash
npx --yes powerbi-visuals-tools@7.2.1 new <visualName>   # scaffold (API 5.11.1, ESLint config included)
cd <visualName>
npm install --save-dev --save-exact powerbi-visuals-tools@7.2.1   # pin the CLI inside the project
npx pbiviz start                                   # dev server: only in a dev workspace where your admin allows developer visuals
npx eslint .                                       # eslint-plugin-powerbi-visuals recommended rules
npx pbiviz package --certification-audit           # flags fetch / XMLHttpRequest / eval; produces dist/*.pbiviz
npm audit --audit-level=moderate                   # certification bar: no moderate/high findings
```

`pbiviz package` refuses to build without `author.name`/`author.email` in `pbiviz.json`; fill `description` and `supportUrl` too. A fresh scaffold can report moderate advisories in **dev-tooling** dependencies (`npm audit --omit=dev` is clean); fix them by upgrading the lint tooling before a certification submission. Do not use `--certification-fix` on your own code; remove the offending calls. `pbiviz mcp` (an official MCP server in the same package) can help with API lookups and pre-certification checks; pin it too.

**`capabilities.json` essentials**

```json
{
  "privileges": [],
  "supportsKeyboardFocus": true,
  "supportsLandingPage": true,
  "supportsMultiVisualSelection": true,
  "tooltips": {"supportedTypes": {"default": true, "canvas": true}, "roles": ["tooltips"]}
}
```

(merged into the scaffold's `dataRoles`, `dataViewMappings` and `objects`; add a `tooltips` Measure role and bind it in `values.select`). Keep `privileges` free of `WebAccess`.

**Secure coding rules (certification-grade)**: no HTTP/WebSocket, `fetch` or `XMLHttpRequest`; no `eval`, `Function()` or string timers; never `innerHTML` / `d3.html()` with data — create elements and set `textContent`; only public, reviewable OSS dependencies; no committed minified code; support the rendering events API, selection, context menu, tooltips, keyboard focus, high contrast and a landing page; check `host.hostCapabilities.allowInteractions` before selecting.

**Skeleton `src/visual.ts`** (lints clean and packages with `--certification-audit` on tools 7.2.1; uses the scaffold's `settings.ts`):

```typescript
"use strict";
import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";
import { VisualFormattingSettingsModel } from "./settings";

import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;

const SVG_NS = "http://www.w3.org/2000/svg";
interface Bar { label: string; value: number; id: ISelectionId; }

export class Visual implements IVisual {
    private host: IVisualHost;
    private svg: SVGSVGElement;
    private selection: ISelectionManager;
    private formatting = new FormattingSettingsService();
    private settings: VisualFormattingSettingsModel;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.selection = this.host.createSelectionManager();
        this.svg = document.createElementNS(SVG_NS, "svg");
        options.element.appendChild(this.svg);
        this.svg.addEventListener("contextmenu", (e: MouseEvent) => {
            this.selection.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.host.eventService.renderingStarted(options);
        try {
            const dv = options.dataViews?.[0];
            this.settings = this.formatting.populateFormattingSettingsModel(VisualFormattingSettingsModel, dv);
            const cat = dv?.categorical?.categories?.[0];
            const val = dv?.categorical?.values?.find(v => v.source.roles?.["measure"]);
            this.svg.replaceChildren();
            if (!cat || !val) {                                    // landing page, plain text
                const t = document.createElementNS(SVG_NS, "text");
                t.setAttribute("x", "8"); t.setAttribute("y", "20"); t.setAttribute("fill", this.ink());
                t.textContent = "Add a Category and a Measure";
                this.svg.appendChild(t);
            } else {
                this.render(cat.values.map((c, i) => ({
                    label: String(c ?? "(Blank)"),
                    value: Number(val.values[i] ?? 0),
                    id: this.host.createSelectionIdBuilder().withCategory(cat, i).createSelectionId()
                })), options.viewport.width, options.viewport.height);
            }
            this.host.eventService.renderingFinished(options);
        } catch (e) {
            this.host.eventService.renderingFailed(options, String(e));
        }
    }

    private render(bars: Bar[], width: number, height: number): void {
        const p = this.host.colorPalette;
        const fill = p.isHighContrast ? p.foreground.value : (this.settings.dataPointCard.defaultColor.value.value || "#118DFF");
        const max = bars.reduce((m, b) => Math.max(m, b.value), 1);    // no spread: safe for any row count
        const labelW = 90, rowH = Math.max(14, Math.min(28, height / Math.max(1, bars.length)));
        this.svg.setAttribute("width", String(width));
        this.svg.setAttribute("height", String(height));
        bars.forEach((b, i) => {
            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("tabindex", "0");
            g.setAttribute("aria-label", `${b.label}: ${b.value}`);
            const text = document.createElementNS(SVG_NS, "text");
            text.setAttribute("x", "4"); text.setAttribute("y", String(i * rowH + rowH * 0.7));
            text.setAttribute("fill", this.ink());                   // SVG text defaults to black
            text.textContent = b.label;                            // never innerHTML
            const rect = document.createElementNS(SVG_NS, "rect");
            rect.setAttribute("x", String(labelW)); rect.setAttribute("y", String(i * rowH + 2));
            rect.setAttribute("height", String(rowH - 4));
            rect.setAttribute("width", String(Math.max(0, (width - labelW - 8) * b.value / max)));
            rect.setAttribute("fill", fill);
            g.append(text, rect);
            const select = (multi: boolean) => {
                if (this.host.hostCapabilities.allowInteractions) { void this.selection.select(b.id, multi); }
            };
            g.addEventListener("click", (e: MouseEvent) => select(e.ctrlKey || e.metaKey));
            g.addEventListener("keydown", (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") select(e.ctrlKey); });
            g.addEventListener("contextmenu", (e: MouseEvent) => {
                this.selection.showContextMenu(b.id, { x: e.clientX, y: e.clientY });
                e.preventDefault(); e.stopPropagation();
            });
            g.addEventListener("mousemove", (e: MouseEvent) => this.host.tooltipService.show({
                coordinates: [e.clientX, e.clientY], isTouchEvent: false,
                dataItems: [{ displayName: b.label, value: String(b.value) }], identities: [b.id]
            }));
            g.addEventListener("mouseleave", () => this.host.tooltipService.hide({ immediately: true, isTouchEvent: false }));
            this.svg.appendChild(g);
        });
    }

    private ink(): string {                                       // readable in high-contrast themes
        const p = this.host.colorPalette;
        return p.isHighContrast ? p.foreground.value : "#252423";
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formatting.buildFormattingModel(this.settings);
    }
}
```

Next steps the packager will recommend: highlight support (`supportsHighlight`) and localization.

**Distribution**: give the reviewed `.pbiviz` to the Power BI admin for the **organizational visuals store**; reports then reference `<GUID>_OrgStore` (`pbir-native.md`, *Adding a visual*, step 5). AppSource certification additionally needs a repository branch named `certification` whose code matches the submitted package, and R-based visuals cannot be certified.
