# @qlan-ro/mainframe-desktop

## 0.15.1

### Patch Changes

- [#258](https://github.com/qlan-ro/mainframe/pull/258) [`a2e0d90`](https://github.com/qlan-ro/mainframe/commit/a2e0d909408f2f742a87a15f1265d147643d445c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix sidebar project filter drifting out of sync with the open chat. When the active chat changes (search palette, toast click, tab switch, daemon-driven activation, runtime thread switch), the filter is now cleared if the new chat lives in a different project, so the badge no longer points at a project the user is not viewing.

- [`e6c5ff1`](https://github.com/qlan-ro/mainframe/commit/e6c5ff14ed2a6fd554c5870db101d33aa4c5d741) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(editor): apply InlineCommentWidget width after Monaco's addZone, not before. Monaco's view-zones implementation sets `domNode.style.width = '100%'` inside `_addZone`, clobbering the contentWidth-based width we were setting beforehand. The first widget happened to get corrected by a later layout event; subsequent widgets stayed at full width. Width is now re-applied after addZone, and an `onDidContentSizeChange` listener keeps every open widget in sync when a scrollbar toggles.

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies [[`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3), [`eace2d6`](https://github.com/qlan-ro/mainframe/commit/eace2d648157ac64f437b5f1f70e37d65abf3f46), [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b)]:
  - @qlan-ro/mainframe-core@0.15.1
  - @qlan-ro/mainframe-types@0.15.1
