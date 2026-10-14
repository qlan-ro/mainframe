# Transcript scrolling benchmark

Browser regressions for the production scroll hooks and Markdown table renderer.
Run from the repository root after installing workspace dependencies and Playwright browsers.

```sh
node packages/ui/benchmarks/transcript-scroll/run.mjs --integrated --check
node packages/ui/benchmarks/transcript-scroll/run.mjs --integrated --webkit --check
node packages/ui/benchmarks/transcript-scroll/run.mjs --table --check
node packages/ui/benchmarks/transcript-scroll/run.mjs --table --webkit --check
node packages/ui/benchmarks/transcript-scroll/run.mjs --windows --compact --complex --check
node packages/ui/benchmarks/transcript-scroll/run.mjs --windows --compact --complex --webkit --check
```

Each invocation runs three samples using a temporary Vite server on port 5198.
`--check` exits unsuccessfully for cancelled scrolling, unexpected movement,
unnecessary animation frames, failed bottom-following, or unstable table layout.
Omit `--integrated` to isolate Mainframe's hook from assistant-ui's viewport.
The fixtures use synthetic content and do not connect to a daemon or provider.

To compare with the original implementation without modifying the working tree:

```sh
node packages/ui/benchmarks/transcript-scroll/run.mjs --integrated --baseline=1bec11112ff7d373974a5571797f5a5fca5b73c1 --check
node packages/ui/benchmarks/transcript-scroll/run.mjs --table --baseline=1bec11112ff7d373974a5571797f5a5fca5b73c1 --check
```

Baseline mode loads the original hooks and table component from Git and enables
the original assistant-ui auto-scroll setting. Expected baseline failures remain
visible as a nonzero exit code. `BENCHMARK_ARTIFACT_DIR` optionally saves table
screenshots to an existing directory.

## Measurements, 2026-10-14

Chromium measurements were identical across three samples unless noted.
Each fix was measured before proceeding to the next.

| Change | Measurement | Before | After |
| --- | --- | --- | --- |
| Remove disclosure scroll lock and delayed offset reset | Accepted movement from a 100 px scroll | 0 px | 100 px |
| Recompute following state when disclosure interaction ends | Jump on next 100 px content growth, isolated hook | 700 px | 0 px |
| Observe viewport dimensions | Bottom gap after reducing height by 150 px, isolated hook | 150 px | 0 px |
| Skip resize animation frames while reading history | Scheduled frames for 30 growth events | 30 | 0 |
| Disable duplicate assistant-ui automatic following | Jump on next growth after the hook fixes | 100 px | 0 px |
| Observe composer dimensions | Bottom gap after 100 px footer growth | 100 px | 0 px |
| Recognize arrival at the previous bottom before a delayed scroll event | Bottom gap when new content arrives immediately after jump-to-bottom | 100 px in 2/3 Chromium runs | 0 px in 3/3 runs |
| Give Markdown tables fixed columns | Largest existing-column width change after adding a row | 296.8125 px | 0 px |
| Ignore zero dimensions while hidden | Reading-position jump after hide/show | 17,748 px | 0 px |
| Keep bottom-follow during automatic turn folding | Bottom gap switching short to long compact chat | 13,210 px | 0 px |
| Ignore duplicate layout scroll notifications | Live window-resize bottom gap | 504 px | 0 px across 40 transitions |
| Move size containment off the scroller | WebKit hide/show offset loss | 300 px | 0 px |
| Preserve visible text during width changes | WebKit complex-transcript text shift | 190.125 px | 0.125 px |
| Same table fix | Existing-row height change | 32.5 px | 0.5 px Chromium, 0 px WebKit |

The table fixture reproduces the column redistribution visible in the supplied
recording. It appends a row with a long evidence cell through the GFM parser and
the production table component. Fixed layout keeps earlier rows stable; long
cells wrap. Chromium's remaining half pixel comes from collapsed table borders.

Final integrated Chromium and WebKit runs also check that jump-to-bottom resumes
following subsequent content. Table checks cover 320 px and 640 px containers
in light and dark themes, with screenshots inspected in WebKit.

## Scope

These are real browser layout and scroll measurements, not a replay of the
recorded chat or a packaged Tauri test. Animation-frame counts quantify avoided
scroll-controller work; they do not establish a whole-app FPS improvement.
The viewport resize failure is isolated to Mainframe's hook; assistant-ui's
original controller already handled that case in the combined viewport.

The focused UI suite passed 343 tests across 53 files. UI typecheck passed after
rebuilding the shared types package. The repeatable browser checks complement
the unit tests because jsdom cannot establish layout or scroll behavior.

## Long and nested transcripts

The window fixture tests close/reopen, history arriving after mount, short/long
chat switching, hide/show, and width reflow. `--compact` uses the production
compact transcript renderer. `--complex` increases the fixture to 400 messages:
200 final responses with 30-line code blocks and eight-row tables, 200 Read
calls with 100-line outputs, and 200 agent calls with nested transcripts and
nested Read calls. These are synthetic provider messages rendered by the real
components, not live provider sessions.

The complex checks expand tool groups, individual output, an agent, and a tool
inside that agent. They measure disclosure offsets, accepted nested scrolling,
and movement of the outer chat. Scroll-controller checks also assert zero caret
hit tests while streaming below an unchanged reading position. Width checks track a visible character range;
paragraph starts can move when text above that character wraps. The controller
checks still exercise growth during reading and resuming bottom-follow.

A separate isolated mock-daemon browser run checked a 100-section transcript:
closing/reopening its tab, page reload, 40 window-size transitions, and side-panel
layouts. Reopen and reload landed at zero bottom gap. The 40-resize loop exposed
the duplicate-scroll-notification race and passed after the fix. Network-delayed
ACP replay could not be completed because WebSocket interception closed the CLI
browser session; delayed history is covered by the component browser fixture.
Native macOS minimize/restore and packaged Tauri behavior remain unverified.

Raw measurements and live screenshots for this run are in
`/tmp/live-qa/transcript-window-20261014`; initial audit measurements are in
`/tmp/mainframe-scroll-audit`. Temporary artifacts are not required to rerun the
checked-in benchmarks. `--samples=1` provides a shorter diagnostic run; the
default remains three samples. Browser console errors fail the benchmark.
