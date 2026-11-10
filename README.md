# Power BI Visual Builder

Tested templates and safety checks for building Power BI visuals: native PBIR visuals, SVG DAX measures, Deneb (Vega-Lite) charts, HTML Content Secure tiles, Python visuals and custom-visual starters.

It comes in two forms:

| | What it is | Where your data goes |
|---|---|---|
| **Agent skill** (`skills/`) | Instructions, templates and a safety scanner for an AI coding agent: GitHub Copilot, Claude Code or Claude | Through the AI service that runs the agent |
| **Offline app** (`app/pbi-visual-builder-offline.html`) | One HTML file. No AI and nothing to install; runs in Edge or Chrome | Nowhere: its security policy blocks every network connection |

## The skill

Three builds of the same skill:

| Folder | For |
|---|---|
| `skills/copilot/powerbi-visual-builder/` | GitHub Copilot: agent mode in VS Code, Visual Studio or JetBrains IDEs, and Copilot CLI |
| `skills/claude-code/powerbi-visual-builder/` | Claude Code |
| `skills/claude-ai/SKILL.md` | Claude (claude.ai), as a single file |

The folder builds keep `SKILL.md` short and load the templates in `references/` only when a task needs them. `scripts/scan_visuals.py` checks generated files for external URLs, scripts and other unsafe content (Python standard library only). The Copilot build also tells the agent never to open `.pbi/cache.abf`, `.pbix` files or data exports, because they contain data.

**GitHub Copilot.** For all your projects, copy the folder into your personal skills folder. In PowerShell, from a clone of this repository:

```powershell
New-Item -ItemType Directory -Force "$HOME\.copilot\skills" | Out-Null
Copy-Item -Recurse -Force .\skills\copilot\powerbi-visual-builder "$HOME\.copilot\skills\"
```

To share it with a team instead, put the folder in `.github/skills/` inside that repository. Then open Copilot Chat in **Agent** mode and type `/` to find `powerbi-visual-builder` (in Copilot CLI, run `/skills reload` first). Keep one copy only: VS Code also reads `~/.claude/skills` and `~/.agents/skills`, and lists same-named skills twice.

**Claude Code.** Copy `skills/claude-code/powerbi-visual-builder` into `~/.claude/skills/`.

**Claude (claude.ai).** Add `skills/claude-ai/SKILL.md` as a skill.

## The offline app

Download `app/pbi-visual-builder-offline.html` and open it in Edge or Chrome.

- **Recommend** picks the technology (native visual, SVG measure, Deneb, HTML Content Secure, custom visual or Python) from what the visual must show and what your tenant allows.
- **SVG measures, Deneb, Native visual, HTML & Python, Custom visual** generate DAX, Deneb specs, configs and shareable templates, and PBIR `visual.json` from your field names. Every output shows its scan result.
- **Write into a PBIP project** (on the Deneb and Native visual tabs): open the folder that holds your `.pbip` file, pick a page, confirm that Desktop is closed, then select *Add to page*. The app places the visual in free space and copies the project's schema version. The first time it adds a Deneb chart, it backs up `report.json` to `.pbi-visual-builder-backups/`, then registers Deneb there. *Undo* puts everything back.
- **Scan** checks a folder or files with the same rules as the skill's scanner.
- **Rules** lists the safety rules, how to choose a chart and a checklist before publishing.

The page's Content-Security-Policy lets only its own scripts and stylesheet run (pinned by SHA-256 hash) and blocks all network access, so field names and project files stay on your PC. The file's SHA-256 is in `app/SHA256SUMS`; check it in PowerShell with `Get-FileHash .\app\pbi-visual-builder-offline.html`. Writing into folders needs Edge or Chrome; in other browsers use the Download buttons.

## Repository layout

```
skills/claude-ai/SKILL.md      source of the skill (single file)
skills/claude-code/, copilot/  generated folder builds
app/src/                       source of the offline app (index.html, style.css, core.js, ui.js)
app/*.html, app/SHA256SUMS     generated app and its checksum
tools/                         build scripts, scanner source, offline PBIR schema validator
tests/                         test runner, scanner regression tests, skill structure checks, app tests
```

Edit only the sources (`skills/claude-ai/SKILL.md`, `tools/scan_visuals.py`, `app/src/`), then run `python tools/build_all.py` to regenerate the rest.

## Tests

```
python tests/run_all.py
```

This needs Python 3.10 or later. Parts that need more are reported as SKIP when their tools are missing:

- Node.js 20 or later runs the app's core tests. Then run `npm ci --prefix tests/app` to compile the Deneb specs with Vega-Lite 6.4.3, the version bundled in Deneb 2.0.1.
- With `pip install playwright` and Chrome or Edge (`CHROME_PATH` chooses one), the browser tests run.
- With `pip install jsonschema` and `PBIR_SCHEMAS` set to `fabric/item/report/definition` in a clone of [microsoft/json-schemas](https://github.com/microsoft/json-schemas), written PBIR files are also validated against Microsoft's schemas.

What the tests cover:

- The generated files match their sources.
- Every template and code block in the folder builds is identical to the tested single-file skill.
- The scanner passes 56 regression cases, plus behaviour checks for missing paths, empty folders, UTF-16/CRLF files and non-UTF-8 consoles.
- The app's output matches the skill's templates byte for byte, and bad input (quotes, brackets, script tags, invalid colours) is rejected.
- The app's JavaScript scanner gives the same results as the Python scanner.
- The Deneb specs compile without warnings.
- Written files validate against visualContainer schemas 2.9.0 to 2.13.0.
- In the browser, the security policy blocks fetch, WebSockets, image beacons and injected scripts, and PBIP writes, backups and undo work.

## Sources

The sources and the date each fact was last checked (November 2026) are listed in the last section of each `SKILL.md`.

## License

There is no license file yet, so all rights are reserved by default.
