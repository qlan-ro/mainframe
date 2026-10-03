# @qlan-ro/mainframe-ui

## 2.6.1

### Patch Changes

- [#759](https://github.com/qlan-ro/mainframe/pull/759) [`2f933a8`](https://github.com/qlan-ro/mainframe/commit/2f933a8ecabfa64cd13e27d5d946dcde241330b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix new chats showing no transcript at all. A session resume that read the display snapshot before the chat's first prompt seeded the incremental display projector with empty history; every message appended afterward was then silently skipped instead of being folded into the chat, so the daemon never sent any transcript items.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.6.1
