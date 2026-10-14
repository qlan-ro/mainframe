# @qlan-ro/mainframe-ui

## 2.10.0

### Minor Changes

- [#821](https://github.com/qlan-ro/mainframe/pull/821) [`1bec111`](https://github.com/qlan-ro/mainframe/commit/1bec11112ff7d373974a5571797f5a5fca5b73c1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show running, waiting, and earlier Activity with source links, task details, and delegated task controls.

### Patch Changes

- [#824](https://github.com/qlan-ro/mainframe/pull/824) [`cdde79a`](https://github.com/qlan-ro/mainframe/commit/cdde79a21b6b7e5e4cab0d1804e644bb3adb4ef7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Preserve reading position when expanding transcript details, keep bottom-following through viewport and composer resizing, and avoid idle scroll frames. Keep long compact chats at the bottom after switching and preserve reading position while a viewport is hidden. Preserve visible text during width changes and avoid WebKit scroll resets from viewport containment. Stabilize Markdown table columns while responses stream.

- [#825](https://github.com/qlan-ro/mainframe/pull/825) [`1ac8410`](https://github.com/qlan-ro/mainframe/commit/1ac84108714aec8f416af38d728e65bca5269939) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Always nest a fork under its parent in the sessions sidebar. A fork and its parent now share a group, and an active fork lifts its parent into Today instead of being listed apart from it. Only a pinned fork of an unpinned parent is still listed separately.

- [#823](https://github.com/qlan-ro/mainframe/pull/823) [`801c1fc`](https://github.com/qlan-ro/mainframe/commit/801c1fc1bb3179df4dcf97a2bdbce19d9eaceb02) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Fork beside Copy and Export on completed assistant turns in compact and verbose transcripts, and hide it during active turns.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.10.0
