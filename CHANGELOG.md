# Changelog

## 0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#142](https://github.com/qlan-ro/mainframe/pull/142) [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: stop button now works when background subagents are running

  Send SIGINT to CLI child process on interrupt to bypass the blocked stdin
  message loop. Also prevent message loss from the interrupt race condition
  by waiting for the process to fully exit before respawning.

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87)]:
  - @qlan-ro/mainframe-types@0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

- [#144](https://github.com/qlan-ro/mainframe/pull/144) [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add image attachments, filtering, and improve start-session message in todos plugin

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix composer draft preservation, kill launch processes on worktree archive, add copy relative path

- [#149](https://github.com/qlan-ro/mainframe/pull/149) [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix: branch manager bugfixes — pull safety, conflict detection, remote checkout, abort reporting, view transitions

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state

- [#146](https://github.com/qlan-ro/mainframe/pull/146) [`1cae6a5`](https://github.com/qlan-ro/mainframe/commit/1cae6a5aa923e14a45f851e4df5bd932c3c9040f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace native HTML title tooltips with Radix tooltip components across the desktop app for consistent styling and behavior

- Updated dependencies [[`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`511c44d`](https://github.com/qlan-ro/mainframe/commit/511c44d36cce05a9a4a8f40945b5751e7c5716f3), [`c3c97ed`](https://github.com/qlan-ro/mainframe/commit/c3c97ed495071064cf94399a1bde00922af3990d), [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b), [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87), [`6402c0e`](https://github.com/qlan-ro/mainframe/commit/6402c0e8d12ce4de231a004627e0d01655a37010)]:
  - @qlan-ro/mainframe-core@0.6.0
  - @qlan-ro/mainframe-types@0.6.0


### Minor Changes

- [#138](https://github.com/qlan-ro/mainframe/pull/138) [`b56da45`](https://github.com/qlan-ro/mainframe/commit/b56da45561160ece252962cbaa9036a94f711c87) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add plugin action API and quick-create todo dialog (Cmd+T)

### Patch Changes

- [#145](https://github.com/qlan-ro/mainframe/pull/145) [`c328c9c`](https://github.com/qlan-ro/mainframe/commit/c328c9ccb6663f34663131e763c622f8e1eb221b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Scope launch process statuses and logs per worktree so different worktrees of the same project show independent running state


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


### Patch Changes

- [#123](https://github.com/qlan-ro/mainframe/pull/123) [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Keep WebSocket subscriptions alive for background chats so permission requests and status updates are not silently dropped when the user switches tabs. Emit chat.updated when permissions are enqueued/resolved so displayStatus correctly reflects 'waiting' state.

- [#137](https://github.com/qlan-ro/mainframe/pull/137) [`3707218`](https://github.com/qlan-ro/mainframe/commit/37072188f8917544bba3bad9857af4829d6e9332) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow OAuth/SSO redirects to complete inside the sandbox webview instead of opening in the system browser. Persist webview sessions across app restarts via a dedicated Electron partition.

- [#135](https://github.com/qlan-ro/mainframe/pull/135) [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: support enabling and attaching worktrees mid-session

  When a chat already has a running CLI session, enabling or attaching a worktree now stops the session, migrates CLI session files to the worktree's project directory, and respawns with --resume.

- [#131](https://github.com/qlan-ro/mainframe/pull/131) [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: add inline session rename via PATCH endpoint and pencil button

- Updated dependencies [[`b180a50`](https://github.com/qlan-ro/mainframe/commit/b180a500b98c16a63069e4b97c93b0c755b62e55), [`97ebe7c`](https://github.com/qlan-ro/mainframe/commit/97ebe7cedb7a5f999d58795dd8378befe78f95ab), [`7d3bb30`](https://github.com/qlan-ro/mainframe/commit/7d3bb307275ed19cff61d0176074aa730dd2a569), [`d59bafe`](https://github.com/qlan-ro/mainframe/commit/d59bafeef10fd3336060746c74ea11b24af82e7e), [`cd326c6`](https://github.com/qlan-ro/mainframe/commit/cd326c65a1d73d35379624fcc8065ded83969803), [`5c19f6f`](https://github.com/qlan-ro/mainframe/commit/5c19f6f04de7597744ee09d32b958a6e893c1329), [`a54c3c4`](https://github.com/qlan-ro/mainframe/commit/a54c3c4b4a89bc26949a3a10b20a50d3e2c1f0b2), [`851ec20`](https://github.com/qlan-ro/mainframe/commit/851ec2015077de39717c16cdd13a2cc0f1fb038d)]:
  - @qlan-ro/mainframe-core@0.5.0
  - @qlan-ro/mainframe-types@0.5.0


## 0.2.4

### Fixes

- Fix live session diffs and context.updated timing (#100)
- Only update session updatedAt on user message send (#99)
- Prevent stale messages when switching projects (#98)
- Deduplicate display messages by id to prevent assistant-ui crash (#96)

## 0.2.3

### Features

- Branch management popover (#92)
- Add LSP proxy for Monaco editor language features (#80)
- Add Find in Path content search from file tree (#79)
- Add reveal-in-tree for open editor files (#82)
- Add Cmd+Left/Right back/forward navigation in editor (#83)
- Derive session diffs from messages, improve branch diffs (#78)
- Add pino-pretty config for dev scripts (#81)

### Fixes

- Allow image-only messages by relaxing MessageSend schema (#93)
- Auto-refresh editor when agent edits the open file (#88)
- Prevent chat message text from overflowing container (#89)
- Restore nav-history code lost in PR #82 merge (#85)
- Allow Enter to send messages while response is in progress (#76)

### Chores

- Set up Changesets for version management (#87)
- Bump the dependencies group (#84)
- Bump pnpm/action-setup from 4 to 5 (#74)
- Add WIP disclaimer and Cloudflare Tunnel guide (#77)

## 0.2.2

### Features

- Add minimize button and toggle behavior to side panels (#73)
- Auto-refresh launch config dropdown on agent writes and window focus (#72)
- Move file view collapse button to pane header with expand strip (#71)
- Move fullview plugin buttons to left rail (#70)
- Auto-refresh file tree on agent writes, window focus, and manual trigger (#69)
- Handle deleted worktrees gracefully (#65)
- Improve tool display for Claude CLI sessions (#64)
- Copy session ID on session right-click (#51)
- Open external URLs in system browser (#56)
- Mobile view toggle for sandbox preview (#49)

### Fixes

- Preserve agent label in task groups and stable session list order (#68)
- Recover chat state after project switch and restore release notes (#67)
- Recognize Agent tool and update better-sqlite3 for Electron 41 (#66)
- Resolve multiple Changes tab bugs (#63)
- Preserve selected session when switching projects (#62)
- Show AskUserQuestion Q&A as inline chat messages (#61)
- Show skill name instead of full path in session context (#60)
- Simplify permission mode management (#59)
- Recover missed responses after tab/project switch (#58)
- Coerce numeric env values to strings in launch config schema (#57)
- Allow sending messages while agent is running (#52)
- Validate cwd before spawn, dynamic CSP for Electron (#53)
- Draft releases and deduplicate changelog (#54)

### Chores

- Bump dependencies (#55, #48, #47, #46, #45)
- macOS code signing + notarization (#50)

## 0.2.1

### Fixes

- Launch env isolation, imported sessions, macOS permissions (#43)
- Dev data dir, env vars, editor save, bottom panel fixes (#42)

## 0.2.0

### Features

- Tunnel self-check verification, named tunnel switch, fd leak fix (#41)
- Import external agent sessions (#29)
- File viewing improvements + Docker fixes (#28)
- Daemon distribution — Docker, standalone binary, CLI pairing (#26)
- Mobile companion app — tunneling, permissions, launch configs (#24)
- UX improvements — CLI path, dotfiles, context menu, selection (#20)
- DisplayMessage pipeline for client-ready messages (#19)
- Full-screen overlay when daemon connection is lost (#18)
- Custom commands infrastructure (#16)
- Replace Electron file picker with daemon-side directory browser (#14)
- Playwright E2E test suite (#9)

### Fixes

- Tunnel auth bypass via localhost exemption (#40)
- Defer CLI process spawn until first message (#22)
- Tutorial flow — action-gated steps, no overlay, modal-aware (#15)
- Sandbox security, scoping, and test coverage (#17)

### Chores

- Remove Docker support (#38)
- Electron-builder publish to non-draft release (#37)
- Repair all release pipelines (#36)
- Rename packages from @mainframe/* to @qlan-ro/mainframe-* (#35)
- Publish types to GitHub Packages (#34)
- WS event router, hook split, and stale-socket fix (#13)

## 0.1.0

Initial public release.

### Features

- Multi-session management with tabbed navigation
- Claude CLI adapter with full session lifecycle (start, resume, interrupt)
- Permission gating — review and approve each tool use before execution
- Live context window usage and cost tracking
- Session history replay via Claude CLI `--resume`
- Skills support — extend agents with project-specific tools and instructions
- Agent subagent tracking (left panel Agents tab)
- Keyboard-first navigation
- Dark theme with per-adapter accent colors
