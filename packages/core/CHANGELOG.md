# @qlan-ro/mainframe-core

## 0.20.1

### Patch Changes

- [#363](https://github.com/qlan-ro/mainframe/pull/363) [`00f722c`](https://github.com/qlan-ro/mainframe/commit/00f722c0af68286bab1cebe463a4652f5d56a2ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plugin discovery now honors `MAINFRAME_DATA_DIR` — the daemon scans `<dataDir>/plugins` instead of a hardcoded `~/.mainframe/plugins`, aligning user-plugin loading with the rest of the data-dir convention (the todos builtin already used `<dataDir>/plugins`). No change in the default install, where `<dataDir>` is `~/.mainframe`.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.20.1
