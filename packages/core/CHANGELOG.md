# @qlan-ro/mainframe-core

## 2.0.0-rc.9

### Patch Changes

- [#468](https://github.com/qlan-ro/mainframe/pull/468) [`1191d5a`](https://github.com/qlan-ro/mainframe/commit/1191d5a38d014e25fc86bc0d5731ca62aabe3f6c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `mainframe update` self-update gaps: unrecognized CLI subcommands now print an error instead of silently falling through to booting the daemon (previously crashed with a confusing `EADDRINUSE`), add `mainframe help`/`-h`/`--help`, and `mainframe update` now refuses to install a release that isn't newer than the running version unless `--force` is passed.

- [#471](https://github.com/qlan-ro/mainframe/pull/471) [`79280c6`](https://github.com/qlan-ro/mainframe/commit/79280c665fc7165ed545980ba279ef398b1cc319) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix new chats getting created with no model when an adapter has no saved default-model setting (e.g. automation-created Codex chats), which made Codex's app-server reject the session with `Invalid request: missing field \`model\``. Chat creation now falls back to the adapter's own catalog default model, the same fallback already used for tuning resolution.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.9
