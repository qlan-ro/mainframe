# @qlan-ro/mainframe-desktop

## 0.13.0

### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.

### Patch Changes

- [#237](https://github.com/qlan-ro/mainframe/pull/237) [`99ae306`](https://github.com/qlan-ro/mainframe/commit/99ae306c278bdeb84c2ec3ba9c3d6925e6a6b72d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Images in agent responses now render inline in the chat bubble instead of showing as raw base64 text.

- [#239](https://github.com/qlan-ro/mainframe/pull/239) [`65c6a0f`](https://github.com/qlan-ro/mainframe/commit/65c6a0f1fac11797883ae963f3f0bc205d91a8ca) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix active-chat restore picking an archived session on boot. The daemon returns archived chats alongside active ones (they feed the archived-sessions popover), so `useAppInit.loadData()` must skip them when restoring `mf:activeChatId` — otherwise the right pane shows a chat that isn't visible in the flat list and the user can't navigate away.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed diff editor gutter spacing on the modified side: restores `lineDecorationsWidth: 6` so there is breathing room between line numbers and code. Follow-up to the [#113](https://github.com/qlan-ro/mainframe/issues/113) horizontal-scroll fix — the clipping was caused by `overflow-hidden`, not the decoration width, so a non-zero value is safe now that the CSS is corrected.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix InlineCommentWidget exceeding editor viewport width and causing Monaco horizontal scrollbar divergence when typing long text.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed a race on startup where the selected project badge could disagree with the chats filter after reload.

- [#238](https://github.com/qlan-ro/mainframe/pull/238) [`8d1806f`](https://github.com/qlan-ro/mainframe/commit/8d1806f58bf9fe05047f7a2fbc04c8c3ca803f37) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The Quick Todo dialog no longer crops the first character of each line and its cursor sits at the correct position. The full Todo modal now responds correctly to vertical resize — the height state is applied to the DOM so dragging the resize handle taller or shorter takes effect immediately.

- [#236](https://github.com/qlan-ro/mainframe/pull/236) [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list now re-orders correctly when a chat gets new activity, switching sessions while another is being archived no longer blocks the UI, and archiving a running chat no longer leaves a stuck spinner when the dying CLI process emits a final chat.updated event.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed three file/diff editor issues: the editor can now open files outside the project root, collapsed editor panels can be re-expanded, and the diff editor no longer crops the first character of each line.

- Updated dependencies [[`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c), [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78), [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3)]:
  - @qlan-ro/mainframe-types@0.13.0
  - @qlan-ro/mainframe-core@0.13.0
