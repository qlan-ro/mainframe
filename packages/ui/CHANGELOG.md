# @qlan-ro/mainframe-ui

## 2.12.4

### Patch Changes

- [#870](https://github.com/qlan-ro/mainframe/pull/870) [`580495e`](https://github.com/qlan-ro/mainframe/commit/580495ee8fa7ce86cf81b2a86fbccce7a2d3f5d3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop earlier-message scroll anchoring when the reader continues scrolling, preventing the transcript from snapping back while a loaded page settles.

- [#873](https://github.com/qlan-ro/mainframe/pull/873) [`c1fa157`](https://github.com/qlan-ro/mainframe/commit/c1fa157ece9e955824ba6d5d417f9e75570bc9f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Remember Claude transcript file membership across restarts, avoiding repeated header reads of unchanged sessions while detecting new, changed, replaced and deleted files.

- [#874](https://github.com/qlan-ro/mainframe/pull/874) [`de42046`](https://github.com/qlan-ro/mainframe/commit/de4204619f74d0b201ff741cb50cf609f745de63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Display validated transcript tails after a restart without reconstructing full Claude or Codex history before the first paint.

- [#872](https://github.com/qlan-ro/mainframe/pull/872) [`1af004d`](https://github.com/qlan-ro/mainframe/commit/1af004daa70ecae6e681eccc1a29de64652eafea) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Reuse validated transcript snapshots when restoring chats after restart or idle offload, including checks for changed subagent history.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.12.4
