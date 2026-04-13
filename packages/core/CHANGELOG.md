# @qlan-ro/mainframe-core

## 0.10.0

### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- Updated dependencies [[`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-types@0.10.0
