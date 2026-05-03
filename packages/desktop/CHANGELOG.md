# @qlan-ro/mainframe-desktop

## 0.16.1

### Patch Changes

- [#276](https://github.com/qlan-ro/mainframe/pull/276) [`891c685`](https://github.com/qlan-ro/mainframe/commit/891c685e4e00a4f77e779ae6520b4453cfe644ad) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): polish BashCard and SearchCard layouts
  - BashCard: drop the JS-level 80-char hard truncation; let CSS `truncate` handle overflow responsively so commands fill the available row width before getting an ellipsis. Tooltip still shows the full command on hover.
  - SearchCard: header now renders `Grep · "pattern"` (toolName plus pattern, monospaced and truncatable). The path moves to its own subheader line wrapped in a Radix tooltip showing the full path on hover.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.16.1
  - @qlan-ro/mainframe-core@0.16.1
