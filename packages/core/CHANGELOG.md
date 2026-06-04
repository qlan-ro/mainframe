# @qlan-ro/mainframe-core

## 0.22.0

### Minor Changes

- [#378](https://github.com/qlan-ro/mainframe/pull/378) [`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Dynamic per-model effort levels + fast/ultracode/adaptive-thinking flags (composer) and Codex personality/reasoning-summary (provider settings), driven by each adapter's advertised capabilities instead of hardcoded lists. Claude applies tuning via `apply_flag_settings` (no `--effort`, which would install a masking permission layer); Codex via `turn/start`. Per-chat knobs inherit provider defaults (null = inherit, resolved once at spawn/apply).

### Patch Changes

- Updated dependencies [[`b8f7c7d`](https://github.com/qlan-ro/mainframe/commit/b8f7c7d20e5e3909cd712b7a1f829776b16401e0)]:
  - @qlan-ro/mainframe-types@0.22.0
