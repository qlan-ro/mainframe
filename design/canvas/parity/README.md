# Prototype parity measurements

The runner compares the redesign prototype with the real React app and its built CSS in Chromium. An in-page fixture supplies daemon responses. Requests other than those for the fixture page's own assets fail the run.

From the repository root, with workspace dependencies and Playwright Chromium installed:

```sh
export PARITY_WORK="$(mktemp -d)"
node design/canvas/parity/run.mjs
node design/canvas/parity/report.mjs "$PARITY_WORK/out" > "$PARITY_WORK/report.md"
```

Use `--area gates,workspace`, `--only <state regex>`, `--themes light,dark`, or `--views wide,mid,small` for a focused run. Use `--skip-build` to reuse a bundle. Pass `--out <directory>` for focused runs so they leave the full measurements available. `PARITY_CHROMIUM` can point to a Chromium executable.

The output contains computed property differences, counts, and comparison PNGs. Each entry identifies the state, size, theme, and property. The report classifies rows using `classes.mjs` and exits with code 1 when an unmatched row or a runner problem remains. An optional second directory supplies a baseline. Its absent-row count can include renamed selectors or changed fixture data, so verify a fix against the affected property.

The viewport sizes are 1440 × 900, 1100 × 720, and 860 × 720. Native window buttons, window dragging, WKWebView scrolling, terminal rendering, and live resize and hover timing require the desktop app.
