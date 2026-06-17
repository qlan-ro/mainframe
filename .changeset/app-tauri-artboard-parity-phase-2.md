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
