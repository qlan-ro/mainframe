# @qlan-ro/mainframe-core

## 0.5.0

### Minor Changes

- [#124](https://github.com/qlan-ro/mainframe/pull/124) [`b180a50`](https://github.com/qlan-ro/mainframe/commit/b180a500b98c16a63069e4b97c93b0c755b62e55) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Claude Agent SDK adapter as second builtin plugin alongside CLI adapter

- [#125](https://github.com/qlan-ro/mainframe/pull/125) [`97ebe7c`](https://github.com/qlan-ro/mainframe/commit/97ebe7cedb7a5f999d58795dd8378befe78f95ab) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Codex builtin adapter plugin — OpenAI Codex CLI integration via app-server JSON-RPC protocol with interactive approvals, streaming events, and session management

- [#136](https://github.com/qlan-ro/mainframe/pull/136) [`cd326c6`](https://github.com/qlan-ro/mainframe/commit/cd326c65a1d73d35379624fcc8065ded83969803) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Support ${VAR:-default} variable expansion in launch.json for environment-driven port configuration

- [#135](https://github.com/qlan-ro/mainframe/pull/135) [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: support enabling and attaching worktrees mid-session

  When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.

### Patch Changes

- [#123](https://github.com/qlan-ro/mainframe/pull/123) [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.

- [#119](https://github.com/qlan-ro/mainframe/pull/119) [`d59bafe`](https://github.com/qlan-ro/mainframe/commit/d59bafeef10fd3336060746c74ea11b24af82e7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Use the provided branch name for the worktree directory instead of a chatId prefix

- [#131](https://github.com/qlan-ro/mainframe/pull/131) [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add inline session rename via PATCH endpoint and pencil button

- [#134](https://github.com/qlan-ro/mainframe/pull/134) [`851ec20`](https://github.com/qlan-ro/mainframe/commit/851ec2015077de39717c16cdd13a2cc0f1fb038d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add todo-reader skill for querying project todos via sqlite3

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.5.0

## 0.4.0

### Minor Changes

- [#117](https://github.com/qlan-ro/mainframe/pull/117) [`572a492`](https://github.com/qlan-ro/mainframe/commit/572a4924b4016d395b71b119073959cb6d6985d8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix push/pull using wrong remote ref when local branch name differs from tracking branch. Group worktree branches into separate collapsible sections in the branch popover. Add tooltip on tracking label for truncated names.

- [#118](https://github.com/qlan-ro/mainframe/pull/118) [`ab58314`](https://github.com/qlan-ro/mainframe/commit/ab58314573f510ff4566048db028eed3ff29b488) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add base branch selector, custom branch naming, fork-to-worktree, worktree awareness indicators, and worktree-aware launch configurations

### Patch Changes

- Updated dependencies [[`572a492`](https://github.com/qlan-ro/mainframe/commit/572a4924b4016d395b71b119073959cb6d6985d8), [`ab58314`](https://github.com/qlan-ro/mainframe/commit/ab58314573f510ff4566048db028eed3ff29b488)]:
  - @qlan-ro/mainframe-types@0.4.0

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
