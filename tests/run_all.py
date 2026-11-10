"""Run every check in this repository and print a summary.

usage: python tests/run_all.py

Needs Python 3.10+. These parts run only when their tools are present (otherwise they are reported as SKIP):
  - Node.js 20+: core tests of the offline app
  - npm ci --prefix tests/app: Deneb specs compiled with Vega-Lite 6.4.3
  - pip install playwright, plus Chrome or Edge (CHROME_PATH to choose one): browser tests
  - pip install jsonschema, and PBIR_SCHEMAS = path of fabric/item/report/definition in a clone of
    https://github.com/microsoft/json-schemas: validation of written PBIR files
"""
import os, pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PY = sys.executable
CC = ROOT / "skills/claude-code/powerbi-visual-builder"
CP = ROOT / "skills/copilot/powerbi-visual-builder"
results = []


def step(name, cmd, skip_code=None, env=None):
    print(f"\n=== {name}", flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=ROOT, env=env)
    status = "SKIP" if skip_code is not None and r.returncode == skip_code else "PASS" if r.returncode == 0 else "FAIL"
    results.append((status, name))


def note(status, name, why):
    print(f"\n=== {name}\n{status}: {why}", flush=True)
    results.append((status, name))


def inline_scanner_matches_script():
    skill = (ROOT / "skills/claude-ai/SKILL.md").read_text(encoding="utf-8")
    start = skill.index('```python\n"""Read-only scan') + len("```python\n")
    block = skill[start:skill.index("\n```", start) + 1]
    script = (ROOT / "tools/scan_visuals.py").read_text(encoding="utf-8")
    script = script.replace("#!/usr/bin/env python3\n", "", 1)
    script = script.replace("\nPart of the powerbi-visual-builder skill (SKILL.md section 6, step 2).\n", "\n", 1)
    return block == script


with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    (tmp / "cases").mkdir()
    (tmp / "out").mkdir()

    step("generated files match their sources", [PY, "-I", ROOT / "tools/build_all.py", "--check"])
    step("Claude Code skill: structure and content", [PY, "-I", ROOT / "tests/skill/check_structure.py", ROOT / "skills/claude-ai/SKILL.md", CC])
    step("Copilot skill: structure and content", [PY, "-I", ROOT / "tests/skill/check_structure.py", ROOT / "skills/claude-ai/SKILL.md", CP, "copilot"])
    if inline_scanner_matches_script():
        note("PASS", "single-file skill's scanner = tools/scan_visuals.py", "same code")
    else:
        note("FAIL", "single-file skill's scanner = tools/scan_visuals.py", "the two copies differ")

    step("scanner: build regression cases", [PY, "-I", ROOT / "tests/scanner/make_cases.py", tmp / "cases"])
    step("scanner: regression and behaviour tests", [PY, "-I", ROOT / "tests/scanner/run_scanner_tests.py",
         ROOT / "tests/scanner/baseline_scan_v3.py", CC / "scripts/scan_visuals.py", tmp / "cases",
         ROOT / "tests/scanner/fixtures/good", ROOT / "tests/scanner/fixtures/bad"])
    step("app: build sample PBIP projects", [PY, "-I", ROOT / "tests/app/make_sample_pbip.py", tmp / "samples"])

    node = shutil.which("node")
    if node:
        step("app: core logic (generators, validation, scanner parity, PBIP writer)",
             [node, ROOT / "tests/app/test_core.js", ROOT / "app/src/core.js", CC / "references", CC / "scripts/scan_visuals.py",
              tmp / "cases", tmp / "samples", tmp / "out"], env=dict(os.environ, PYTHON=PY))
        if (ROOT / "tests/app/node_modules/vega-lite").is_dir():
            step("app: Deneb specs compile with Vega-Lite 6.4.3", [node, ROOT / "tests/app/deneb_test.mjs", ROOT / "app/src/core.js"])
        else:
            note("SKIP", "app: Deneb specs compile with Vega-Lite 6.4.3", "run: npm ci --prefix tests/app")
    else:
        note("SKIP", "app: core logic and Deneb compile", "Node.js not found")

    step("app: browser tests (security policy, generators, PBIP write, backup, undo, scan)",
         [PY, ROOT / "tests/app/test_browser.py", ROOT / "app/pbi-visual-builder-offline.html", tmp / "samples/sample1",
          tmp / "cases", CC / "scripts/scan_visuals.py", ROOT / "tools/validate_pbir.py",
          os.environ.get("PBIR_SCHEMAS", "-"), tmp / "browser"], skip_code=3)

print("\n" + "\n".join(f"{s:4}  {n}" for s, n in results))
failed = sum(s == "FAIL" for s, _ in results)
print(f"\n{len(results) - failed} of {len(results)} steps passed or skipped, {failed} failed")
sys.exit(1 if failed else 0)
