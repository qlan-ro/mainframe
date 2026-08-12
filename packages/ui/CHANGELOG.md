# @qlan-ro/mainframe-ui

## 2.0.0-rc.25

### Patch Changes

- [#619](https://github.com/qlan-ro/mainframe/pull/619) [`ae0d26d`](https://github.com/qlan-ro/mainframe/commit/ae0d26d035b2cb4b2bad3cf6bc40a621d4985977) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Mute the sidebar action labels so New Thread, Kanban and Automations sit at the same ink as the rows below them.

  Their icons were already muted, but the labels rendered at full sidebar foreground, making the three rows read as the loudest thing in the sidebar. They now use `text-muted-foreground`, the resting ink the project rows already use.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@2.0.0-rc.25
