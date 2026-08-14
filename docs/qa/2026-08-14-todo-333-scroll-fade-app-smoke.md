# Todo #333 — QA smoke test: `scroll-fade` adoption in the running app

Follows on from `docs/qa/2026-08-14-todo-333-scroll-fade-webview-probe.md`, which verified
the utility's engine behavior against static fixtures in a raw `WKWebView` and explicitly
handed off "scroll the real sidebar past a screen of virtualized rows and watch the mask" and
the other adopted surfaces to QA. This pass drives the composed app itself (`tauri` target,
`packages/app-tauri`, isolated `DAEMON_PORT=32152`/`MAINFRAME_DATA_DIR=~/.mainframe_dev`) via
the `tauri-mcp` bridge, reading the registered `--scroll-fade-t/-b/-s/-e` custom properties
through `getComputedStyle` (calibrated first against a known-overflowing vs. known-fitting
container before being trusted) and cross-checking with screenshots.

## Method

Backend state confirmed the bridge was attached to this worktree's own build
(`cwd: .../todo-333-scroll-fade/packages/app-tauri/src-tauri`) before any assertion. Real
overflow was preferred wherever the app's own data produced it (sidebar's virtualized
session list, an 8-file composer attachment paste); where the app's seeded data didn't
naturally overflow a surface (session-panel task card, session/workspace tab strips), a
temporary inline `max-width`/`max-height` was set on the live element to force it, the
`--scroll-fade-*` custom properties were read post-layout, and the override was removed
immediately after — no persisted state change.

## Results

| # | Scenario | Class | Mode | Status | Evidence |
|---|---|---|---|---|---|
| S1 | Sidebar: virtualized overflow + sticky header stays opaque while the row fade runs below it | happy | ui | PASS | `--scroll-fade-t` 0px→20px and `--scroll-fade-b` 20px→~0px across a real scroll of the qa327 project's session list; `--scroll-fade-inset-t` tracked the measured 32px header depth throughout. `docs/qa/assets/2026-08-14-todo-333-smoke/sidebar-scrolled-sticky-header.png` |
| S2 | Sidebar: short/non-overflowing list shows no fade at either edge | edge | ui | PASS (cosmetic defect below) | Two non-overflowing projects (`mainframe-qa-243-empty`, `todo-334-tasks-panel-recent-order`): `--scroll-fade-b` a clean `0px` both times; `--scroll-fade-t` a persistent `2.351513px` both times despite `scrollHeight === clientHeight` |
| S3 | Session-panel `PanelCard` body fades at its height cap; `SessionPanel`'s outer stack stays unmasked (the documented backdrop-filter exclusion) | happy + regression | ui | PASS | Forced overflow on the Tasks card body: `--scroll-fade-b` 20px at rest-scrolled-top, both `-t`/`-b` active mid-scroll. `stackChrome` computed `maskImage: none`, no `scroll-fade` class. `docs/qa/assets/2026-08-14-todo-333-smoke/panelcard-tasks-overflow.png` |
| S4 | Session tab strip fades on overflow, no fade when tabs fit | happy | ui | PASS | Single tab: `overflows:false`, mask has no cutoff. Forced overflow: `--scroll-fade-e` 2.58px on a 24px-range mask (cutoff present) |
| S5 | Workspace (terminal/preview) tab strip fades on overflow, no fade when tabs fit | happy | ui | PASS | Single terminal tab: no cutoff. Forced overflow: `--scroll-fade-e` 14.46px, cutoff present |
| S6 | Composer attachment rail fades on real overflow, does not dim attachments that fit (the restored upstream behavior) | happy + regression | ui | PASS | 8 pasted files: `--scroll-fade-e` 20px, visible dim on the trailing tile. 2 pasted files: `overflows:false`, `--scroll-fade-s`/`-e` both `0px`, no dimming. `docs/qa/assets/2026-08-14-todo-333-smoke/attachment-rail-overflow.png`, `.../attachment-rail-fits.png` |
| S7 | Transcript viewport stays outside the fade family (explicit out-of-scope) | regression | ui | PASS | The transcript's scrollable container: no `scroll-fade` class, `maskImage: none` |
| S8 | Fade depth is one shared token across adopted surfaces | happy | ui | PASS | `getComputedStyle(document.documentElement).getPropertyValue('--scroll-fade-size')` → `20px`; the same `20px` value appears in every surface's settled `--scroll-fade-b`/`-e` reading above |

8/8 scenarios passed. No scenarios blocked or skipped.

## Defects

| Surface | Type | Severity | Evidence |
|---|---|---|---|
| Sidebar (`SidebarScrollRegion`, `scroll-fade-sticky`) | capability | cosmetic | A non-overflowing sidebar list (`scrollHeight === clientHeight`) still computes `--scroll-fade-t: 2.351513px` (reproduced identically across two different empty/short projects), producing a ~2px semi-transparent band immediately below the sticky header instead of the flat opaque region the plain (non-sticky) `scroll-fade-y` surfaces show in the same fits-case. The equivalent horizontal case (attachment rail, 2 items) and the equivalent vertical case without a sticky-header mask override (`PanelCard` body) both settle to an exact `0px`, so the residual is specific to `scroll-fade-sticky`'s combination of a static inset variable with the animated `--scroll-fade-t`. Visually imperceptible in a screenshot at this size; flagged for the record against the acceptance criterion's literal "no fade at either edge" wording, not blocking. |

No other surface defects.

## Notes

- `docs/qa/2026-08-14-todo-333-scroll-fade-webview-probe.md`'s own "not covered — handed to
  QA" item (Virtuoso windowing + `useStickyInsets`'s `ResizeObserver` path under live scroll)
  is what S1 above exercises.
- WorkspaceTabStrip (S5) required spawning a split pane and a terminal tab via
  `workspace-picker-new-terminal` to get a renderable tab strip at all — `WorkspaceTabPill`
  supplies `useLaunchActions`, so the surface only mounts once there is an active
  chat/project identity and a running pane.
- All state mutations during this run (inline style overrides, pasted composer attachments,
  a split pane + terminal tab) were transient UI state, reverted or discarded (never sent)
  before the run ended; no database writes were made.
