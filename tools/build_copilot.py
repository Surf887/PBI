"""Make the GitHub Copilot variant of the folder skill (exact, counted replacements only).

usage: python tools/build_copilot.py <claude-code skill folder> <output skill folder>
"""
import pathlib, shutil, sys

src, out = map(pathlib.Path, sys.argv[1:3])
if out.exists():
    shutil.rmtree(out)
shutil.copytree(src, out, ignore=shutil.ignore_patterns("__pycache__"))
skill = out / "SKILL.md"
t = skill.read_text(encoding="utf-8")

EDITS = [
    ('```bash\npython -I "${CLAUDE_SKILL_DIR}/scripts/scan_visuals.py" <files or folders>\n```',
     '```powershell\npython -I "$HOME/.copilot/skills/powerbi-visual-builder/scripts/scan_visuals.py" <files or folders>\n```'),
    ("`${CLAUDE_SKILL_DIR}` is this skill's folder (Claude Code fills it in; elsewhere use the folder's real path). On Windows, use `py -3 -I` if `python` is not found.",
     "The scanner is `scripts/scan_visuals.py` next to this SKILL.md: the command above is for a personal install in `~/.copilot/skills/`; if the skill lives elsewhere (for example `.github/skills/` in the repository), use that folder's path. Use `py -3 -I` if `python` is not found."),
    ("6. **Data minimization**: work from field names, not data.",
     "6. **Data minimization**: work from field names, not data. Never open `.pbi/cache.abf`, `.pbix`/`.pbit` files or data exports (CSV, Excel): they hold data, and the PBIR/TMDL metadata is all you need."),
]
for old, new in EDITS:
    n = t.count(old)
    assert n == 1, f"{n} x {old[:50]!r}"
    t = t.replace(old, new)
assert "CLAUDE_SKILL_DIR" not in t and "Claude Code" not in t
skill.write_text(t, encoding="utf-8", newline="\n")
print("SKILL.md:", t.count("\n"), "lines")
