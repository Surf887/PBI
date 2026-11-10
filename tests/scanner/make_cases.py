"""Write the scanner regression cases: one file per case, expected verdict in CASES."""
import json, pathlib, sys

out = pathlib.Path(sys.argv[1])
SVGNS = "http://www.w3.org/2000/svg"
spec_bad = json.dumps({"data": {"url": "https://example.com/d.csv"}, "mark": "bar"})
CASES = {  # name: (expected "hit"/"clean", content)
    "p01_svg_ext_image.svg": ("hit", f"<svg xmlns='{SVGNS}'><image href='https://evil.example/x.png'/></svg>"),
    "p02_svg_script.svg": ("hit", "<svg><script>alert(1)</script></svg>"),
    "p03_svg_onload.svg": ("hit", f"<svg xmlns='{SVGNS}' onload='go()'></svg>"),
    "p04_svg_foreign.svg": ("hit", "<svg><foreignObject width='10'></foreignObject></svg>"),
    "p05_svg_use_xlink.svg": ("hit", "<svg><use xlink:href='#a'/></svg>"),
    "p06_html_js.html": ("hit", "<a href=\"javascript:alert(1)\">x</a>"),
    "p07_css_import.html": ("hit", "<style>@import 'x.css';</style>"),
    "p08_css_remote_url.html": ("hit", "<div style='background:url(https://x.example/a.png)'></div>"),
    "p09_css_relative_url.html": ("hit", "<div style='background:url(img.png)'></div>"),
    "p10_vl_url_data.json": ("hit", '{"data": {"url": "data.csv"}, "mark": "bar"}'),
    "p11_escaped_spec.visual.json": ("hit", json.dumps({"jsonSpec": {"expr": {"Literal": {"Value": "'" + spec_bad + "'"}}}})),
    "p12_vl_href_channel.json": ("hit", '{"encoding": {"href": {"field": "link"}}}'),
    "p13_eval.ts": ("hit", "const r = eval(code);"),
    "p14_innerhtml.ts": ("hit", "el.innerHTML = label;"),
    "p15_fetch.ts": ("hit", "await fetch('/api');"),
    "p16_webaccess_caps.json": ("hit", '{"privileges": [{"name": "WebAccess", "essential": true}]}'),
    "p17_string_timer.ts": ("hit", "setTimeout(\"go()\", 10);"),
    "p18_pct23.dax": ("hit", "Bar = \"data:image/svg+xml;utf8,<svg><rect fill='%23118DFF'/></svg>\""),
    "p19_ext_in_tmdl.tmdl": ("hit", "measure Icon = \"<svg><image href='https://cdn.example/x.svg'/></svg>\""),
    "p20_localhost.json": ("hit", '{"note": "http://localhost:8080/x"}'),
    "p21_websocket.ts": ("hit", "const s = new WebSocket('wss://x.example/s');"),
    "p22_protocol_relative.html": ("hit", "<img src=\"//cdn.example.com/x.png\">"),
    "p23_insert_adjacent.ts": ("hit", "el.insertAdjacentHTML('beforeend', s);"),
    "p24_new_function.ts": ("hit", "const f = new Function('return 1');"),
    "p25_outerhtml.ts": ("hit", "node.outerHTML = s;"),
    "p26_ftp.txt": ("hit", "get it from ftp://files.example/x"),
    "p27_iframe.html": ("hit", "<iframe></iframe>"),
    "p28_xhr.js": ("hit", "new XMLHttpRequest();"),
    "p29_intranet_ip.json": ("hit", '{"note": "http://10.0.0.5/data"}'),
    "p30_unicode_match.html": ("hit", "<svg><script>alert('→ é 漢')</script></svg>"),
    "p31_less_remote_import.less": ("hit", '@import url("https://fonts.example/x.css");'),
    "p32_url_key_remote.json": ("hit", '{"url": "https://x.example/d.csv"}'),
    "p33_url_key_spaced.json": ("hit", '{"url" : "data.csv"}'),
    "p34_tsx_dangerous.tsx": ("hit", "const e = <div dangerouslySetInnerHTML={{ __html: s }} />;"),
    "p35_d3_html.ts": ("hit", "d3.select(el).html(label);"),
    "p36_innerhtml_append.ts": ("hit", "el.innerHTML += row;"),
    "p37_setinterval_string.js": ("hit", "setInterval(\"tick()\", 1000);"),
    "n01_svg_ok.svg": ("clean", f"<svg xmlns='{SVGNS}' viewBox='0 0 10 10'><rect fill='#118DFF' width='5' height='5'/></svg>"),
    "n02_pbir_schema.json": ("clean", '{"$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.13.0/schema.json"}'),
    "n03_vl_schema.json": ("clean", '{"$schema": "https://vega.github.io/schema/vega-lite/v6.json"}'),
    "n04_pbiviz_meta.json": ("clean", '{"visual": {"supportUrl": "https://contoso.example/support",\n "gitHubUrl": "https://github.com/x/y"}}'),
    "n05_svg_data_image.svg": ("clean", "<svg><image href='data:image/png;base64,AAAA'/></svg>"),
    "n06_url_fragment.svg": ("clean", "<svg><rect fill='url(#g)'/></svg>"),
    "n07_theme_icon.json": ("clean", '{"icons": {"up": {"url": "data:image/svg+xml;utf8,<svg fill=\'%23118DFF\'></svg>"}}}'),
    "n08_prose_scheme.md": ("clean", "Never write http:// or https:// in a spec."),
    "n09_button_class.html": ("clean", "<div class=\"button\">Click on = here</div>"),
    "n10_lt_in_dax.dax": ("clean", "M = IF ( [x] < 5, \"<b>low</b>\", \"ok\" )"),
    "n11_prefetch_word.ts": ("clean", "prefetch(x); fetchData(y);"),
    "n12_hash_colour.dax": ("clean", "C = \"data:image/svg+xml;utf8,<svg><rect fill='#118DFF'/></svg>\""),
    "n13_theme_pretty.json": ("clean", '{\n  "name": "Corp",\n  "icons": {\n    "up": {\n      "url": "data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\'><path fill=\'rgb(16,124,16)\' d=\'M0 0\'/></svg>",\n      "description": "Up"\n    }\n  }\n}'),
    "n14_less_ok.less": ("clean", ".bar { fill: #118DFF; .label { font-size: 11px; } }"),
    "n15_react_ok.tsx": ("clean", "const t = <text x={5} y={12}>{label}</text>;"),
    "n16_to_html.py": ("clean", "html = df.to_html(); pd.read_html(path)"),
    "n17_href_data_image.json": ("clean", '{"href": "data:image/png;base64,AAAA"}'),
    "n18_innerhtml_read.ts": ("clean", "const n = el.innerText; const c = el.textContent;"),
}
for name, (_, text) in CASES.items():
    (out / name).write_text(text, encoding="utf-8")
sub = out / "ext" / "reportExtensions.json"          # measures live here too: %23 must hit
sub.parent.mkdir(parents=True, exist_ok=True)
sub.write_text('{"measures": [{"expression": "\\"<svg fill=\'%23FF0000\'/>\\""}]}', encoding="utf-8")
CASES["ext/reportExtensions.json"] = ("hit", None)
(out.parent / "expected.json").write_text(json.dumps({k: v[0] for k, v in CASES.items()}, indent=1))
print(len(CASES), "cases")
