# @qlan-ro/mainframe-desktop

## 0.10.0

### Minor Changes

- [#198](https://github.com/qlan-ro/mainframe/pull/198) [`6e90f97`](https://github.com/qlan-ro/mainframe/commit/6e90f97acf021565a1202f731c2510b147618ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add automatic update checking with status bar indicator

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#189](https://github.com/qlan-ro/mainframe/pull/189) [`afd0178`](https://github.com/qlan-ro/mainframe/commit/afd017863747e4acf41ea614b4642e6619b984db) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix memory leak: clean Maps on chat removal, add message eviction caps, unsubscribe inactive chats, cap nav stacks, clear LSP URIs

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- [#199](https://github.com/qlan-ro/mainframe/pull/199) [`f7c1133`](https://github.com/qlan-ro/mainframe/commit/f7c1133908a30ea0ea18c45fd5272b6ddd6fe87e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix terminal resize corruption by guarding fitAddon against zero dimensions and debouncing resize events

- [#201](https://github.com/qlan-ro/mainframe/pull/201) [`80026fd`](https://github.com/qlan-ro/mainframe/commit/80026fdaea261661e9d79e5a4ec8bd8b714c6112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Re-wire file editor into center panel split after zone-based layout rewrite

- [#193](https://github.com/qlan-ro/mainframe/pull/193) [`e26c46c`](https://github.com/qlan-ro/mainframe/commit/e26c46c2124dcb0baf679e8a5c2e572c786e86cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Parallelize startup API calls, lazy-load infrequent chat cards, add passive scroll listener

- [#195](https://github.com/qlan-ro/mainframe/pull/195) [`a6a3bd7`](https://github.com/qlan-ro/mainframe/commit/a6a3bd789454c74a39e9a7268611acc48cf4d76b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Optimize Zustand store selectors and add React.memo to list components to reduce re-renders

- Updated dependencies [[`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5), [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e), [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-core@0.10.0
  - @qlan-ro/mainframe-types@0.10.0
