---
'@qlan-ro/mainframe-app-tauri': minor
---

Add the editor/viewers surface (CodeMirror 6) and the typed-surface layout engine to app-tauri.

- **Editor on CodeMirror 6** (overriding ADR-001's Monaco default, per its own scoped-decision escape hatch): code editor, side-by-side diff (`@codemirror/merge`), syntax highlighting, and the editor-agnostic daemon LSP client (hover, ⌘-click go-to-definition that jumps/opens a tab, find-usages references panel, copy-reference, context menu, ⌘</⌘> jump history). Peek-definition is intentionally out of scope.
- **Inline comments** — CM6 gutter markers + block-widget comment cards.
- **Viewers** — image / svg / pdf / csv, routed by file type (adds a `read_file_base64` Tauri command).
- **Files tab model + intent subscriber** — chat tool-cards' `open-file`/`reveal-file` surface intents now open files in the editor (preview/permanent tabs).
- **Typed-surface layout engine** — per-session remembered workspaces, Run multi-pane model, surface drag-reposition, and Files-tab → Run edge-split drag.
