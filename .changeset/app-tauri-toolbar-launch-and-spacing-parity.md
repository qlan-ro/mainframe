---
"@qlan-ro/mainframe-app-tauri": minor
---

Bring the shell toolbar and sidebars to artboard parity, and wire the toolbar
launch picker.

Toolbar: reorder the right cluster to the design (search → launch → run →
surfaces → theme → inspector), give the ⌘O keycap its white background, restore
the "Preview" launch label, and size the title/branch/icons to the artboard.
Sidebar + inspector: replace compressed integer spacing utilities (which render
at half size under the theme's `--spacing-*` scale) with arbitrary `[Npx]`
values matching the prototype — row gaps, gutters, pill/badge heights, status
dots, and the file-tree font.

Launch picker: the toolbar "Preview" dropdown + run button are now wired to the
existing launch subsystem (previously inert stubs). They share a new
`useLaunchActions` hook with the Run surface's `LaunchPopover`, list the
project's `.mainframe/launch.json` configs, start/stop them, and track the
selected config.
