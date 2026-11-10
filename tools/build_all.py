"""Rebuild everything generated in this repository from its sources.

  skills/claude-ai/SKILL.md + tools/scan_visuals.py  ->  skills/claude-code/powerbi-visual-builder/
  skills/claude-code/powerbi-visual-builder/          ->  skills/copilot/powerbi-visual-builder/
  app/src/                                            ->  app/pbi-visual-builder-offline.html and app/SHA256SUMS

usage: python tools/build_all.py          rebuild in place
       python tools/build_all.py --check  rebuild in a temporary folder and list anything out of date (exit 1)
"""
import pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
OUTPUTS = ["skills/claude-code/powerbi-visual-builder", "skills/copilot/powerbi-visual-builder",
           "app/pbi-visual-builder-offline.html", "app/SHA256SUMS"]


def run(*args):
    r = subprocess.run([sys.executable, "-I", *map(str, args)], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"build step failed: {' '.join(map(str, args))}\n{r.stdout}{r.stderr}")


def build(target):
    claude_code = target / "skills/claude-code/powerbi-visual-builder"
    copilot = target / "skills/copilot/powerbi-visual-builder"
    for d in (claude_code, copilot):
        if d.exists():
            shutil.rmtree(d)
    run(TOOLS / "build_folder.py", ROOT / "skills/claude-ai/SKILL.md", TOOLS / "scan_visuals.py", claude_code)
    run(TOOLS / "build_copilot.py", claude_code, copilot)
    run(TOOLS / "build_app.py", ROOT / "app/src", target / "app/pbi-visual-builder-offline.html")


def files(p):
    return sorted(x.relative_to(p).as_posix() for x in p.rglob("*") if x.is_file())


if "--check" in sys.argv:
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        build(tmp)
        stale = []
        for rel in OUTPUTS:
            have, want = ROOT / rel, tmp / rel
            if want.is_dir():
                if not have.is_dir() or files(have) != files(want):
                    stale.append(f"{rel} (different files)")
                    continue
                stale += [f"{rel}/{f}" for f in files(want) if (have / f).read_bytes() != (want / f).read_bytes()]
            elif not have.is_file() or have.read_bytes() != want.read_bytes():
                stale.append(rel)
        print("\n".join(f"out of date: {s}" for s in stale) or "all generated files match their sources")
        sys.exit(1 if stale else 0)

build(ROOT)
print("rebuilt: " + ", ".join(OUTPUTS))
