# @qlan-ro/mainframe-core

## 2.0.0-rc.11

### Patch Changes

- [#486](https://github.com/qlan-ro/mainframe/pull/486) [`4b6c048`](https://github.com/qlan-ro/mainframe/commit/4b6c048a9fdfac3eafee8d8beb76eb4bc59d0417) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex quota now warms up with one automatic pull at daemon boot (both Node and Rust daemons), so the ambient indicator is populated on app start instead of waiting for a manual refresh. Codex still has no polling timer — beyond boot it stays manual refresh + session pushes.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.11
