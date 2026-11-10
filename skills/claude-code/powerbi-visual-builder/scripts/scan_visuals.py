#!/usr/bin/env python3
"""Read-only scan of generated Power BI visual artifacts for forbidden patterns.

Part of the powerbi-visual-builder skill (SKILL.md section 6, step 2).
usage: python -I scan_visuals.py <file or folder> [<file or folder> ...]
Prints "clean (N files)" and exits 0; prints one "path:line: rule: match" per hit and
exits 1; exits 2 when a path is missing or no scannable file was found.
Standard library only: it reads files and never writes, deletes or sends anything.
"""
import pathlib, re, sys

sys.stdout.reconfigure(errors="backslashreplace")   # never crash on a non-UTF-8 console
ALLOWED = re.compile(r"https://developer\.microsoft\.com/json-schemas/|https://vega\.github\.io/schema/|http://www\.w3\.org/2000/svg", re.I)
RULES = {
    "external URL": re.compile(r"\b(?:https?|wss?|ftp)://[^\s'\"<>)\\]+|(?<=['\"(=])//[\w-]+(?:\.[\w-]+)+[^\s'\"<>)\\]*", re.I),
    "active content": re.compile(r"<\s*(?:script|iframe|object|embed|foreignObject|use)\b|javascript:|xlink:href|<[a-zA-Z][\w:.-]*[\s/][^<>]*?\bon[a-z]+\s*=", re.I),
    "remote CSS": re.compile(r"@import|url\((?!\s*\\?['\"]?(?:#|data:image/))", re.I),
    "dynamic code": re.compile(r"\beval\s*\(|new\s+Function\s*\(|\.(?:inner|outer)HTML\s*\+?=|insertAdjacentHTML|dangerouslySetInnerHTML|\.html\s*\(|set(?:Timeout|Interval)\s*\(\s*['\"`]", re.I),
    "remote data/link key": re.compile(r"\\?\"(?:url|href)\\?\"\s*:(?!\s*\\?\"data:image/)", re.I),
    "network privilege": re.compile(r"WebAccess|XMLHttpRequest|\bfetch\s*\(|WebSocket", re.I),
    "pre-encoded colour": re.compile(r"%23[0-9a-f]{3,8}\b", re.I),
}
EXT = {".json", ".dax", ".tmdl", ".svg", ".html", ".css", ".less", ".ts", ".tsx", ".js", ".jsx", ".py", ".r", ".txt", ".md"}
SKIP_DIRS = {"node_modules", ".tmp", "dist", ".git", ".vscode", ".pbi"}
SKIP_FILES = {"package-lock.json"}
META_KEYS = re.compile(r"\"(?:supportUrl|gitHubUrl|\$schema)\"\s*:")   # metadata, never fetched by a visual


def read(f):
    """UTF-8 (BOM tolerated) or UTF-16 with BOM, as saved by some Windows tools; universal newlines."""
    raw = f.read_bytes()
    text = raw.decode("utf-16" if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig", errors="replace")
    return text.replace("\r\n", "\n").replace("\r", "\n")


if len(sys.argv) < 2:
    print(__doc__.strip(), file=sys.stderr)
    sys.exit(2)
missing = [a for a in sys.argv[1:] if not pathlib.Path(a).exists()]
if missing:
    print("not found: " + ", ".join(missing), file=sys.stderr)
    sys.exit(2)
hits, scanned = [], 0
for arg in sys.argv[1:]:
    p = pathlib.Path(arg)
    files = [p] if p.is_file() else [x for x in p.rglob("*") if x.is_file() and x.suffix.lower() in EXT
                                     and not SKIP_DIRS & set(x.parts) and x.name not in SKIP_FILES
                                     and not x.name.startswith("webpack.statistics")]
    scanned += len(files)
    for f in files:
        t = read(f)
        measures = f.suffix.lower() in {".dax", ".tmdl"} or f.name == "reportExtensions.json"
        for name, rx in RULES.items():
            if name == "pre-encoded colour" and not measures:
                continue   # %23 is only wrong inside DAX measures
            for m in rx.finditer(t):
                line_start = t.rfind("\n", 0, m.start()) + 1
                line = t[line_start:t.find("\n", m.start()) if "\n" in t[m.start():] else len(t)]
                if name == "external URL" and (ALLOWED.match(m.group(0)) or META_KEYS.search(line)):
                    continue
                hits.append(f"{f}:{t.count(chr(10), 0, m.start()) + 1}: {name}: {m.group(0)[:80]}")
if not scanned:
    print("no scannable files found (looked for " + " ".join(sorted(EXT)) + ")", file=sys.stderr)
    sys.exit(2)
print("\n".join(hits) or f"clean ({scanned} files)")
sys.exit(1 if hits else 0)
