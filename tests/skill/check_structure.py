"""Structure + content-preservation checks for the folder skill against the saved single-file skill."""
import collections, pathlib, py_compile, re, sys, tempfile

src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
root = pathlib.Path(sys.argv[2])
VARIANT = sys.argv[3] if len(sys.argv) > 3 else "claude-code"
fails = []


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        fails.append(label)


FENCE = re.compile(r"(?ms)^```[^\n]*\n.*?^```\s*$")
docs = {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8") for p in sorted(root.rglob("*.md"))}
allmd = "\n".join(docs.values())

# 1. frontmatter
skill = docs["SKILL.md"]
m = re.match(r"---\n(.*?)\n---\n", skill, re.S)
fm = dict(re.findall(r'(?m)^(\w+):\s*"(.*)"\s*$', m.group(1))) if m else {}
check("frontmatter has only name + description", m is not None and set(fm) == {"name", "description"}, fm.keys())
check("name matches folder and naming rules", fm.get("name") == root.name and re.fullmatch(r"[a-z0-9-]{1,64}", fm.get("name", "")) is not None)
check("description <= 1024 chars, no angle brackets", 0 < len(fm.get("description", "")) <= 1024 and not re.search(r"[<>]", m.group(1)), len(fm.get("description", "")))
check("frontmatter identical to the saved skill", src.split("\n---\n", 1)[0] == skill.split("\n---\n", 1)[0])

# 2. sizes and navigation aids
n = skill.count("\n")
check(f"SKILL.md under 500 lines ({n})", n < 500)
for name, text in docs.items():
    if name.startswith("references/"):
        check(f"{name}: has a Contents line and points back to SKILL.md", "\nContents: " in text and "`SKILL.md`" in text)

# 3. every bundled file is linked from SKILL.md and every link resolves
links = set(re.findall(r"\]\(((?:references|scripts)/[^)]+)\)", skill))
files = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()} - {"SKILL.md"}
check("all links in SKILL.md resolve", links <= files, links - files)
check("no orphan files", files <= links, files - links)
if VARIANT == "copilot":
    check("no Claude Code-only syntax left", "CLAUDE_SKILL_DIR" not in allmd and "Claude Code" not in allmd)
    check("scanner path given relative to the skill folder", "/.copilot/skills/powerbi-visual-builder/scripts/scan_visuals.py" in skill)
else:
    check("script invoked through ${CLAUDE_SKILL_DIR}", '"${CLAUDE_SKILL_DIR}/scripts/scan_visuals.py"' in skill)
nested = {k: re.findall(r"\]\((?!https?:)[^)]+\.md\)", v) for k, v in docs.items() if k != "SKILL.md"}
check("references hold no nested markdown links", not any(nested.values()), nested)

# 4. code blocks: every block in the saved skill survives byte-for-byte, except the scanner (moved to scripts/)
src_blocks = collections.Counter(FENCE.findall(src))
new_blocks = collections.Counter(FENCE.findall(allmd))
scanner = [b for b in src_blocks if "ALLOWED = re.compile" in b]
missing = src_blocks - new_blocks
check(f"{sum(src_blocks.values())} code blocks: all but the scanner preserved exactly",
      list(missing) == scanner and len(scanner) == 1, [b[:60] for b in missing])
added = new_blocks - src_blocks
check("only one new code block (the scanner command)", len(added) == 1 and "scan_visuals.py" in next(iter(added)), [b[:60] for b in added])

# 5. prose: every non-code line of the saved skill appears unchanged, except the intended edits
def prose(text):
    return [l for l in FENCE.sub("", text).splitlines() if l.strip() and l.strip() != "---"]
newlines = set(prose(allmd))
changed = [l for l in prose(src.split("\n---\n", 1)[1]) if l not in newlines]
EXPECTED = ["(see section 13)", "Contents: 1 Guardrails", "## 5. Native visuals", "## 6. SVG measures", "## 7. Deneb",
            "## 8. Custom visuals", "## 9. HTML Content", "## 10. Python and R", "## 11. Validation", "## 12. Delivery",
            "## 13. Baseline", "6. Validate (section 11)", "(guardrails 1–2).", "keep guardrails 1–2.", "(guardrail 1)",
            "Only when rung 5 applies (section 3)", "(section 5, step 5)", "Use only when section 3 says so",
            "2. **Forbidden patterns**", "- Tested:"] + (["6. **Data minimization**"] if VARIANT == "copilot" else [])
unexpected = [l for l in changed if not any(e in l for e in EXPECTED)]
check(f"prose preserved: {len(changed)} intended line edits, none unexpected", not unexpected, [l[:80] for l in unexpected])
for e in EXPECTED:
    hits = [l for l in changed if e in l]
    check(f"  edit applied: {e!r}", len(hits) == 1, len(hits))

# 6. leftover old cross-references and script syntax
stale = re.findall(r"section 1[0-3]\b|section 5, step 5", allmd)
check("no stale section numbers", not stale, stale)
try:
    py_compile.compile(str(root / "scripts/scan_visuals.py"), cfile=str(pathlib.Path(tempfile.gettempdir()) / "scan_check.pyc"), doraise=True)
    check("scan_visuals.py compiles", True)
except py_compile.PyCompileError as e:
    check("scan_visuals.py compiles", False, e)

print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
