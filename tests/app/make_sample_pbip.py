"""Create small, schema-valid PBIP sample projects for testing the offline app's PBIP writer.

usage: python -I tests/app/make_sample_pbip.py <out dir>
sample1: PBIR, report.json with CRLF line endings, two pages, two visuals on page 1, no Deneb.
sample2: PBIR, page 1 already holds a Deneb visual from the organizational store.
sample3: legacy (non-PBIR) report folder.
"""
import json, pathlib, shutil, sys

out = pathlib.Path(sys.argv[1])
if out.exists():
    shutil.rmtree(out)
B = "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/"


def dump(path, obj, eol="\n"):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, indent=2, ensure_ascii=False).replace("\n", eol) + eol
    path.write_bytes(text.encode("utf-8"))


def proj(entity, kind, prop, **extra):
    p = {"field": {kind: {"Expression": {"SourceRef": {"Entity": entity}}, "Property": prop}},
         "queryRef": f"{entity}.{prop}", "nativeQueryRef": prop}
    p.update(extra)
    return p


def visual(name, vtype, x, y, w, h, z, tab, query, objects=None):
    v = {"$schema": B + "visualContainer/2.9.0/schema.json", "name": name,
         "position": {"x": x, "y": y, "z": z, "height": h, "width": w, "tabOrder": tab},
         "visual": {"visualType": vtype, "query": {"queryState": query}}}
    if objects:
        v["visual"]["objects"] = objects
    v["visual"]["drillFilterOtherVisuals"] = True
    return v


def project(root, name, pages, report_eol="\n", extra_visuals=None):
    r = root / f"{name}.Report"
    dump(root / f"{name}.pbip", {"version": "1.0", "artifacts": [{"report": {"path": f"{name}.Report"}}],
                                 "settings": {"enableAutoRecovery": True}})
    dump(r / "definition.pbir", {"version": "4.0", "datasetReference": {"byPath": {"path": f"../{name}.SemanticModel"}}})
    d = r / "definition"
    dump(d / "version.json", {"$schema": B + "versionMetadata/1.0.0/schema.json", "version": "2.0.0"})
    dump(d / "report.json", {
        "$schema": B + "report/3.0.0/schema.json",
        "themeCollection": {"baseTheme": {"name": "CY24SU10",
                                          "reportVersionAtImport": {"visual": "1.8.80", "report": "2.0.80", "page": "1.3.80"},
                                          "type": "SharedResources"}},
        "resourcePackages": [{"name": "SharedResources", "type": "SharedResources",
                              "items": [{"name": "CY24SU10", "path": "BaseThemes/CY24SU10.json", "type": "BaseTheme"}]}],
    }, eol=report_eol)
    dump(d / "pages" / "pages.json", {"$schema": B + "pagesMetadata/1.0.0/schema.json",
                                      "pageOrder": [p[0] for p in pages], "activePageName": pages[0][0]})
    for pid, display, visuals in pages:
        dump(d / "pages" / pid / "page.json", {"$schema": B + "page/2.0.0/schema.json", "name": pid,
                                               "displayName": display, "displayOption": "FitToPage",
                                               "height": 720, "width": 1280})
        for v in visuals:
            dump(d / "pages" / pid / "visuals" / v["name"] / "visual.json", v)


card = visual("0a1b2c3d4e5f60718293", "cardVisual", 16, 16, 300, 120, 0, 0,
              {"Data": {"projections": [proj("Sales", "Measure", "Sales Amount")]}})
bar = visual("1b2c3d4e5f6071829304", "clusteredBarChart", 16, 152, 600, 400, 1000, 1000,
             {"Category": {"projections": [proj("Region", "Column", "Region", active=True)]},
              "Y": {"projections": [proj("Sales", "Measure", "Sales Amount")]}})
project(out / "sample1", "Sales", [("a1b2c3d4e5f6a7b8c9d0", "Overview", [card, bar]),
                                   ("b2c3d4e5f6a7b8c9d0e1", "Details", [])], report_eol="\r\n")

org_deneb = visual("2c3d4e5f607182930415", "deneb7E15AEF80B9E4D4F8E12924291ECE89A_OrgStore", 16, 16, 520, 320, 0, 0,
                   {"dataset": {"projections": [proj("Region", "Column", "Region"), proj("Sales", "Measure", "Sales Amount")]}})
project(out / "sample2", "Ops", [("c3d4e5f6a7b8c9d0e1f2", "Ops", [org_deneb])])

legacy = out / "sample3" / "Old.Report"
legacy.mkdir(parents=True)
(legacy / "report.json").write_text('{"config": "{}", "sections": []}', encoding="utf-8")
(out / "sample3" / "Old.pbip").write_text('{"version": "1.0", "artifacts": [{"report": {"path": "Old.Report"}}]}', encoding="utf-8")
print("samples written to", out)
