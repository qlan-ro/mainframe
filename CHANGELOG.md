# Changelog

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
