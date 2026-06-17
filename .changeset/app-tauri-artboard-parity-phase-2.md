---
"@qlan-ro/mainframe-app-tauri": patch
---

Artboard-parity drift audit — Phase 2 (per-site sweeps the shared primitives don't
reach), from `docs/architecture/2026-06-17-artboard-parity-drift-audit.md`:

- **Selection tint:** the brand selection tint (`bg-mf-selection`) now marks the
  selected/active state — previously the near-invisible hover tint (`bg-accent`) was
  reused, making selection indistinguishable from hover. Fixed in the active model row
  (`ProviderModelSelect`), the active settings nav item + provider sub-item
  (`SettingsSidebar`), the selected directory (`DirectoryPickerModal`), the selected
  review file (`ReviewFileTree`), and the keyboard-cursor result row (`FindInPathModal`).
- **Warm content-surface sweep:** corrected the content-surface token at the sites the
  shared primitives don't cover — CodeHeader header bar (two-tone `content2` over the
  `code-bg` body), markdown table header + alternating stripe (`content2`), the review
  panel's two-tone file-list/diff split, surface headers transparent (FilesTabStrip,
  ChatCardHeader), the UnsupportedViewer card, and the CodeRefCard body (`code-bg`).
- **Hardcoded colors → tokens:** the image/svg viewer checkerboard now uses the warm
  per-scheme `--mf-viewer-check-a/b` tokens (18px tile) instead of the cool-gray
  `--mf-checker-*` chat tokens.
