"""Split the single-file skill (skills/claude-ai/SKILL.md) into the folder skill for Claude Code.

usage: python tools/build_folder.py <source SKILL.md> <scanner.py> <output dir>
Every edit is an exact, counted string replacement so nothing changes silently.
"""
import pathlib, re, sys

src_path, scanner_path, out_dir = map(pathlib.Path, sys.argv[1:4])
src = src_path.read_text(encoding="utf-8")


def rep(text, old, new, count=1):
    found = text.count(old)
    assert found == count, f"expected {count} x {old[:60]!r}, found {found}"
    return text.replace(old, new)


# ---- split frontmatter, preamble and the 13 numbered sections -------------
assert src.startswith("---\n")
fm_end = src.index("\n---\n", 4) + len("\n---\n")
frontmatter, body = src[:fm_end], src[fm_end:]
parts = re.split(r"(?m)^(?=## \d+\. )", body)
preamble, sections = parts[0], {}
for p in parts[1:]:
    m = re.match(r"## (\d+)\. (.*)\n", p)
    content = re.sub(r"\n---\n\s*$", "\n", p[m.end():])          # drop the trailing rule
    sections[int(m.group(1))] = (m.group(2), content.strip("\n") + "\n")
assert sorted(sections) == list(range(1, 14)), sorted(sections)


def section(n, new_n=None, title=None):
    t, c = sections[n]
    return f"## {new_n or n}. {title or t}\n\n{c}"


# ---- SKILL.md (always loaded) --------------------------------------------
pre = rep(preamble, "(see section 13)", "(see section 8)")
pre = rep(pre,
          "Contents: 1 Guardrails · 2 Intake · 3 Choose the technology · 4 Chart choice and design · 5 Native visuals (PBIR) · 6 SVG measures · 7 Deneb · 8 Custom visuals (SDK) · 9 HTML Content Secure · 10 Python/R · 11 Validation · 12 Delivery · 13 Facts and sources",
          "This file holds the rules for every task. Templates and file formats for each technology are in `references/`: read only the files the task needs (section 5). The validation scanner is `scripts/scan_visuals.py`: run it, don't read it.\n\n"
          "Contents: 1 Guardrails · 2 Intake · 3 Choose the technology · 4 Chart choice and design · 5 Reference files · 6 Validation · 7 Delivery · 8 Baseline and sources")

REFS = """## 5. Reference files (read only what the task needs)

| Read | When the task involves | Inside |
|---|---|---|
| [references/pbir-native.md](references/pbir-native.md) | Mode B: editing PBIP/PBIR files (`visual.json`, `report.json`, `pages.json`), adding or registering any visual; also rung 1 formatting to try before SVG (data bars, icons, sparklines, colour by measure) | Folder map, before-editing checks, minimal `visual.json`, field references, literal encoding, visual types and roles, steps to add a visual, pitfalls, native formatting to try first |
| [references/svg-measures.md](references/svg-measures.md) | Rung 2: micro-charts inside a table, matrix, card, image or slicer | SVG rules; templates A bullet, B progress bar, C sparkline, D status pill, E escaping UDF; wiring into hosts |
| [references/deneb.md](references/deneb.md) | Rung 3: a bespoke interactive chart | Deneb 2.x facts, authoring rules, lollipop, variance and Gantt specs, config, UI steps, portable template, Python builder for PBIR |
| [references/custom-visual-sdk.md](references/custom-visual-sdk.md) | Rung 5, mode C: a `pbiviz` project | Pinned toolchain and commands, `capabilities.json`, secure coding rules, `src/visual.ts` skeleton, distribution |
| [references/html-and-python.md](references/html-and-python.md) | Rung 4 (HTML Content Secure) or rung 6 (Python/R) | Visual GUIDs, KPI tile DAX, Python/R limits, matplotlib template |
| [scripts/scan_visuals.py](scripts/scan_visuals.py) | Every delivery (section 6, step 2) | Read-only forbidden-pattern scan: run it, don't load it |

A mixed build loads several files: for example, a PBIR page with SVG bullets in a matrix and a Deneb chart needs `pbir-native.md`, `svg-measures.md` and `deneb.md`. Section 1 applies to everything in these files, and nothing in them overrides it.
"""

