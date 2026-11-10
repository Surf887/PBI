"""Differential + behaviour tests: new scripts/scan_visuals.py vs the tested inline scanner (scan_v3.py)."""
import json, os, pathlib, subprocess, sys, tempfile

OLD, NEW, CASES = map(pathlib.Path, sys.argv[1:4])
EXTRA_DIRS = [pathlib.Path(p) for p in sys.argv[4:]]
PY = sys.executable
fails = []
KNOWN_FIXES = {"n07_theme_icon.json", "n13_theme_pretty.json", "n17_href_data_image.json", "p34_tsx_dangerous.tsx", "p35_d3_html.ts",
               "p36_innerhtml_append.ts", "p37_setinterval_string.js"}


def run(script, *args, env=None, isolated=True):
    cmd = [PY] + (["-I"] if isolated else []) + [str(script)] + [str(a) for a in args]
    r = subprocess.run(cmd, capture_output=True, env=env)
    return r.returncode, r.stdout.decode("utf-8", "replace"), r.stderr.decode("utf-8", "replace")


def norm(out):   # old scanner prints "clean", new prints "clean (N files)"; old url-key matches kept a trailing space
    return "clean" if out.strip().startswith("clean") else "\n".join(l.rstrip() for l in out.strip().splitlines())


def check(label, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + label + (f"  [{detail}]" if detail and not ok else ""))
    if not ok:
        fails.append(label)


# 1. per-case: same verdict and same hit lines as the tested scanner, and the expected verdict
expected = json.loads((CASES.parent / "expected.json").read_text())
for name, verdict in expected.items():
    f = CASES / name
    oc, oo, _ = run(OLD, f)
    nc, no, ne = run(NEW, f)
    right = (nc == 1) == (verdict == "hit")
    if name in KNOWN_FIXES:   # intended change: the tested scanner got these wrong
        check(f"case {name}: {verdict} (fixed; tested scanner exit {oc})", right and oc != nc, f"old={oc} new={nc}:{no.strip()[:90]}")
    else:
        same = (oc, norm(oo)) == (nc, norm(no))
        check(f"case {name}: {verdict}", same and right, f"old={oc}:{oo.strip()[:90]} new={nc}:{no.strip()[:90]} {ne.strip()[:90]}")

# 2. whole folders: the case set must report exactly the expected files; other folders match the tested scanner
nc, no, _ = run(NEW, CASES)
hit_files = {pathlib.Path(l.split(":")[0]).relative_to(CASES).as_posix() for l in no.strip().splitlines()}
want = {k for k, v in expected.items() if v == "hit"}
check(f"folder {CASES}: {len(hit_files)} files flagged, all expected", hit_files == want, f"extra={hit_files - want} missing={want - hit_files}")
for d in EXTRA_DIRS:
    oc, oo, _ = run(OLD, d)
    nc, no, _ = run(NEW, d)
    check(f"folder {d}: old={oc} new={nc} ({no.strip().splitlines()[-1][:60] if no.strip() else ''})",
          (oc, sorted(norm(oo).splitlines())) == (nc, sorted(norm(no).splitlines())))

# 3. new behaviour
with tempfile.TemporaryDirectory() as tmp:
    tmp = pathlib.Path(tmp)
    (tmp / "empty").mkdir()
    (tmp / "pngs").mkdir()
    (tmp / "pngs" / "a.png").write_bytes(b"\x89PNG")
    u16 = tmp / "u16.dax"
    u16.write_text("M = \"<svg><script>x()</script></svg>\"\r\nN = 1\r\n", encoding="utf-16")
    crlf = tmp / "crlf.json"
    crlf.write_bytes(b'{\r\n "a": 1,\r\n "data": {"url": "x.csv"}\r\n}\r\n')
    code, out, err = run(NEW)
    check("no arguments -> exit 2 with usage", code == 2 and "usage" in err, f"{code} {err[:80]}")
    code, out, err = run(NEW, tmp / "nope")
    check("missing path -> exit 2, not 'clean'", code == 2 and "not found" in err and "clean" not in out, f"{code} {out} {err}")
    code, out, err = run(NEW, tmp / "empty")
    check("empty folder -> exit 2", code == 2 and "no scannable files" in err, f"{code} {err}")
    code, out, err = run(NEW, tmp / "pngs")
    check("folder with no scannable types -> exit 2", code == 2, f"{code} {err}")
    code, out, err = run(NEW, u16)
    check("UTF-16 file is decoded and the <script> found on line 1", code == 1 and ":1: active content" in out, f"{code} {out}")
    oc, oo, _ = run(OLD, u16)
    print(f"     (tested inline scanner on the same UTF-16 file: exit {oc}, {oo.strip()[:60]!r})")
    code, out, err = run(NEW, crlf)
    check("CRLF file: hit reported on line 3", code == 1 and ":3: remote data/link key" in out, f"{code} {out}")
    env = dict(os.environ, PYTHONIOENCODING="cp1252")
    code, out, err = run(NEW, CASES / "p30_unicode_match.html", env=env, isolated=False)
    check("cp1252 console + non-ASCII match -> no crash", code == 1 and "Traceback" not in err, f"{code} {err[-120:]}")
    oc, oo, oe = run(OLD, CASES / "p30_unicode_match.html", env=env, isolated=False)
    print(f"     (tested inline scanner under cp1252: exit {oc}, {'crashed' if 'Traceback' in oe else 'ok'})")
    less_dir = tmp / "style"
    less_dir.mkdir()
    (less_dir / "visual.less").write_text('@import url("https://fonts.example/f.css");', encoding="utf-8")
    code, out, err = run(NEW, less_dir)
    oc, oo, _ = run(OLD, less_dir)
    check(f"style/ folder with a remote @import is flagged (tested scanner: exit {oc} {oo.strip()!r})", code == 1 and "remote CSS" in out, out)
    code, out, err = run(NEW, CASES / "n01_svg_ok.svg", CASES / "n02_pbir_schema.json")
    check("clean output reports file count", code == 0 and out.strip() == "clean (2 files)", out)

print(f"\n{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED'}")
sys.exit(1 if fails else 0)
