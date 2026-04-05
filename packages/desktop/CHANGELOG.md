# @qlan-ro/mainframe-desktop

## 0.8.0

### Minor Changes

- [#175](https://github.com/qlan-ro/mainframe/pull/175) [`6a1107f`](https://github.com/qlan-ro/mainframe/commit/6a1107f6a10893725a433befb1dc834c3ac71df5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add "Copy Reference" context menu action to Monaco editors

### Patch Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

- [#171](https://github.com/qlan-ro/mainframe/pull/171) [`27ee58a`](https://github.com/qlan-ro/mainframe/commit/27ee58af44a8019e3fc7f3152db2f358e3849201) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix preview URL not updating when switching to a worktree session

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0
  - @qlan-ro/mainframe-core@0.8.0