val_title, val = sections[11]
old_step2_start = val.index("2. **Forbidden patterns**")
old_step2_end = val.index("```\n", val.index("```python") + 9) + len("```\n")
NEW_STEP2 = """2. **Forbidden patterns**: run the bundled read-only scanner (Python 3 standard library only; it never writes, deletes or sends anything) over everything you generated:

```bash
python -I "${CLAUDE_SKILL_DIR}/scripts/scan_visuals.py" <files or folders>
```

`${CLAUDE_SKILL_DIR}` is this skill's folder (Claude Code fills it in; elsewhere use the folder's real path). On Windows, use `py -3 -I` if `python` is not found. In mode B, scan both `<Name>.Report/definition/` and `<Name>.SemanticModel/definition/` (TMDL measures and `functions.tmdl` live there). In mode C, scan `src/`, `style/` and `capabilities.json`. Output: `clean (N files)` with exit code 0; or one `path:line: rule: match` per hit with exit code 1; or exit code 2 for a missing path or no scannable files. It flags external URLs (except `$schema`/Vega schema URLs, the SVG namespace and `supportUrl`/`gitHubUrl` metadata), active content (`<script>`, `<iframe>`, `<object>`, `<embed>`, `<foreignObject>`, `<use>`, `javascript:`, `xlink:href`, `on*=` handlers), remote CSS (`@import`, `url()` other than `#id` or `data:image/`), dynamic code (`eval`, `new Function`, `innerHTML`/`outerHTML` writes, `insertAdjacentHTML`, `dangerouslySetInnerHTML`, d3/jQuery `.html()`, string timers), `url`/`href` keys not pointing at `data:image/`, network privileges (`WebAccess`, `XMLHttpRequest`, `fetch(`, `WebSocket`) and `%23` colours in DAX/TMDL measures. In folders it reads JSON, DAX, TMDL, SVG, HTML, CSS/LESS, TS/TSX, JS/JSX, Python, R, text and Markdown files (a file named explicitly is read whatever its type) and skips `node_modules`, `dist`, `.tmp`, `.git`, `.vscode`, `.pbi` and `package-lock.json`. Fix every hit, or explain to the user why it is safe; never edit the scanner to silence a hit. If Python is unavailable, do the same checks by reading the files and say so in the delivery.
"""
val = val[:old_step2_start] + NEW_STEP2 + val[old_step2_end:]

base_title, base = sections[13]
base = rep(base, "the scanner passed 23 targeted false-positive/false-negative cases plus a 56-case regression set, and also checks CSS/LESS/TSX/JSX files.",
           "the scanner passed 23 targeted false-positive/false-negative cases; `scripts/scan_visuals.py` (the same code as the single-file version's scanner) passed a 56-case regression set plus checks for missing paths, empty folders, UTF-16/CRLF files and non-UTF-8 consoles.")

# cross-references that point at sections moved or renumbered in the folder build
s2 = rep(sections[2][1], "Check it against section 1 and section 11, use the symptom table at the end of section 11",
         "Check it against section 1 and section 6, use the symptom table at the end of section 6")
s3 = rep(sections[3][1], "sparklines cannot draw it (section 5)",
         "sparklines cannot draw it (`references/pbir-native.md`, *Native formatting*)")
s4 = rep(sections[4][1], "(section 7, spec 3)", "(`references/deneb.md`, spec 3)")
sections[2], sections[3], sections[4] = (sections[2][0], s2), (sections[3][0], s3), (sections[4][0], s4)
val = rep(val, "Data category is not Image URL (section 6)", "Data category is not Image URL (`references/svg-measures.md`)")
val = rep(val, "(section 6, wiring)", "(`references/svg-measures.md`, *Wiring into hosts*)")
val = rep(val, "fit missing (section 7)", "fit missing (`references/deneb.md`)")
val = rep(val, "| Section 5 pitfalls: most often", "| `references/pbir-native.md` pitfalls: most often")
base = rep(base, "the section 5 colour measure", "the colour measure in `references/pbir-native.md`")
base = rep(base, "the symptom table in section 11", "the symptom table in section 6")

