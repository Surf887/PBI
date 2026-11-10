import pathlib, re, sys
ALLOWED = re.compile(r"https://developer\.microsoft\.com/json-schemas/|https://vega\.github\.io/schema/|http://www\.w3\.org/2000/svg", re.I)
RULES = {
    "external URL": re.compile(r"\b(?:https?|wss?|ftp)://[^\s'\"<>)\\]+|(?<=['\"(=])//[\w-]+(?:\.[\w-]+)+[^\s'\"<>)\\]*", re.I),
    "active content": re.compile(r"<\s*(?:script|iframe|object|embed|foreignObject|use)\b|javascript:|xlink:href|<[a-zA-Z][\w:.-]*[\s/][^<>]*?\bon[a-z]+\s*=", re.I),
    "remote CSS": re.compile(r"@import|url\((?!\s*\\?['\"]?(?:#|data:image/))", re.I),
    "dynamic code": re.compile(r"\beval\s*\(|new\s+Function\s*\(|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|setTimeout\s*\(\s*['\"]", re.I),
    "remote data/link key": re.compile(r"\\?\"(?:url|href)\\?\"\s*:\s*(?!\\?\"data:image/)", re.I),
    "network privilege": re.compile(r"WebAccess|XMLHttpRequest|\bfetch\s*\(|WebSocket", re.I),
    "pre-encoded colour": re.compile(r"%23[0-9a-f]{3,8}\b", re.I),
}
EXT = {".json", ".dax", ".tmdl", ".svg", ".html", ".ts", ".js", ".py", ".r", ".txt", ".md"}
SKIP_DIRS = {"node_modules", ".tmp", "dist", ".git", ".vscode", ".pbi"}
SKIP_FILES = {"package-lock.json"}
META_KEYS = re.compile(r"\"(?:supportUrl|gitHubUrl|\$schema)\"\s*:")   # metadata, never fetched by a visual
hits = []
for arg in sys.argv[1:]:
    p = pathlib.Path(arg)
    files = [p] if p.is_file() else [x for x in p.rglob("*") if x.is_file() and x.suffix.lower() in EXT
                                     and not SKIP_DIRS & set(x.parts) and x.name not in SKIP_FILES
                                     and not x.name.startswith("webpack.statistics")]
    for f in files:
        t = f.read_text(encoding="utf-8", errors="replace")
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
print("\n".join(hits) or "clean")
sys.exit(1 if hits else 0)
