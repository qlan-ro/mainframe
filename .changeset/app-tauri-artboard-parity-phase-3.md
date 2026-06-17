---
"@qlan-ro/mainframe-app-tauri": patch
---

Artboard-parity drift audit — Phase 3 (per-surface structural majors), from
`docs/architecture/2026-06-17-artboard-parity-drift-audit.md`. **SvgViewer cluster:**

- the Preview/Source segmented toggle moves into the `ViewerShell` breadcrumb-header
  `actions` slot (removing the separate sub-bar that added an extra chrome row);
- source mode renders on the code surface (`bg-mf-code-bg` + `text-mf-code-fg`) instead
  of the default body background;
- preview mode shows the SVG inside a raised, rounded card (`rounded-[11px]`,
  `bg-background`, `--mf-shadow-pop`) over the checkerboard, matching the prototype;
- the active segment gains a 0.5px raised-border ring (was flat).
