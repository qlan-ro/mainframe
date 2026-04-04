# @qlan-ro/mainframe-desktop

## 0.7.0

### Minor Changes

- [#163](https://github.com/qlan-ro/mainframe/pull/163) [`919fa40`](https://github.com/qlan-ro/mainframe/commit/919fa406bb5a006f49301a2e9d3841351f955e42) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): make file paths in tool cards clickable to open in editor

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#162](https://github.com/qlan-ro/mainframe/pull/162) [`58346d2`](https://github.com/qlan-ro/mainframe/commit/58346d2f9a217814241dfcce7e8fac48aac009f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): session rename context menu, copy tool output, scroll to diff

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#158](https://github.com/qlan-ro/mainframe/pull/158) [`105deb5`](https://github.com/qlan-ro/mainframe/commit/105deb59ffcc59076e32362d4ea8f63c576c6999) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add sorting options (by number, priority, type) to the tasks board columns

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

- [#167](https://github.com/qlan-ro/mainframe/pull/167) [`26b6bf7`](https://github.com/qlan-ro/mainframe/commit/26b6bf76e2e8f02c1dca1e11edd2257581ca74ff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show unread and waiting count badges on project filter pills and bold unread session titles

### Patch Changes

- [#168](https://github.com/qlan-ro/mainframe/pull/168) [`c04af83`](https://github.com/qlan-ro/mainframe/commit/c04af838d05cc96107996989345b037be82e289b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Restore composer draft persistence across chat switches and clean up drafts on archive

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#157](https://github.com/qlan-ro/mainframe/pull/157) [`8b9ce57`](https://github.com/qlan-ro/mainframe/commit/8b9ce57a6dfcd5d2ba26817e347ebf29e9519aed) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename default session label from "New Chat" to "Untitled session" to match mobile

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20), [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e)]:
  - @qlan-ro/mainframe-types@0.7.0
  - @qlan-ro/mainframe-core@0.7.0
