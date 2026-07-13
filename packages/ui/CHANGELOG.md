# @qlan-ro/mainframe-ui

## 2.0.0-rc.8

### Minor Changes

- [#458](https://github.com/qlan-ro/mainframe/pull/458) [`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an update channel setting (Stable / Pre-release) in Settings → General. Electron respects it via `electron-updater`'s `allowPrerelease`; Tauri resolves the newest published GitHub release directly for the pre-release channel, since its updater has no built-in concept of channels.

### Patch Changes

- [#457](https://github.com/qlan-ro/mainframe/pull/457) [`a679cb9`](https://github.com/qlan-ro/mainframe/commit/a679cb95b850796dec3498b5996a896ac5f73c39) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix toasts flickering when hovered.

  Sonner's default collapsed stack clamps every toast to the front toast's height and re-lays the
  stack out on hover. Our toast cards vary in height, so hovering moved a stacked toast ~314px out
  from under the pointer, which un-hovered it, which moved it back — a visible flicker loop. The
  toast stack is now always expanded, so hover changes no geometry.

- Updated dependencies [[`41c87af`](https://github.com/qlan-ro/mainframe/commit/41c87af258415f88863a72df4a49b5ebfb045866)]:
  - @qlan-ro/mainframe-types@2.0.0-rc.7

## 2.0.0-rc.7

### Minor Changes

- [#452](https://github.com/qlan-ro/mainframe/pull/452) [`f4c77d4`](https://github.com/qlan-ro/mainframe/commit/f4c77d47241645b41c70c32dcb0f1b9b0727d886) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Overhaul UI typography and text-color legibility. Re-tint the tertiary/semantic ink tokens (mf-text-3, mf-success, mf-warning) across all six themes so they clear WCAG 4.5:1, reclassify mf-text-4 as ornament-only, and add a globals.css contrast guardrail test. Re-anchor the UI scale factors (compact 0.92 / normal 1.0 / large 1.15) so normal mode renders crisp un-zoomed 13px text and compact is legible. Repair shared primitives (button icon default, menu/dropdown/command eyebrows, tooltip size) and add CountBadge + SectionHeader. Sweep every surface to promote must-read text off 10–11px, move semantic hues off text onto icons/tints, replace the invisible white-on-accent count badges with capsule-less counts, and give session-row selection a macOS-style neutral fill. Fixes hundreds of contrast and small-text findings from the 2026-07-11 legibility audit.
