"""Browser tests for the offline app in Google Chrome or Microsoft Edge (Playwright).

usage: python -I tests/app/test_browser.py <app.html> <sample1 dir> <scanner cases dir> <python scanner> <validate_pbir.py> <schemas dir or -> <out dir>
Browser: CHROME_PATH if set, otherwise installed Chrome, then Edge. Exit code 3 means skipped (no browser or Playwright).
Part 1 opens the file from disk (file://): security policy, generators, downloads, keyboard use, layout.
Part 2 serves it from 127.0.0.1 with the folder picker stubbed by the browser's private file system (OPFS)
to exercise the PBIP writer, backup, undo and the folder scan end to end.
"""
import base64, functools, http.server, json, os, pathlib, re, subprocess, sys, threading

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("SKIP: Playwright is not installed (pip install playwright)")
    sys.exit(3)

APP, SAMPLE, CASES, PYSCAN, VALIDATE, SCHEMAS, OUT = map(pathlib.Path, sys.argv[1:8])
OUT.mkdir(parents=True, exist_ok=True)
fails = 0


def check(label, ok, detail=""):
    global fails
    print(("PASS " if ok else "FAIL ") + label + ("" if ok or not detail else f"  [{detail}]"))
    fails += 0 if ok else 1


CSP_SPY = """
window.__csp = [];
document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
"""
OPFS_PICKER = """
window.showDirectoryPicker = async (opts) => {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(opts && opts.id === "scan" ? "cases" : "proj");
};
"""


def files_of(folder):
    return {p.relative_to(folder).as_posix(): base64.b64encode(p.read_bytes()).decode()
            for p in sorted(folder.rglob("*")) if p.is_file()}


