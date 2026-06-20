---
"@qlan-ro/mainframe-app-tauri": minor
---

Bring the Run/Preview, editor, and viewer surfaces to parity (accumulated working-tree
work that had been stashed):

- **Preview/Run surface** — rebuilt `PreviewToolbar` (Run/Stop/Restart control, URL bar,
  desktop/mobile device toggle, capture cluster, bespoke icon buttons), new `RunTabStrip`,
  and a collapsible **console drawer that is drag-resizable** (`ConsolePane`). Native
  preview webview geometry now re-fits to the body container (so the console isn't covered)
  and hides only when a DOM overlay actually overlaps it (`use-preview-geometry`,
  `use-preview-occlusion`). Run tabs carry their own launch **scope** so the console shows
  output regardless of the active chat (`RunTab.scopeKey`, `run-tab-for-config`). Removed
  the dead `LaunchPopover`/`StopPopover`.
- **Editor** — `CmDiffEditor` passes `{doc, extensions}` to MergeView so line numbers /
  syntax / theme render in diffs; `DiffHeader`, inline-comment widgets + gutter markers,
  and the editor context menu brought to parity.
- **Viewers** — CSV / image / SVG / unsupported viewers behind a shared `viewer-status`
  helper and `ViewerShell`.
- **Files** — `ChangesPanel`, `FileTree`, `InspectorPane`, and a `use-changes-count` hook.
- **Tauri shell** — preview child-webview lifecycle + macOS capture (`src-tauri/src/preview/`,
  `lib.rs`).
