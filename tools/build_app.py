"""Inline style.css, core.js and ui.js into one HTML file with a hash-based Content-Security-Policy,
and write its SHA-256 next to it (SHA256SUMS).

usage: python -I tools/build_app.py <src dir> <out file>
"""
import base64, hashlib, pathlib, re, sys

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
html = (src / "index.html").read_text(encoding="utf-8")
style = (src / "style.css").read_text(encoding="utf-8")
core = (src / "core.js").read_text(encoding="utf-8")
ui = (src / "ui.js").read_text(encoding="utf-8")

for name, text, closer in [("core.js", core, "</script"), ("ui.js", ui, "</script"), ("style.css", style, "</style")]:
    assert closer not in text.lower(), f"{name} contains {closer}"
    assert "<!--" not in text, f"{name} contains <!--"
assert not re.search(r"\sstyle=|\son[a-z]+=", html), "inline style or event attribute in index.html"

sha = lambda t: "'sha256-" + base64.b64encode(hashlib.sha256(t.encode("utf-8")).digest()).decode() + "'"
csp = (f"default-src 'none'; script-src {sha(core)} {sha(ui)}; style-src {sha(style)}; "
       "base-uri 'none'; form-action 'none'")
for key, value in [("{{CSP}}", csp), ("{{STYLE}}", style), ("{{CORE}}", core), ("{{UI}}", ui)]:
    assert html.count(key) == 1, key
    html = html.replace(key, value)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html, encoding="utf-8", newline="\n")
digest = hashlib.sha256(out.read_bytes()).hexdigest()
(out.parent / "SHA256SUMS").write_text(f"{digest}  {out.name}\n", encoding="utf-8", newline="\n")
print(f"{out} ({len(html.encode()):,} bytes, SHA-256 {digest})\nCSP: {csp}")