with sync_playwright() as pw:
    browser = None
    attempts = [{"executable_path": os.environ["CHROME_PATH"]}] if os.environ.get("CHROME_PATH") else [{"channel": "chrome"}, {"channel": "msedge"}]
    for how in attempts:
        try:
            browser = pw.chromium.launch(headless=True, **how)
            break
        except Exception:
            continue
    if browser is None:
        print("SKIP: no Chrome or Edge found (set CHROME_PATH)")
        sys.exit(3)

    # ------------------------------------------------------------------ part 1: file://
    ctx = browser.new_context(accept_downloads=True, viewport={"width": 1366, "height": 900})
    outbound = []
    ctx.route(re.compile(r"^(https?|wss?|ftp)://"), lambda route: (outbound.append(route.request.url), route.abort()))
    page = ctx.new_page()
    errors, console = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append(f"{m.type}: {m.text}"))
    page.add_init_script(CSP_SPY)
    page.goto(APP.resolve().as_uri())
    page.wait_for_selector("html[data-ready='true']", timeout=5000)
    check("page starts with no script errors (the hash-based security policy lets both scripts run)", not errors, errors)
    check("no security-policy violations at start", page.evaluate("window.__csp.length") == 0, page.evaluate("window.__csp"))
    check("default SVG output = PBI.svgBullet({})", page.evaluate("document.querySelector('#o-svg code').textContent === PBI.svgBullet({})"))
    badges = page.evaluate("[...document.querySelectorAll('.out .badge')].map(b => b.textContent)")
    check(f"all {len(badges)} scanned outputs show 'Scan: clean'", badges and all(b == "Scan: clean" for b in badges), badges)
    check("folder access available on file:// in Chrome", page.evaluate("typeof window.showDirectoryPicker") == "function")

    # security policy: network, injected script, image beacons and inline styles are blocked
    res = page.evaluate("""async () => { try { await fetch('https://example.com/x'); return 'fetched'; } catch (e) { return 'blocked'; } }""")
    check("fetch to the internet is blocked", res == "blocked", res)
    res = page.evaluate("""() => new Promise((ok) => { try { const ws = new WebSocket('wss://example.com/s'); ws.onerror = () => ok('blocked'); ws.onopen = () => ok('open'); } catch (e) { ok('blocked'); } setTimeout(() => ok('timeout'), 1500); })""")
    check("WebSocket is blocked", res == "blocked", res)
    page.evaluate("""() => { const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.body.append(s); }""")
    page.evaluate("""() => { const i = new Image(); i.src = 'https://example.com/pixel.png'; document.body.append(i); }""")
    page.evaluate("""() => { const d = document.createElement('div'); d.setAttribute('onclick', 'window.__injected2 = 1'); document.body.append(d); d.click(); }""")
    page.wait_for_timeout(500)
    check("an injected inline script does not run", page.evaluate("window.__injected === undefined"))
    check("an injected event-handler attribute does not run", page.evaluate("window.__injected2 === undefined"))
    csp = page.evaluate("window.__csp")
    check("the browser reported the blocked script, image and handler", any(c.startswith("script-src") for c in csp) and any(c.startswith("img-src") for c in csp), csp)
    check("no request reached the network", not outbound, outbound)
    page.evaluate("() => document.querySelectorAll('body > img, body > div:not([class])').forEach((n) => n.remove())")   # test probes out of screenshots

    # generators react to input; validation messages appear
    page.click("#tab-svg")
    page.select_option("#f-svg select[name=template]", "sparkline")
    page.fill("input[name='sparkline.dateTable']", "Calendar")
    page.wait_for_timeout(300)
    code = page.text_content("#o-svg code")
    check("SVG sparkline updates as you type", "Sparkline SVG =" in code and "'Calendar'[Month Start]" in code)
    page.fill("input[name='sparkline.name']", 'Bad"Name')
    page.wait_for_timeout(300)
    err = page.text_content("#f-svg .error")
    check("invalid input shows a message and dims the output",
          page.is_visible("#f-svg .error") and "no quotes" in err and "stale" in page.get_attribute("#o-svg", "class"), err)
    page.fill("input[name='sparkline.name']", "Sparkline SVG")
    page.wait_for_timeout(300)
    check("fixing the input clears the message", not page.is_visible("#f-svg .error"))

    # recommendation flows into the right generator
    page.click("#tab-recommend")
    page.select_option("#f-recommend select[name=task]", "target")
    page.select_option("#f-recommend select[name=place]", "incell")
    page.wait_for_timeout(200)
    check("recommendation: actual vs target in rows -> bullet", "Bullet chart in each row" in page.text_content("#recommend-out"))
    check("recommendation card has no stray 'null' text", "null" not in page.text_content("#recommend-out"))
    page.click("#recommend-out button")
    check("Open the generator switches to the SVG tab with Bullet selected",
          page.get_attribute("#tab-svg", "aria-selected") == "true" and page.input_value("#f-svg select[name=template]") == "bullet")

    # download
    with page.expect_download() as d:
        page.click("#o-svg .out-head button:has-text('Download')")
    dl = d.value
    saved = OUT / dl.suggested_filename
    dl.save_as(saved)
    check(f"download works under the security policy ({dl.suggested_filename})",
          dl.suggested_filename == "Bullet-SVG.dax" and saved.read_text(encoding="utf-8") == page.evaluate("PBI.svgBullet({})"))

    # copy
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page.click("#o-svg .out-head button:has-text('Copy')")
    page.wait_for_timeout(200)
    check("copy button reports success", page.text_content("#o-svg .out-head button:has-text('Cop')") == "Copied")

    # Deneb and native forms
    page.click("#tab-deneb")
    check("project bar shows on the Deneb tab", page.is_visible("#project"))
    page.select_option("#f-deneb select[name=chart]", "variance")
    page.fill("#f-deneb input[name=actual]", "Finance[Actual €]")
    page.wait_for_timeout(300)
    spec = json.loads(page.text_content("#o-deneb-spec code"))
    tpl = page.text_content("#o-deneb-template code")
    vis = json.loads(page.text_content("#o-deneb-visual code"))
    check("Deneb variance spec uses the typed field names", spec["layer"][1]["encoding"]["x"]["field"] == "Actual €")
    check("Deneb template contains placeholders only", "__dataset.2__" in tpl and "Actual €" not in tpl)
    check("Deneb visual.json embeds the same spec", json.loads(vis["visual"]["objects"]["vega"][0]["properties"]["jsonSpec"]["expr"]["Literal"]["Value"][1:-1].replace("''", "'")) == {k: v for k, v in spec.items() if k != "$schema"})
    page.click("#tab-native")
    page.select_option("#f-native select[name=visualType]", "pivotTable")
    page.fill("#f-native input[name=imageHeight]", "24")
    page.wait_for_timeout(300)
    check("native: half-filled image size is refused", "both height and width" in (page.text_content("#f-native .error") or ""))
    page.fill("#f-native input[name=imageWidth]", "120")
    page.wait_for_timeout(300)
    nat = json.loads(page.text_content("#o-native code"))
    check("native matrix visual.json has Rows, Values and image size",
          nat["visual"]["visualType"] == "pivotTable" and "Rows" in nat["visual"]["query"]["queryState"] and nat["visual"]["objects"]["grid"][0]["properties"]["imageHeight"]["expr"]["Literal"]["Value"] == "24D")
    page.click("#tab-htmlpy")
    page.select_option("#f-htmlpy select[name=kind]", "python")
    page.wait_for_timeout(200)
    check("Python output appears", "import matplotlib.pyplot as plt" in page.text_content("#o-htmlpy code"))
    page.click("#tab-sdk")
    check("SDK starter files appear", "powerbi-visuals-tools@7.2.1" in page.text_content("#o-sdk-commands code"))

    # keyboard
    page.focus("#tab-recommend")
    page.click("#tab-recommend")
    page.keyboard.press("ArrowRight")
    check("arrow keys move between tabs", page.get_attribute("#tab-svg", "aria-selected") == "true")
    check("still no script errors after all interactions", not errors, errors)

    # layout screenshots
    for tab, name in [("#tab-recommend", "recommend"), ("#tab-svg", "svg"), ("#tab-deneb", "deneb"), ("#tab-native", "native"), ("#tab-scan", "scan")]:
        page.click(tab)
        page.wait_for_timeout(150)
        page.screenshot(path=str(OUT / f"desktop-{name}.png"), full_page=True)
    page.set_viewport_size({"width": 390, "height": 844})
    page.click("#tab-svg")
    page.screenshot(path=str(OUT / "phone-svg.png"), full_page=True)
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("no sideways scrolling on a narrow screen", overflow <= 0, overflow)
    ctx.close()

    # ------------------------------------------------------------------ part 2: PBIP writer and folder scan over http://127.0.0.1
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(APP.parent))
    handler.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_address[1]}/"
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    outbound = []
    ctx.route(re.compile(r"^(https?|wss?|ftp)://"),
              lambda route: route.continue_() if route.request.url.startswith(base) else (outbound.append(route.request.url), route.abort()))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(OPFS_PICKER)
    page.goto(base + APP.name)
    page.wait_for_selector("html[data-ready='true']")
    page.evaluate("""async (sets) => {
      const root = await navigator.storage.getDirectory();
      for (const n of ["proj", "cases"]) { try { await root.removeEntry(n, { recursive: true }); } catch (e) {} }
      for (const [top, files] of Object.entries(sets)) {
        for (const [rel, b64] of Object.entries(files)) {
          let d = await root.getDirectoryHandle(top, { create: true });
          const parts = rel.split("/");
          for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
          const w = await (await d.getFileHandle(parts.at(-1), { create: true })).createWritable();
          await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
          await w.close();
        }
      }
    }""", {"proj": files_of(SAMPLE), "cases": files_of(CASES)})

    read_opfs = """async (rel) => {
      let d = await (await navigator.storage.getDirectory()).getDirectoryHandle("proj");
      const parts = rel.split("/");
      try {
        for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
        const f = await (await d.getFileHandle(parts.at(-1))).getFile();
        return btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())));
      } catch (e) { return null; }
    }"""
    opfs = lambda rel: (lambda b: None if b is None else base64.b64decode(b))(page.evaluate(read_opfs, rel))

    page.click("#tab-native")
    page.click("#project-open")
    page.wait_for_selector("#project-status:text-matches('^Opened')", timeout=15000)
    pages = page.evaluate("[...document.querySelectorAll('#project-page option')].map(o => o.textContent)")
    check("project opens: two pages with sizes and visual counts", pages == ["Overview (1280×720, 2 visuals)", "Details (1280×720, 0 visuals)"], pages)
    check("Add to page stays disabled until both boxes are ticked", page.is_disabled("#o-native .out-head button:has-text('Add to page')"))
    page.check("#confirm-desktop")
    page.check("#confirm-backup")
    check("Add to page is enabled after ticking both", page.is_enabled("#o-native .out-head button:has-text('Add to page')"))

    page.select_option("#f-native select[name=visualType]", "clusteredColumnChart")
    page.fill("#f-native input[name=title]", "Sales by region: East leads")
    page.wait_for_timeout(300)
    page.click("#o-native .out-head button:has-text('Add to page')")
    page.wait_for_selector("#project-status:text-matches('^Done')", timeout=15000)
    result = page.text_content("#project-result-list")
    path_native = re.search(r"Added (\S+visual\.json)", result).group(1)
    native_bytes = opfs(path_native)
    (OUT / "native.visual.json").write_bytes(native_bytes)
    check("native visual written into the project", native_bytes is not None and b'"clusteredColumnChart"' in native_bytes, result)
    check("write summary has no stray 'null' text", "null" not in result, result)
    check("page list now shows 3 visuals on Overview", "Overview (1280×720, 3 visuals)" in page.text_content("#project-page"))

    original_report = (SAMPLE / "Sales.Report/definition/report.json").read_bytes()
    page.click("#tab-deneb")
    page.select_option("#f-deneb select[name=chart]", "lollipop")
    page.wait_for_timeout(300)
    page.click("#o-deneb-visual .out-head button:has-text('Add to page')")
    page.wait_for_selector("#project-status:text-matches('^Done')", timeout=15000)
    result = page.text_content("#project-result-list")
    path_deneb = re.search(r"Added (\S+visual\.json)", result).group(1)
    backup = re.search(r"Backup: (\S+report\.json)", result).group(1)
    report_after = opfs("Sales.Report/definition/report.json")
    (OUT / "deneb.visual.json").write_bytes(opfs(path_deneb))
    (OUT / "report.json").write_bytes(report_after)
    check("Deneb visual written and report.json registers Deneb", b"deneb7E15AEF80B9E4D4F8E12924291ECE89A" in report_after)
    check("backup of report.json is byte-identical to the original", opfs(backup) == original_report, backup)
    check("report.json keeps its CRLF line endings", b"\r\n" in report_after and not re.search(rb"[^\r]\n", report_after))
    if SCHEMAS.is_dir():
        r = subprocess.run([sys.executable, str(VALIDATE), str(SCHEMAS), str(OUT / "native.visual.json"),
                            str(OUT / "deneb.visual.json"), str(OUT / "report.json")], capture_output=True, text=True)
        print("     " + r.stdout.strip().replace("\n", "\n     "))
        check("files written in the browser validate against Microsoft's schemas", r.returncode == 0, r.stderr)
    else:
        print("SKIP files written in the browser validate against Microsoft's schemas (no schemas folder given)")

    page.click("#project-undo")
    page.wait_for_selector("#project-status:text-matches('^Undone')", timeout=15000)
    check("undo restores report.json byte for byte", opfs("Sales.Report/definition/report.json") == original_report)
    check("undo removes the Deneb visual", opfs(path_deneb) is None)

    page.click("#tab-scan")
    page.click("#scan-folder")
    page.wait_for_selector("#scan-out .scan-summary")
    summary = page.text_content("#scan-out .scan-summary")
    py = subprocess.run([sys.executable, "-I", str(PYSCAN), str(CASES)], capture_output=True, text=True).stdout.strip().splitlines()
    rows = page.evaluate("document.querySelectorAll('#scan-out tbody tr').length")
    check(f"folder scan in the browser finds the same {len(py)} issues as the Python scanner", rows == len(py) and summary.startswith(f"{len(py)} issues"), summary)
    check("part 2: no script errors and no outbound requests", not errors and not outbound, errors + outbound)
    page.screenshot(path=str(OUT / "desktop-scan-results.png"), full_page=True)
    ctx.close()
    server.shutdown()
    browser.close()

print(f"\n{'ALL PASSED' if not fails else str(fails) + ' FAILED'}")
sys.exit(1 if fails else 0)
