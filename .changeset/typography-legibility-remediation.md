---
'@qlan-ro/mainframe-ui': minor
---

Overhaul UI typography and text-color legibility. Re-tint the tertiary/semantic ink tokens (mf-text-3, mf-success, mf-warning) across all six themes so they clear WCAG 4.5:1, reclassify mf-text-4 as ornament-only, and add a globals.css contrast guardrail test. Re-anchor the UI scale factors (compact 0.92 / normal 1.0 / large 1.15) so normal mode renders crisp un-zoomed 13px text and compact is legible. Repair shared primitives (button icon default, menu/dropdown/command eyebrows, tooltip size) and add CountBadge + SectionHeader. Sweep every surface to promote must-read text off 10–11px, move semantic hues off text onto icons/tints, replace the invisible white-on-accent count badges with capsule-less counts, and give session-row selection a macOS-style neutral fill. Fixes hundreds of contrast and small-text findings from the 2026-07-11 legibility audit.