skill_md = (frontmatter + pre
            + "\n---\n\n".join([section(1), section(2), section(3), section(4), REFS,
                                f"## 6. {val_title}\n\n{val}", section(12, 7), f"## 8. {base_title}\n\n{base}"]))

# ---- reference files (loaded on demand) ----------------------------------
NOTE = ("Reference for the `powerbi-visual-builder` skill, loaded when `SKILL.md` section 5 points here. "
        "The guardrails (section 1), validation (section 6) and delivery format (section 7) in `SKILL.md` "
        "apply to everything in this file, and nothing here overrides them.")


def ref(title, contents, body):
    return f"# {title}\n\n{NOTE}\n\nContents: {contents}\n\n{body}"


t5, c5 = sections[5]
c5 = rep(c5, "6. Validate (section 11), then", "6. Validate (`SKILL.md` section 6), then")
c5 = rep(c5, "Colour never carries the message alone (section 4)", "Colour never carries the message alone (`SKILL.md` section 4)")
c5 = rep(c5, "and copy its shape (guardrail 11).", "and copy its shape (`SKILL.md` guardrail 11).")
t6, c6 = sections[6]
c6 = rep(c6, "external `href`s or web fonts (guardrails 1–2).", "external `href`s or web fonts (`SKILL.md` guardrails 1–2).")
c6 = rep(c6, "and keep guardrails 1–2.", "and keep `SKILL.md` guardrails 1–2.")
t7, c7 = sections[7]
c7 = rep(c7, "(guardrail 1)", "(`SKILL.md` guardrail 1)")
c7 = rep(c7, "(guardrail 6 still holds)", "(`SKILL.md` guardrail 6 still holds)")
t8, c8 = sections[8]
c8 = rep(c8, "Only when rung 5 applies (section 3).", "Only when rung 5 applies (`SKILL.md` section 3).")
c8 = rep(c8, "(section 5, step 5)", "(`pbir-native.md`, *Adding a visual*, step 5)")
t9, c9 = sections[9]
t10, c10 = sections[10]
c10 = rep(c10, "Use only when section 3 says so", "Use only when `SKILL.md` section 3 says so")

files = {
    "SKILL.md": skill_md,
    "references/pbir-native.md": ref(t5, "Folder map · Before editing · Minimal `visual.json` · Field references · Literal encoding · Visual types and roles · Adding a visual · Pitfalls · Native formatting to try before SVG or Deneb", c5),
    "references/svg-measures.md": ref(t6, "Rules · A Bullet · B Progress bar · C Sparkline · D Status pill · E Escaping data-driven text (UDF) · Wiring into hosts", c6),
    "references/deneb.md": ref(t7, "Facts · Authoring rules · Spec 1 ranked lollipop · Spec 2 actual vs prior year · Spec 3 Gantt · Config · Apply in the UI · Portable template · Embedding in PBIR (Python builder)", c7),
    "references/custom-visual-sdk.md": ref(t8, "Toolchain · `capabilities.json` essentials · Secure coding rules · Skeleton `src/visual.ts` · Distribution", c8),
    "references/html-and-python.md": ref("HTML Content Secure and Python/R visuals",
                                         "HTML Content Secure (rung 4) · Python and R visuals (rung 6, last resort)",
                                         f"## {t9}\n\n{c9}\n## {t10}\n\n{c10}"),
    "scripts/scan_visuals.py": scanner_path.read_text(encoding="utf-8"),
}
for rel, text in files.items():
    p = out_dir / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8", newline="\n")
    print(f"{rel}: {text.count(chr(10))} lines")
