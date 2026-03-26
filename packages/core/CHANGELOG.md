# @qlan-ro/mainframe-core

## 0.3.0

### Minor Changes

- [#110](https://github.com/qlan-ro/mainframe/pull/110) [`341054d`](https://github.com/qlan-ro/mainframe/commit/341054de99dcd07673b0999769c9073ddf3d015b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Restore external session import UI with popover, title generation, and command boilerplate stripping

- [#92](https://github.com/qlan-ro/mainframe/pull/92) [`ce26558`](https://github.com/qlan-ro/mainframe/commit/ce26558cc02af3188deefbc257b91033906f2f52) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add branch management popover with git operations (checkout, merge, push, pull, fetch, rebase, rename, delete) and reusable toast notification system

- [#105](https://github.com/qlan-ro/mainframe/pull/105) [`34cc461`](https://github.com/qlan-ro/mainframe/commit/34cc4611dc230b4425ef23fa3a657e7c737f0615) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: unified session view — remove project selector, show all sessions grouped by project

  Replace the project selector dropdown with a unified sidebar showing all sessions
  across all projects in collapsible groups. The active project is derived from the
  selected session. Worktree projects are auto-detected and linked to their parent
  repository via `git worktree list`.

### Patch Changes

- [#96](https://github.com/qlan-ro/mainframe/pull/96) [`4171e74`](https://github.com/qlan-ro/mainframe/commit/4171e742874f983bf37cea00f3c571573869e6d3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): deduplicate display messages by id to prevent assistant-ui crash

  The Claude CLI can reuse UUIDs for compact_boundary entries, producing duplicate
  message ids in the display pipeline. assistant-ui's MessageRepository throws when
  it encounters the same id twice. Now `prepareMessagesForClient` skips messages
  whose id was already emitted.

- [#101](https://github.com/qlan-ro/mainframe/pull/101) [`a5f8502`](https://github.com/qlan-ro/mainframe/commit/a5f8502de8cde46d00fa6fad7e42808ce89effcf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): persist "Always Allow" permissions to settings.local.json

  The CLI's permission_suggestions always use destination:"session" (in-memory only).
  When users clicked "Always Allow" in Mainframe, the permission was lost after the
  session ended. Now we promote session-scoped suggestions to localSettings, matching
  the terminal CLI's behavior.

- [#100](https://github.com/qlan-ro/mainframe/pull/100) [`1353e58`](https://github.com/qlan-ro/mainframe/commit/1353e58a7f5199c928261bb52ea79ffedf804b92) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): emit context.updated after tool_result instead of tool_use

  Moves the context.updated event from onMessage (fires before tool execution)
  to onToolResult (fires after). This ensures ChangesTab session-diffs and
  EditorTab file refreshes see the completed data instead of racing with the
  CLI tool execution.

- [#93](https://github.com/qlan-ro/mainframe/pull/93) [`829fbca`](https://github.com/qlan-ro/mainframe/commit/829fbca5f236c1fb596813f956ddff304cab3472) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow sending chat messages with only image attachments and no text

- [#99](https://github.com/qlan-ro/mainframe/pull/99) [`b04c3dd`](https://github.com/qlan-ro/mainframe/commit/b04c3ddee032bdb5bd378589c70121d7414bd11d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Only update session updatedAt timestamp when user sends a message, not on AI responses

- [#108](https://github.com/qlan-ro/mainframe/pull/108) [`c293e00`](https://github.com/qlan-ro/mainframe/commit/c293e008d5ad3437e86f1a11372a6e11e8a48a89) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): include subagent JSONL files in session diffs, plan files, and skill file discovery

- Updated dependencies [[`ce26558`](https://github.com/qlan-ro/mainframe/commit/ce26558cc02af3188deefbc257b91033906f2f52), [`34cc461`](https://github.com/qlan-ro/mainframe/commit/34cc4611dc230b4425ef23fa3a657e7c737f0615)]:
  - @qlan-ro/mainframe-types@0.3.0
