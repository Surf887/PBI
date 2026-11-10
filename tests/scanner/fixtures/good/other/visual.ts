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
                t.setAttribute("x", "8"); t.setAttribute("y", "20");
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
        const max = Math.max(1, ...bars.map(b => b.value));
        const labelW = 90, rowH = Math.max(14, Math.min(28, height / Math.max(1, bars.length)));
        this.svg.setAttribute("width", String(width));
        this.svg.setAttribute("height", String(height));
        bars.forEach((b, i) => {
            const g = document.createElementNS(SVG_NS, "g");
            g.setAttribute("tabindex", "0");
            g.setAttribute("aria-label", `${b.label}: ${b.value}`);
            const text = document.createElementNS(SVG_NS, "text");
            text.setAttribute("x", "4"); text.setAttribute("y", String(i * rowH + rowH * 0.7));
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

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formatting.buildFormattingModel(this.settings);
    }
}
