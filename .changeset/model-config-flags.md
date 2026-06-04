---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-core": minor
"@qlan-ro/mainframe-desktop": minor
---

Dynamic per-model effort levels + fast/ultracode/adaptive-thinking flags (composer) and Codex personality/reasoning-summary (provider settings), driven by each adapter's advertised capabilities instead of hardcoded lists. Claude applies tuning via `apply_flag_settings` (no `--effort`, which would install a masking permission layer); Codex via `turn/start`. Per-chat knobs inherit provider defaults (null = inherit, resolved once at spawn/apply).
