---
"@qlan-ro/mainframe-app-tauri": minor
---

Editor surface wrap-up: bring the app-tauri editor/viewers to parity with the desktop editor and the prototype design.

- Mount the built-but-unmounted editor features: right-click context menu, inline comments with a hover-'+' comment gutter, LSP hover/go-to-def/find-references, and diff next/prev-change navigation with a diff header bar.
- Add the shared `ViewerShell` chrome (breadcrumb + status footer + reveal-in-tree) to every viewer (image/svg/pdf/csv/markdown) and the code editor (live Ln/Col), plus an `UnsupportedViewer` empty state.
- HEAD-vs-working diffs from the Changes panel and path-only diff tabs, plus live disk-change reload with a dirty-buffer conflict banner (wired to the existing daemon git-diff endpoint and file-watch channel — no daemon contract changes).
- Correctness/token fixes: visible light-mode active line, correct Changes-panel status tokens, stable CSV row/cell keys, real read-only state, and a destructive/warning tint-token cleanup.
- Editor polish: code folding gutter, back/forward navigation keybindings, wired "Open file"/"View changes" surface-picker actions, and syntax highlighting for yaml/toml/go/sql/shell/scala/java.
