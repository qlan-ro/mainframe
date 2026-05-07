# @qlan-ro/mainframe-desktop

## 0.18.1

### Patch Changes

- [#300](https://github.com/qlan-ro/mainframe/pull/300) [`cf0705c`](https://github.com/qlan-ro/mainframe/commit/cf0705cde5a49b8a4aed8ed77bc8517b1bf0684c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix four issues in the Check-for-Updates menu shipped in v0.18.0: the View-menu devtools filter was case-sensitive and didn't strip the item at runtime; existing submenu items lost their `type: 'separator'`, `click` handlers, and other properties when rebuilt; and the manual-check in-flight flag could leak permanently if `electron-updater` resolved without firing a terminal event. The filter is now case-insensitive, submenu items are passed through losslessly, and a 60-second watchdog clears the flag.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.18.1
  - @qlan-ro/mainframe-core@0.18.1
