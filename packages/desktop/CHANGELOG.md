# @qlan-ro/mainframe-desktop

## 0.11.1

### Patch Changes

- [#228](https://github.com/qlan-ro/mainframe/pull/228) [`7b82949`](https://github.com/qlan-ro/mainframe/commit/7b829498cad870ae239f7aea607bae7a6e249f23) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(updater): publish macOS zip artifact so electron-updater can apply updates

  Squirrel.Mac auto-updates require a `.zip` of the app bundle; the release previously shipped only `.dmg`, causing the updater to fail with "ZIP file not provided" when applying an update. Also replaces native `title` attributes on the status-bar update indicator and the composer worktree button with Radix tooltips so hovercards render with the app's own styling, re-enables hoverable content on the chat link-preview tooltip so the Copy button can be reached, and adds a right-click context menu to chat links with Copy link / Open link actions.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1
  - @qlan-ro/mainframe-core@0.11.1
