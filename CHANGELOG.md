# Changelog

## 0.17.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.1


### Patch Changes

- [#284](https://github.com/qlan-ro/mainframe/pull/284) [`4269203`](https://github.com/qlan-ro/mainframe/commit/4269203f0b8e674c3539ab6da4b73d431ca26d2d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix TerminalPanel infinite render loop on app startup. The `getTerminals` selector returned a fresh `[]` for any project without a stored entry, causing `useSyncExternalStore` to detect a new snapshot every render and crash the renderer with React error [#185](https://github.com/qlan-ro/mainframe/issues/185) (Maximum update depth exceeded). Returns a stable empty-array reference instead. Also adds the missing `getHomedir` field to the renderer's `MainframeAPI` type so the preload contract typechecks end-to-end.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.17.1
  - @qlan-ro/mainframe-core@0.17.1


## 0.17.0


### Minor Changes

- [#282](https://github.com/qlan-ro/mainframe/pull/282) [`cf58806`](https://github.com/qlan-ro/mainframe/commit/cf58806a5edb7c812b727f54218d5aab3b1b7f1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: chat rendering + adapter event pipeline improvements ([#133](https://github.com/qlan-ro/mainframe/issues/133) [#141](https://github.com/qlan-ro/mainframe/issues/141) [#142](https://github.com/qlan-ro/mainframe/issues/142) [#144](https://github.com/qlan-ro/mainframe/issues/144))
  - **[#133](https://github.com/qlan-ro/mainframe/issues/133)** Add canonical `normalizeTodos` utility (`todos/normalize.ts`) supporting `todoV1` (TodoWrite), `taskV2` (TaskCreate/TaskUpdate/TaskStop), and `codexTodoList` sources. Wire V2 task events into Claude adapter's `onTodoUpdate` so `chat.todos` reflects V2 task progress. Add 17 tests covering all sources and edge cases.
  - **[#141](https://github.com/qlan-ro/mainframe/issues/141)** Fix thinking indicator disappearing prematurely: Claude CLI emits `result` events for subagent (Task/Agent) turns carrying `parent_tool_use_id`; these were being routed to `onResult()` which flipped `processState` to `'idle'` while the parent session was still working. Subagent result events are now dropped at the event handler level. Add 3 regression tests.
  - **[#142](https://github.com/qlan-ro/mainframe/issues/142)** Add Find-in-Chat: `Cmd+F` / `Ctrl+F` while the chat thread is focused slides down a find bar with live-filter (80ms debounce), match counter, prev/next navigation, and `Esc` to close. Implemented via `FindBar.tsx` and `find-in-chat` zustand store.
  - **[#144](https://github.com/qlan-ro/mainframe/issues/144)** Fix Codex `todoList` items silently dropped: `TodoListItem` was defined in types but missing from both the `ThreadItem` union and the `item/completed` switch. Added the union member and a `todoList` case that normalizes items via `onTodoUpdate`. Add 3 tests.

- [#281](https://github.com/qlan-ro/mainframe/pull/281) [`1a4dd2f`](https://github.com/qlan-ro/mainframe/commit/1a4dd2f641256d447fc029ffec4c5a513fa17b2c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(codex): fix AskUserQuestion option selection and add sub-agent TaskGroup grouping
  - fix(codex): extract selected option from `updatedInput.answers` when user clicks an option in AskUserQuestion (previously returned empty string, leaving Codex stuck)
  - feat(codex): render Codex sub-agent delegations as a `CollabAgent` card by handling the `collabAgentToolCall` ThreadItem on `item/started` (opens the card) and `item/completed` (closes it). `CollabAgent` is registered as a subagent tool, so the desktop's `groupTaskChildren()` promotes it to a TaskGroup card when child commands emitted on the spawned thread arrive tagged with `parentToolUseId`. Both the live event-mapper path and the chat-reload `convertThreadItems()` path emit the card so it persists across daemon HMR. Verified against Codex 0.125 strings — the `collab_agent_spawn_*` notifications assumed by the earlier draft do not exist in the binary.
  - feat(codex): use the agent's `nickname` (e.g. "Maxwell") and `role` (e.g. "explorer") from Codex's own `~/.codex/state_5.sqlite` thread registry as the TaskGroup card title and subtitle, instead of falling back to the raw spawn prompt.
  - feat(codex): pass `persistFullHistory: true` to `thread/start`/`thread/resume` (requires the existing `experimentalApi: true` capability) so spawned sub-agents stream their `commandExecution` items to the parent's notification stream.
  - feat(codex): on history reload, recover sub-agent `commandExecution` items by reading each child thread's rollout JSONL directly (`~/.codex/sessions/.../<threadId>.jsonl`). The JSON-RPC `thread/read` API filters function_call records out of child threads, so without this the reloaded TaskGroup cards lacked their nested bash commands.
  - fix(codex): on chat reload, extract `userMessage.content[0].text` from `thread/read` results — Codex stores the prompt under the nested `content` array, not the top-level `text` field. Without this fix, every reloaded chat was missing all user-typed messages.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Push tunnel status and file changes over WebSocket so the renderer reacts in real-time without polling or reopening settings. The RemoteAccessSection now updates immediately when a tunnel becomes DNS-verified, and the editor auto-reloads (or shows a "File changed on disk" banner with dirty state) when an agent modifies an open file.

  Also fix a long-standing bug where files opened from Edit/Write tool cards (which use absolute worktree paths) skipped `context.updated` subscriptions entirely — the editor and diff views now classify "external" by checking against known project/worktree bases instead of by the path's leading slash, so agent edits inside a worktree refresh open editors regardless of how the file was opened.

### Patch Changes

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Improve Quick Tunnel UX so "ready" only appears when the tunnel is actually reachable. The settings panel now distinguishes three live states driven by `tunnel:status` events: **Verifying DNS…** (cloudflared registered the connection but DNS hasn't propagated yet — yellow spinner, no pairing), **Ready** (DNS verified — green dot, pairing available), and **Unreachable** (DNS check timed out — yellow dot, "DNS not yet propagated" warning, Re-check button, pairing disabled). Also bump the daemon's DNS verification budget from 15s to 45s since trycloudflare.com URLs routinely take 20–30s to propagate on first start.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.

- Updated dependencies [[`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416)]:
  - @qlan-ro/mainframe-types@0.17.0


### Minor Changes

- [#282](https://github.com/qlan-ro/mainframe/pull/282) [`cf58806`](https://github.com/qlan-ro/mainframe/commit/cf58806a5edb7c812b727f54218d5aab3b1b7f1f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: chat rendering + adapter event pipeline improvements ([#133](https://github.com/qlan-ro/mainframe/issues/133) [#141](https://github.com/qlan-ro/mainframe/issues/141) [#142](https://github.com/qlan-ro/mainframe/issues/142) [#144](https://github.com/qlan-ro/mainframe/issues/144))
  - **[#133](https://github.com/qlan-ro/mainframe/issues/133)** Add canonical `normalizeTodos` utility (`todos/normalize.ts`) supporting `todoV1` (TodoWrite), `taskV2` (TaskCreate/TaskUpdate/TaskStop), and `codexTodoList` sources. Wire V2 task events into Claude adapter's `onTodoUpdate` so `chat.todos` reflects V2 task progress. Add 17 tests covering all sources and edge cases.
  - **[#141](https://github.com/qlan-ro/mainframe/issues/141)** Fix thinking indicator disappearing prematurely: Claude CLI emits `result` events for subagent (Task/Agent) turns carrying `parent_tool_use_id`; these were being routed to `onResult()` which flipped `processState` to `'idle'` while the parent session was still working. Subagent result events are now dropped at the event handler level. Add 3 regression tests.
  - **[#142](https://github.com/qlan-ro/mainframe/issues/142)** Add Find-in-Chat: `Cmd+F` / `Ctrl+F` while the chat thread is focused slides down a find bar with live-filter (80ms debounce), match counter, prev/next navigation, and `Esc` to close. Implemented via `FindBar.tsx` and `find-in-chat` zustand store.
  - **[#144](https://github.com/qlan-ro/mainframe/issues/144)** Fix Codex `todoList` items silently dropped: `TodoListItem` was defined in types but missing from both the `ThreadItem` union and the `item/completed` switch. Added the union member and a `todoList` case that normalizes items via `onTodoUpdate`. Add 3 tests.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Push tunnel status and file changes over WebSocket so the renderer reacts in real-time without polling or reopening settings. The RemoteAccessSection now updates immediately when a tunnel becomes DNS-verified, and the editor auto-reloads (or shows a "File changed on disk" banner with dirty state) when an agent modifies an open file.

  Also fix a long-standing bug where files opened from Edit/Write tool cards (which use absolute worktree paths) skipped `context.updated` subscriptions entirely — the editor and diff views now classify "external" by checking against known project/worktree bases instead of by the path's leading slash, so agent edits inside a worktree refresh open editors regardless of how the file was opened.

### Patch Changes

- [#278](https://github.com/qlan-ro/mainframe/pull/278) [`c01877a`](https://github.com/qlan-ro/mainframe/commit/c01877ac08589910b4762b2b3f368062608f7d35) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): four UX fixes — transient update errors, sessions sidebar header layout, long user message collapsing, and composer double scrollbar
  - [#136](https://github.com/qlan-ro/mainframe/issues/136): Transient auto-updater errors (network loss, DNS, 5xx, rate limits) no longer surface as a persistent error banner; logged at warn instead.
  - [#138](https://github.com/qlan-ro/mainframe/issues/138): Sessions sidebar project group header row now uses a fixed-width right cluster so the project name never reflows when action buttons appear on hover.
  - [#139](https://github.com/qlan-ro/mainframe/issues/139): User message bubbles longer than 600 characters are clamped to 6 lines with a "Read more / Show less" toggle.
  - [#140](https://github.com/qlan-ro/mainframe/issues/140): Composer card caps at 14 lines via `maxHeight: 14lh`, uses `overflow-hidden` on the outer card to eliminate the double scrollbar, and sets explicit `lineHeight`/`padding` on the textarea to fix cursor offset on paste.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Improve Quick Tunnel UX so "ready" only appears when the tunnel is actually reachable. The settings panel now distinguishes three live states driven by `tunnel:status` events: **Verifying DNS…** (cloudflared registered the connection but DNS hasn't propagated yet — yellow spinner, no pairing), **Ready** (DNS verified — green dot, pairing available), and **Unreachable** (DNS check timed out — yellow dot, "DNS not yet propagated" warning, Re-check button, pairing disabled). Also bump the daemon's DNS verification budget from 15s to 45s since trycloudflare.com URLs routinely take 20–30s to propagate on first start.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.

- [#279](https://github.com/qlan-ro/mainframe/pull/279) [`3ac3bbc`](https://github.com/qlan-ro/mainframe/commit/3ac3bbca495c40fbe6682f26b3fa7e1a50460a0d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix terminal cwd resolving to / on mount and make terminals project-scoped.

- Updated dependencies [[`cf58806`](https://github.com/qlan-ro/mainframe/commit/cf58806a5edb7c812b727f54218d5aab3b1b7f1f), [`1a4dd2f`](https://github.com/qlan-ro/mainframe/commit/1a4dd2f641256d447fc029ffec4c5a513fa17b2c), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416), [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416)]:
  - @qlan-ro/mainframe-core@0.17.0
  - @qlan-ro/mainframe-types@0.17.0


### Patch Changes

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Surface live tunnel status in the Named Tunnel section. Both Named and Quick tunnels now share the same status hook (`useTunnelStatus`), the same status pill (gray when idle, yellow spinner while verifying, green when ready, yellow when DNS-unreachable), and the same Start/Stop semantics. Save errors are surfaced inline. The Quick Tunnel section is hidden when a token is configured (it controls the same underlying tunnel and was confusing duplication). Daemon `tunnel:status` events now carry a `label` so subscribers can filter, and `/api/tunnel/start` falls back to the persisted token + URL when called with no body — fixing a bug where clicking Start on a configured named tunnel spawned a quick tunnel instead. The Start/Stop button label was also flipping to "Stopping…" while a start was in flight; it now reflects the in-flight action correctly.

- [#283](https://github.com/qlan-ro/mainframe/pull/283) [`c7948ed`](https://github.com/qlan-ro/mainframe/commit/c7948edae8accdf3a282a3d92bc63594991fb416) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix `file:changed` not refreshing the editor for paths the daemon resolved through a symlink (e.g. `/tmp` → `/private/tmp` on macOS). The daemon now sends a `subscribe:file:ack` event back to the requesting client carrying both the requested and resolved path; the editor accepts `file:changed` broadcasts that match either.


## 0.16.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.16.1


### Patch Changes

- [#276](https://github.com/qlan-ro/mainframe/pull/276) [`891c685`](https://github.com/qlan-ro/mainframe/commit/891c685e4e00a4f77e779ae6520b4453cfe644ad) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(desktop): polish BashCard and SearchCard layouts
  - BashCard: drop the JS-level 80-char hard truncation; let CSS `truncate` handle overflow responsively so commands fill the available row width before getting an ellipsis. Tooltip still shows the full command on hover.
  - SearchCard: header now renders `Grep · "pattern"` (toolName plus pattern, monospaced and truncatable). The path moves to its own subheader line wrapped in a Radix tooltip showing the full path on hover.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.16.1
  - @qlan-ro/mainframe-core@0.16.1


## 0.16.0


### Minor Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Codex tools now render with the same unified cards as Claude. The Codex event-mapper translates Codex-native item types into Claude-shaped tool_use blocks: commandExecution → Bash, fileChange → per-file Edit/Write with parsed unified-diff (structuredPatch), mcpToolCall → mcp**<server>**<tool> for the MCPToolCard wildcard. Codex adapter declares todo_list as hidden (parity with Claude TodoWrite — TasksSection integration tracked separately).

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tool card foundations: daemon adapter is now single source of truth for hidden tools. Desktop drops two hardcoded HIDDEN lists, filters via toolCall.category. CollapsibleToolCard gains hideToggle prop and renders subHeader in both open and closed states.

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render Codex-generated images inline in the chat. Codex's `imageGeneration` thread item carries the PNG bytes as base64 in a `result` field (camelCase fields, not snake_case as previously typed); the event-mapper now decodes that inline payload directly and falls back to reading `savedPath` from disk only if the inline result is missing. The display pipeline's `convertAssistantContent` was also missing an `image` case, so even properly emitted assistant image blocks were being dropped before reaching the UI; that branch is now wired up. Image thumbs in assistant messages also no longer force right-justification.

- Updated dependencies [[`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8)]:
  - @qlan-ro/mainframe-types@0.16.0


### Minor Changes

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Tool card foundations: daemon adapter is now single source of truth for hidden tools. Desktop drops two hardcoded HIDDEN lists, filters via toolCall.category. CollapsibleToolCard gains hideToggle prop and renders subHeader in both open and closed states.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pill family of tool cards: U12 mobile SkillLoadedCard port + adds `skill_loaded` content type. U14 WorktreeStatusPill (EnterWorktree, ExitWorktree). U15 MCPToolCard (wildcard for `mcp__*`). U16 SchedulePill (ScheduleWakeup, CronCreate, CronDelete, CronList, Monitor). All share the centered rounded-full pill shape from SkillLoadedCard.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Unified chat-stream tool cards (U1-U11). Status dot moves to trailing slot. Drop Maximize2/Minimize2 toggle (whole row clickable). Outer border on compact variants. Edit/Write get Pencil action icon prepended to FileTypeIcon. Read swaps Eye → FileText + "Read" label. Search restructures pattern into subheader. TaskCard moves description to subheader with 600-char prompt tooltip. Mobile gains full content for Read/Search/Plan/AskUserQuestion/Default cards (mobile package is shipped separately as a submodule).

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Markdown code blocks: header (language label + Copy button) and code body now share one visual surface. Drops the divider line and lighter header background.

- [#274](https://github.com/qlan-ro/mainframe/pull/274) [`47b6899`](https://github.com/qlan-ro/mainframe/commit/47b689973c6d150f4eba90638b1571185c96a4c7) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Follow-up to [#271](https://github.com/qlan-ro/mainframe/issues/271): the original 1px nudge did not actually defeat assistant-ui's autoScroll. Tracing `useThreadViewportAutoScroll.js`: the ResizeObserver callback reads `isAtBottom` from a Zustand store, and the store is only updated by the scroll event handler. Programmatic `scrollTop = X` queues the scroll event asynchronously — so the resize fires first with the stale `isAtBottom = true`, autoScroll snaps to bottom, and the just-expanded pill flies off-screen anyway. Live repro: pill viewport top went 482.5 → -5.5 (-488 px). Fix: nudge 2px (safer than 1px against sub-pixel scrollTop) AND synchronously dispatch a `scroll` event so assistant-ui's handler updates the store BEFORE the resize callback consults it. After fix: pill top 482.5 → 484.5 (+2 px, just the nudge), scrollTop 207.5 → 205.5, autoScroll skipped.

- [#271](https://github.com/qlan-ro/mainframe/pull/271) [`27908ed`](https://github.com/qlan-ro/mainframe/commit/27908ed215fcff3e52fa8fdc96aa0e0684a032e3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix expandable cards/pills jumping off-screen when toggled near the chat bottom. Adds `useExpandable` hook that nudges the chat scroller up by 1px before `setOpen` when the user is at the bottom — defeats assistant-ui's `isAtBottom < 1` autoScroll check, so the browser keeps the pill anchored to its viewport position while the new body extends downward. No JS counter-scroll, single paint, no flash. Wired into `CollapsibleToolCard` (covers Bash/Edit/Write/Read/Plan/Default/AskUserQuestion), `MCPToolCard`, `SchedulePill`, `SkillLoadedCard`, and `TaskGroupCard`. Load-bearing detail: the 1px nudge is tied to assistant-ui's `isAtBottom` threshold — verify still works on future assistant-ui upgrades.

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render Codex-generated images inline in the chat. Codex's `imageGeneration` thread item carries the PNG bytes as base64 in a `result` field (camelCase fields, not snake_case as previously typed); the event-mapper now decodes that inline payload directly and falls back to reading `savedPath` from disk only if the inline result is missing. The display pipeline's `convertAssistantContent` was also missing an `image` case, so even properly emitted assistant image blocks were being dropped before reaching the UI; that branch is now wired up. Image thumbs in assistant messages also no longer force right-justification.

- [#272](https://github.com/qlan-ro/mainframe/pull/272) [`487ef61`](https://github.com/qlan-ro/mainframe/commit/487ef61c22cf8803a92166dfe5a00915b906f855) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Bundle of small chat-rendering polish:
  - `ClickableFilePath` becomes `<span role="button">` with keydown handler instead of `<button>`, fixing the React hydration warning when nested inside another button (e.g. a tool-card header).
  - Markdown code blocks render header inside the same container as the body (single border, copy icon always visible), fixing double-border and inconsistent header positioning.
  - `SyntaxHighlightedCode` strips Shiki's default `<pre>` border/radius so it inherits the outer container chrome.
  - `SearchCard` subheader aligns to 35px (icon column + padding) and the result divider is full-width.
  - `WorktreeStatusPill` uses `my-2` for vertical rhythm parity with the rest of the pill family.
- Updated dependencies [[`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8), [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8)]:
  - @qlan-ro/mainframe-core@0.16.0
  - @qlan-ro/mainframe-types@0.16.0


### Minor Changes

- [#270](https://github.com/qlan-ro/mainframe/pull/270) [`8156814`](https://github.com/qlan-ro/mainframe/commit/815681439090f483fb31d1715d83f520992a3112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Render context-compaction events as a centered "Context compacted" pill instead of a plain system text bubble. Adds `{ type: 'compaction' }` to MessageContent / DisplayContent and a `CompactionPill` component used by `SystemMessage`. Live and history-replay paths both emit the new shape. As a small parallel change, `AssistantMessage.Fallback` now routes through the shared `renderToolCard` registry so tools without an explicit Tool UI registration still get their proper card.

- [#268](https://github.com/qlan-ro/mainframe/pull/268) [`065765f`](https://github.com/qlan-ro/mainframe/commit/065765f4500db6fd4ef89d0750132b336ae24b53) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Nest subagent activity inside the parent's Task card on both live stream and history reload.

  Replaces the prompt-suppression patches in PRs [#264](https://github.com/qlan-ro/mainframe/issues/264) and [#267](https://github.com/qlan-ro/mainframe/issues/267) with a uniform rule: every Claude CLI stream-json event with `parent_tool_use_id != null` is **inlined** into the parent assistant message that owns the matching `Agent`/`Task` `tool_use`, and each inlined block is **tagged** with `parentToolUseId`. The display pipeline's `groupTaskChildren` then wraps anything tagged with the Agent's id into a `_TaskGroup`, and `TaskGroupCard` renders the new child kinds (text, thinking, skill_loaded) alongside the existing tool_call children. The dispatch prompt renders as an intro line at the top of the expanded card body.

  History reload mirrors the live behavior: the subagent JSONL collectors now also extract text and thinking blocks (in addition to tool_use and tool_result), and every inlined block carries `parentToolUseId` so the same display pipeline produces identical output. Parent-level skill loads continue to surface at the chat root; subagent-context skill loads render as inner pills inside the Task card.

  New `SessionSink.onSubagentChild(parentToolUseId, blocks)` method in `@qlan-ro/mainframe-types` is the entry point for subagent-tagged blocks. Internal-only API; no migration needed for adapters that don't emit subagent events.

### Patch Changes

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- [#262](https://github.com/qlan-ro/mainframe/pull/262) [`1842f64`](https://github.com/qlan-ro/mainframe/commit/1842f642656bf5db1e3e3239c1277579e4fb9cf8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pill family of tool cards: U12 mobile SkillLoadedCard port + adds `skill_loaded` content type. U14 WorktreeStatusPill (EnterWorktree, ExitWorktree). U15 MCPToolCard (wildcard for `mcp__*`). U16 SchedulePill (ScheduleWakeup, CronCreate, CronDelete, CronList, Monitor). All share the centered rounded-full pill shape from SkillLoadedCard.


## 0.15.2


### Patch Changes

- [#263](https://github.com/qlan-ro/mainframe/pull/263) [`951d249`](https://github.com/qlan-ro/mainframe/commit/951d24954be02a58d4abfec90368de98aea7d498) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop synthesizing duplicate "Using skill" cards from subagent JSONLs on history replay. Each subagent (Task/Agent tool) writes its own `Base directory for this skill: …` isMeta entry; live mode never surfaces those at the parent level, so promoting them on replay produced ghost SkillLoadedCards that never appeared during the live session. Skill synthesis now skips entries from subagent files and sidechain entries.

- [#264](https://github.com/qlan-ro/mainframe/pull/264) [`fad6ea5`](https://github.com/qlan-ro/mainframe/commit/fad6ea5b2fb6b063ab59eb56a8fc89d16c715e6a) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop the duplicate "subagent prompt" pill in live Claude sessions. CLI 2.1.118+ normalizes `agent_progress` events into top-level stream-json messages with `parent_tool_use_id` set; the subagent's first event is a string-content user message that just restates the dispatch prompt — the same text already rendered by the parent's Task card from `Agent.input.prompt`. The Claude event handler now drops just that one event (string content with `parent_tool_use_id` set and no CLI-internal tags). Subagent skill loads, text/thinking, tool_use and tool_result blocks all flow through unchanged.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.15.2


### Patch Changes

- Updated dependencies [[`951d249`](https://github.com/qlan-ro/mainframe/commit/951d24954be02a58d4abfec90368de98aea7d498), [`fad6ea5`](https://github.com/qlan-ro/mainframe/commit/fad6ea5b2fb6b063ab59eb56a8fc89d16c715e6a)]:
  - @qlan-ro/mainframe-core@0.15.2
  - @qlan-ro/mainframe-types@0.15.2


## 0.15.1


### Patch Changes

- [#259](https://github.com/qlan-ro/mainframe/pull/259) [`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(claude): drop sidechain entries from history loader so subagent dispatch prompts no longer render as ghost user bubbles in the parent thread. Skill-loaded synthesis still runs first, so user-typed `/skill` invocations are preserved.

- [`eace2d6`](https://github.com/qlan-ro/mainframe/commit/eace2d648157ac64f437b5f1f70e37d65abf3f46) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect PR mutation commands (gh pr edit/ready/merge/close/reopen/comment/review and GitLab/Azure equivalents) so the PR badge appears when the agent mutates a PR, not only when it creates one.

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.15.1


### Patch Changes

- [#258](https://github.com/qlan-ro/mainframe/pull/258) [`a2e0d90`](https://github.com/qlan-ro/mainframe/commit/a2e0d909408f2f742a87a15f1265d147643d445c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix sidebar project filter drifting out of sync with the open chat. When the active chat changes (search palette, toast click, tab switch, daemon-driven activation, runtime thread switch), the filter is now cleared if the new chat lives in a different project, so the badge no longer points at a project the user is not viewing.

- [`e6c5ff1`](https://github.com/qlan-ro/mainframe/commit/e6c5ff14ed2a6fd554c5870db101d33aa4c5d741) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(editor): apply InlineCommentWidget width after Monaco's addZone, not before. Monaco's view-zones implementation sets `domNode.style.width = '100%'` inside `_addZone`, clobbering the contentWidth-based width we were setting beforehand. The first widget happened to get corrected by a later layout event; subsequent widgets stayed at full width. Width is now re-applied after addZone, and an `onDidContentSizeChange` listener keeps every open widget in sync when a scrollbar toggles.

- [#257](https://github.com/qlan-ro/mainframe/pull/257) [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Stop hammering deleted worktrees with git polls. When a worktree is removed, chats bound to it are now flagged so `getEffectivePath` returns null (routes 404 cleanly) and the StatusBar pauses its branch/status poll instead of throwing `GitConstructError` on every tick.

- Updated dependencies [[`f0f958d`](https://github.com/qlan-ro/mainframe/commit/f0f958d47cec4a52695aa60b6d9cd4ec6ebf53f3), [`eace2d6`](https://github.com/qlan-ro/mainframe/commit/eace2d648157ac64f437b5f1f70e37d65abf3f46), [`ec184da`](https://github.com/qlan-ro/mainframe/commit/ec184da0ba81b6c34104838b7e91ed600979e24b)]:
  - @qlan-ro/mainframe-core@0.15.1
  - @qlan-ro/mainframe-types@0.15.1


## 0.15.0


### Minor Changes

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.

### Patch Changes

- [#254](https://github.com/qlan-ro/mainframe/pull/254) [`cc78f1a`](https://github.com/qlan-ro/mainframe/commit/cc78f1a1159d9c8c3f0fce9d95279c50515be80b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix spurious empty user bubble in Explore agent / Task tool subagent threads.

  Bare `<command-name>` CLI echoes (no accompanying `<command-message>` tag) are
  now suppressed in `convertUserContent` instead of being synthesized into a
  `/commandName` bubble. An additional guard in `convertGroupedToDisplay` drops
  user messages whose display content and metadata are both empty, preventing any
  residual empty bubble from reaching the client.

  User-typed `/skill-name` invocations are unaffected — they always carry a
  `<command-message>` tag alongside `<command-name>` and continue to render
  correctly.

- Updated dependencies [[`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163)]:
  - @qlan-ro/mainframe-types@0.15.0


### Minor Changes

- [#249](https://github.com/qlan-ro/mainframe/pull/249) [`4b546c4`](https://github.com/qlan-ro/mainframe/commit/4b546c49de3e6d370f44b8a74eef79619118307c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Chat quote support: highlight any text in the chat thread to surface a floating "Quote" button that prepends `> ` to each line and appends it to the composer. Find-in-path dialog widened to match the command palette width.

- [#253](https://github.com/qlan-ro/mainframe/pull/253) [`d85984e`](https://github.com/qlan-ro/mainframe/commit/d85984e4671e79ad429d1c0ffc21a5ac3a181b9d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show a spinner while messages load on app startup and session switch. The chat panel now displays a centered Loader2 indicator instead of a blank area whenever `getChatMessages` is in flight, and the app-level center panel shows a loading state during the initial data fetch.

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.

- [#250](https://github.com/qlan-ro/mainframe/pull/250) [`de23db7`](https://github.com/qlan-ro/mainframe/commit/de23db741b0168e01fb40bda6f1e1c9fe321cca2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add drag-to-capture region selection in the sandbox preview tab. Users can activate "Region capture" mode (Frame icon in the toolbar), drag a rectangle over the webview, and optionally annotate the capture before adding it to the composer. The annotation appears in the capture preamble when the message is sent.

### Patch Changes

- [#255](https://github.com/qlan-ro/mainframe/pull/255) [`57c867b`](https://github.com/qlan-ro/mainframe/commit/57c867b54ec6a715e60b0ccddf529f4cb8b794dc) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pin action button bars in Quick and Full todo dialogs to the bottom so they stay visible while scrolling long forms.

- Updated dependencies [[`cc78f1a`](https://github.com/qlan-ro/mainframe/commit/cc78f1a1159d9c8c3f0fce9d95279c50515be80b), [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163)]:
  - @qlan-ro/mainframe-core@0.15.0
  - @qlan-ro/mainframe-types@0.15.0


### Minor Changes

- [#251](https://github.com/qlan-ro/mainframe/pull/251) [`f065b53`](https://github.com/qlan-ro/mainframe/commit/f065b53a7d5a2e5591f361ebab96eab2ea539163) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Settings → Notifications page with per-category OS notification toggles.

  Three toggle groups — Chat Notifications (task complete, session error), Permission Request Notifications (tool request, user question, plan approval), and Other (plugin notifications) — let users suppress OS notifications per event type without affecting in-app state, toasts, or badges. Settings are persisted via the existing general settings API as a JSON-serialized value.


## 0.14.0


### Minor Changes

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

### Patch Changes

- [#243](https://github.com/qlan-ro/mainframe/pull/243) [`1367009`](https://github.com/qlan-ro/mainframe/commit/1367009dbc2c676bef18ff2ce13c087d19a99e95) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make `asyncHandler` return its wrapped Promise so tests can properly `await` route handlers. Previously the wrapper used a fire-and-forget `.catch(next)` which discarded the Promise, forcing tests to rely on a 50ms `setTimeout`-based polyfill that raced against `listFilesWithRipgrep`'s subprocess spawn and flaked under load. Server behavior is unchanged (Express ignores the handler's return value).

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry

- Updated dependencies [[`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b), [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf)]:
  - @qlan-ro/mainframe-types@0.14.0


### Patch Changes

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry

- [#244](https://github.com/qlan-ro/mainframe/pull/244) [`92a984d`](https://github.com/qlan-ro/mainframe/commit/92a984db5156a722b57f063ea1a18fe96f137238) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix element inspect screenshot offset when Electron zoom is not 1.0 (Cmd+/-). The crop rect passed to `capturePage` is now scaled by the webview zoom factor so device-pixel coordinates align with CSS-pixel coordinates from `getBoundingClientRect`.

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

- [#246](https://github.com/qlan-ro/mainframe/pull/246) [`3ac285f`](https://github.com/qlan-ro/mainframe/commit/3ac285f95087916d80d90d3bc52cdf8329720bfb) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): show image preview thumbnails with remove button in Quick Todo and Todo Modal dialogs

- Updated dependencies [[`1367009`](https://github.com/qlan-ro/mainframe/commit/1367009dbc2c676bef18ff2ce13c087d19a99e95), [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b), [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf)]:
  - @qlan-ro/mainframe-core@0.14.0
  - @qlan-ro/mainframe-types@0.14.0


### Minor Changes

- [#245](https://github.com/qlan-ro/mainframe/pull/245) [`9a51653`](https://github.com/qlan-ro/mainframe/commit/9a51653c3b2eb14731c62996f616bd5f238a9ddf) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add multi-zone plugin support — one plugin can now register multiple UI panels simultaneously.
  - `PluginManifest.ui` accepts both the legacy single-object shape and a new array form; both are validated by Zod and normalized internally
  - `PluginUIContext.addPanel()` now returns a stable `panelId` string for targeted removal
  - `PluginUIContext.removePanel(id?)` removes a specific panel by id, or all panels for the plugin when called without an id
  - Plugin layout store keys contributions by `(pluginId, panelId)` to support multiple panels per plugin
  - Builtin todos plugin migrated to demonstrate multi-zone: fullview Kanban board + right-top quick-add sidebar

### Patch Changes

- [#247](https://github.com/qlan-ro/mainframe/pull/247) [`1ff74d5`](https://github.com/qlan-ro/mainframe/commit/1ff74d57b931dd787559a72b508d5140cdb1411b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Replace skill-injection grey bubble with a collapsible SkillLoadedCard
  - Add `skill_loaded` content block type to `MessageContent` and `DisplayContent`
  - Add `onSkillLoaded` to `SessionSink`; parse skill name, path, and content from the CLI-injected user-event text (`<skill-format>true</skill-format>`)
  - Suppress `onCliMessage` for skill-injection text; emit `onSkillLoaded` + `onSkillFile` instead
  - Cache the authoritative path extracted from the text so the `Skill` tool_use branch reuses it
  - Wire `onSkillLoaded` through `event-handler.ts` as a transient system message with a `skill_loaded` block
  - Pass `skill_loaded` blocks through `display-pipeline.ts` and `convert-message.ts` via message metadata
  - Render skill messages as a `SkillLoadedCard` (collapsible, `defaultOpen={false}`) in `SystemMessage.tsx`
  - New `SkillLoadedCard.tsx`: Zap icon + `/skillName` header with path tooltip; markdown body inside `max-h-[480px]` scrollable pane
  - Preserve user-typed `/skill-name` (and `/skill-name args`) bubbles: display-pipeline now synthesizes a readable `/cmd args` bubble from the CLI's `<command-name>`/`<command-args>` echo instead of dropping the entry


## 0.13.0


### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.

### Patch Changes

- [#236](https://github.com/qlan-ro/mainframe/pull/236) [`ca7eac2`](https://github.com/qlan-ro/mainframe/commit/ca7eac288676d24b8303d7c3282b196939ceff78) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list now re-orders correctly when a chat gets new activity, switching sessions while another is being archived no longer blocks the UI, and archiving a running chat no longer leaves a stuck spinner when the dying CLI process emits a final chat.updated event.

- [#235](https://github.com/qlan-ro/mainframe/pull/235) [`b0b091a`](https://github.com/qlan-ro/mainframe/commit/b0b091aeeaebb1490cb8c5d645dd01a257c24fd3) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fixed three file/diff editor issues: the editor can now open files outside the project root, collapsed editor panels can be re-expanded, and the diff editor no longer crops the first character of each line.

- Updated dependencies [[`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c)]:
  - @qlan-ro/mainframe-types@0.13.0


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


### Minor Changes

- [#240](https://github.com/qlan-ro/mainframe/pull/240) [`7e480e9`](https://github.com/qlan-ro/mainframe/commit/7e480e91d4ed02e07723fb2738ff937507e55c8c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added an effort picker in the composer for Claude chats. Selected effort persists per chat and is passed as --effort on CLI spawn. Mid-session change is deferred.


## 0.12.0


### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831)]:
  - @qlan-ro/mainframe-types@0.12.0


### Minor Changes

- [#230](https://github.com/qlan-ro/mainframe/pull/230) [`29f192c`](https://github.com/qlan-ro/mainframe/commit/29f192c95f9507a6625e42d134fe599cb3f000b1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a project from the sidebar. Two discoverable entry points route through the same confirm-and-cleanup flow:
  - Hover the project group header (in the "All" view) → trash icon fades in next to "New Session".
  - When filtered to a specific project, the active filter pill shows a chevron — clicking it opens a menu with "Delete Project".

  Confirming stops all running CLI sessions in that project, removes all its chats from the database in a transaction, and resets any active filter or selected chat that belonged to the deleted project. Files on disk are not affected.

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

- [#231](https://github.com/qlan-ro/mainframe/pull/231) [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add an Archive button to the chat panel header that opens a popover listing archived sessions with a Restore action. Archived chats stay hidden from the main list.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.

- Updated dependencies [[`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342), [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831), [`753ccae`](https://github.com/qlan-ro/mainframe/commit/753ccae7c4ac7e2c9a9101d1b98dc80606a7d4f5)]:
  - @qlan-ro/mainframe-types@0.12.0
  - @qlan-ro/mainframe-core@0.12.0


### Minor Changes

- [#232](https://github.com/qlan-ro/mainframe/pull/232) [`9f76627`](https://github.com/qlan-ro/mainframe/commit/9f766277b5899be807b485fd1f7343814ef11342) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Plan mode is now a standalone toggle, orthogonal to the permission mode. Codex supports plan mode with the same approval card UX as Claude, via the requestUserInput exit prompt. The per-adapter "Start in Plan Mode" checkbox in settings replaces the old Plan radio option. Existing chats and settings with permission_mode='plan' are migrated automatically. Also fixes a race where the Thinking indicator disappeared after approving a plan with Clear Context.

### Patch Changes

- [#233](https://github.com/qlan-ro/mainframe/pull/233) [`933450e`](https://github.com/qlan-ro/mainframe/commit/933450e28d508bd25f8c1d9bcda955732fbbf831) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix queued messages not clearing from the composer ([#116](https://github.com/qlan-ro/mainframe/issues/116)).

  The Claude CLI only emits `isReplay: true` acks for queued uuids when spawned with `--replay-user-messages`; without the flag, queued cleanup fell back to a cache-scan on turn completion that mis-fired when the cache was reloaded from JSONL or when the CLI exited without a final `result`. Fixes:
  - Pass `--replay-user-messages` to the Claude spawn so the CLI emits a per-uuid ack the daemon can match.
  - Route `onQueuedProcessed` back into `ChatManager.handleQueuedProcessed` so `queuedRefs` is pruned in lockstep with the composer banner.
  - Clear queued metadata and emit `message.queued.cleared` on abnormal CLI exit.
  - Drop the premature bulk-clear in `onResult` that was stripping metadata from messages the CLI hadn't dequeued yet.
  - Emit `message.queued.snapshot` to subscribing clients so the renderer's Zustand state rehydrates after a WS reconnect.


## 0.11.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1


### Patch Changes

- [#228](https://github.com/qlan-ro/mainframe/pull/228) [`7b82949`](https://github.com/qlan-ro/mainframe/commit/7b829498cad870ae239f7aea607bae7a6e249f23) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(updater): publish macOS zip artifact so electron-updater can apply updates

  Squirrel.Mac auto-updates require a `.zip` of the app bundle; the release previously shipped only `.dmg`, causing the updater to fail with "ZIP file not provided" when applying an update. Also replaces native `title` attributes on the status-bar update indicator and the composer worktree button with Radix tooltips so hovercards render with the app's own styling, re-enables hoverable content on the chat link-preview tooltip so the Copy button can be reached, and adds a right-click context menu to chat links with Copy link / Open link actions.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.1
  - @qlan-ro/mainframe-core@0.11.1


## 0.11.0


### Minor Changes

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - File search now surfaces gitignored config files (e.g. .env) while still excluding build artifacts like node_modules and dist.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.11.0


### Minor Changes

- [#221](https://github.com/qlan-ro/mainframe/pull/221) [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805) Thanks [@doruchiulan](https://github.com/doruchiulan)! - `@`-picker gains terminal-style path autocomplete. Typing `/` in an `@`-token switches from fuzzy search to tree navigation; Tab completes filenames; Enter on a directory drills in.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added the ability to delete a git worktree directly from the branches popover, with a native confirm dialog and a new POST /api/projects/:id/git/delete-worktree endpoint on the daemon.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Added a "+" button to each worktree row in the branches popover that starts a new Claude session already attached to that worktree. The `chat.create` WebSocket message now accepts optional paired `worktreePath` and `branchName` fields, so the attachment happens atomically when the chat is born.

### Patch Changes

- [#224](https://github.com/qlan-ro/mainframe/pull/224) [`29cddc7`](https://github.com/qlan-ro/mainframe/commit/29cddc7a0a9531fa0acfdebb84e1da6ec6c6afd9) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer now preserves newlines in sent messages and caps its growth at a max height with internal scroll.

  The max-height cap is applied to an outer scroll wrapper rather than the textarea itself, so the textarea grows naturally and shares its wrapping width with the highlight overlay. With the cap on the textarea, its own scrollbar shaved the effective content width, causing the two layers to wrap at different widths and the caret to drift from the visible text. The overlay also emits a trailing zero-width marker so the caret stays aligned when the text ends with a newline.

  The global text selection color is now a neutral blue instead of the orange accent, so mentions and other accent-colored text stay readable while selected.

  The highlight overlay now seeds its text from the runtime's current state on mount instead of waiting for a subscribe event, so draft text stays visible after ancestors remount (for example, when a permission prompt closes).

- [#222](https://github.com/qlan-ro/mainframe/pull/222) [`1ee5874`](https://github.com/qlan-ro/mainframe/commit/1ee5874732bd683cdb1d379f13c72923d9031027) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Session list view mode is now derived from the project filter. Grouped view is used when 'All' is selected; flat view is used when filtering by a single project. The manual toggle is gone.

- [#223](https://github.com/qlan-ro/mainframe/pull/223) [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec) Thanks [@doruchiulan](https://github.com/doruchiulan)! - While a worktree delete is in flight, show a spinner on that row's trash icon and disable both the trash and new-session buttons. Other worktree rows remain interactive.

- Updated dependencies [[`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec), [`85c5cef`](https://github.com/qlan-ro/mainframe/commit/85c5ceff8519301a11928b15439a2bd0b7647805), [`072b44f`](https://github.com/qlan-ro/mainframe/commit/072b44fb2f6e8584ae12ec451a299f609be1f4ec)]:
  - @qlan-ro/mainframe-core@0.11.0
  - @qlan-ro/mainframe-types@0.11.0


## 0.10.3


### Patch Changes

- [#216](https://github.com/qlan-ro/mainframe/pull/216) [`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken symlinks are skipped.

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.

- Updated dependencies [[`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65)]:
  - @qlan-ro/mainframe-types@0.10.3


### Patch Changes

- [#216](https://github.com/qlan-ro/mainframe/pull/216) [`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Files Tree in worktrees: "Copy Path" and "Reveal in Finder" now use the active chat's worktree path instead of the main project path. Also adds symlink support — symlinks to directories are expandable, symlinks to files are listed as files, and broken symlinks are skipped.

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.

- [#217](https://github.com/qlan-ro/mainframe/pull/217) [`442782b`](https://github.com/qlan-ro/mainframe/commit/442782b2719ec715d7d72f294d48ce1447b8e252) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Include task title in the "Task created" toast so it matches the notification body removed in the earlier dedup fix.

- Updated dependencies [[`4874e77`](https://github.com/qlan-ro/mainframe/commit/4874e7789d5162a8ae5e51e1a153b08f7c11dd22), [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65)]:
  - @qlan-ro/mainframe-core@0.10.3
  - @qlan-ro/mainframe-types@0.10.3


### Patch Changes

- [#220](https://github.com/qlan-ro/mainframe/pull/220) [`937e7df`](https://github.com/qlan-ro/mainframe/commit/937e7dff921e9ac3a12760e5c562d818c308cc65) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Claude CLI model probe silently timing out and surface the tier-resolved default model in the UI.
  - Probe now reads the initialize payload from the nested `response.response.models` path the CLI uses when `subtype === 'success'` (previously always fell back to the hardcoded list).
  - `AdapterModel` gains `description` and `isDefault` so the renderer can show what the CLI picks on the current tier.
  - Claude adapter now has a hardcoded `default` entry (labelled `Default - Opus 4.7`, the current upstream default on Max) as the pre-probe stand-in for the CLI's `"default"` alias; the probe replaces it with the live one when it succeeds.
  - Probed labels are derived from the CLI's description (e.g. `Sonnet 4.6`, `Sonnet 4.6 with 1M context`, `Haiku 4.5`); the `default` entry renders as `Default - <resolved model>`.
  - Settings and composer model pickers show descriptions in Radix tooltips on row hover, and the composer keeps legacy/tier-specific chat model ids readable by falling back to `getModelLabel`.


## 0.10.2


### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.10.2


### Patch Changes

- [#209](https://github.com/qlan-ro/mainframe/pull/209) [`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Downgrade launch spawn failures and auto-updater network errors to `warn` and drop stack traces. These are expected user-config / connectivity conditions, not application errors.

- [#211](https://github.com/qlan-ro/mainframe/pull/211) [`e68cc02`](https://github.com/qlan-ro/mainframe/commit/e68cc0208812a6b308fee2d97d7859a443cdf323) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Prevent `TurnFooter` crashes from bringing down the whole chat turn, and log renderer-process crashes so blank-screen bugs leave a trace.
  - `TurnFooter`: local error boundary. `assistant-ui`'s `tapClientLookup` can throw `"Index N out of bounds (length: N)"` during concurrent renders when the external messages array shrinks between a parent capturing its index and a descendant hook reading it. The boundary scopes the failure to the footer and auto-resets on the next render; the rest of the turn keeps rendering.
  - `main`: listen for `render-process-gone` and log `{ reason, exitCode }`. Renderer crashes (OOM, GPU, killed) previously left no trace because React `ErrorBoundary` only catches render errors, not process-level failures.

- Updated dependencies [[`fa0b079`](https://github.com/qlan-ro/mainframe/commit/fa0b079dac8ef37c7e866ee4bb27e1ef54dfc306)]:
  - @qlan-ro/mainframe-core@0.10.2
  - @qlan-ro/mainframe-types@0.10.2


## 0.10.1


### Patch Changes

- [#206](https://github.com/qlan-ro/mainframe/pull/206) [`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.10.1


### Patch Changes

- [#206](https://github.com/qlan-ro/mainframe/pull/206) [`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- Updated dependencies [[`e6e6842`](https://github.com/qlan-ro/mainframe/commit/e6e6842e477642d9f74b63cd2585cf4e36f7106b)]:
  - @qlan-ro/mainframe-core@0.10.1
  - @qlan-ro/mainframe-types@0.10.1


## 0.10.0


### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- Updated dependencies [[`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-types@0.10.0


### Minor Changes

- [#198](https://github.com/qlan-ro/mainframe/pull/198) [`6e90f97`](https://github.com/qlan-ro/mainframe/commit/6e90f97acf021565a1202f731c2510b147618ad0) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add automatic update checking with status bar indicator

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels

### Patch Changes

- [#190](https://github.com/qlan-ro/mainframe/pull/190) [`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Suppress mobile push notifications when desktop app is active

- [#194](https://github.com/qlan-ro/mainframe/pull/194) [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Make files tab the default right panel tab, fix root directory tooltip regression, fix duplicated todo creation notifications

- [#189](https://github.com/qlan-ro/mainframe/pull/189) [`afd0178`](https://github.com/qlan-ro/mainframe/commit/afd017863747e4acf41ea614b4642e6619b984db) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix memory leak: clean Maps on chat removal, add message eviction caps, unsubscribe inactive chats, cap nav stacks, clear LSP URIs

- [#200](https://github.com/qlan-ro/mainframe/pull/200) [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix Changes tab not refreshing when subagents modify files

- [#199](https://github.com/qlan-ro/mainframe/pull/199) [`f7c1133`](https://github.com/qlan-ro/mainframe/commit/f7c1133908a30ea0ea18c45fd5272b6ddd6fe87e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix terminal resize corruption by guarding fitAddon against zero dimensions and debouncing resize events

- [#201](https://github.com/qlan-ro/mainframe/pull/201) [`80026fd`](https://github.com/qlan-ro/mainframe/commit/80026fdaea261661e9d79e5a4ec8bd8b714c6112) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Re-wire file editor into center panel split after zone-based layout rewrite

- [#193](https://github.com/qlan-ro/mainframe/pull/193) [`e26c46c`](https://github.com/qlan-ro/mainframe/commit/e26c46c2124dcb0baf679e8a5c2e572c786e86cd) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Parallelize startup API calls, lazy-load infrequent chat cards, add passive scroll listener

- [#195](https://github.com/qlan-ro/mainframe/pull/195) [`a6a3bd7`](https://github.com/qlan-ro/mainframe/commit/a6a3bd789454c74a39e9a7268611acc48cf4d76b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Optimize Zustand store selectors and add React.memo to list components to reduce re-renders

- Updated dependencies [[`945df6a`](https://github.com/qlan-ro/mainframe/commit/945df6aca64db773db4f7ba473c660af12642be5), [`a20e262`](https://github.com/qlan-ro/mainframe/commit/a20e26247b589f4b609de295bf228e7d5846c16e), [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b), [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4), [`30cd3b1`](https://github.com/qlan-ro/mainframe/commit/30cd3b1a89c656a13e20e8d1376b7dd1edec03d1), [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145)]:
  - @qlan-ro/mainframe-core@0.10.0
  - @qlan-ro/mainframe-types@0.10.0


### Minor Changes

- [#196](https://github.com/qlan-ro/mainframe/pull/196) [`c4f96ee`](https://github.com/qlan-ro/mainframe/commit/c4f96ee43221ec895ed522e76f98c603e6fc3f3b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Detect GitHub PRs created during sessions and display a PR badge in the chat header. Distinguish created vs mentioned PRs using command-level detection (gh pr create, glab mr create, az repos pr create). Created PRs get a green badge and session list icon; mentioned PRs get a muted badge.

- [#197](https://github.com/qlan-ro/mainframe/pull/197) [`a583162`](https://github.com/qlan-ro/mainframe/commit/a583162c5575b75d0df54e0c14bfdc9f3bd36dd4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add session pinning to keep important sessions at the top of the list

- [#191](https://github.com/qlan-ro/mainframe/pull/191) [`828fe9b`](https://github.com/qlan-ro/mainframe/commit/828fe9b5c969e69dacef109961bdcaa734e3b145) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add tool window registry and ZoneId type for IntelliJ-style dockable panels


## 0.9.0


### Minor Changes

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#181](https://github.com/qlan-ro/mainframe/pull/181) [`0d1b34f`](https://github.com/qlan-ro/mainframe/commit/0d1b34f8e41b65b3474a41c3fc18cdcd762bb6f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Append system prompt to Claude sessions instructing use of AskUserQuestion tool

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- Updated dependencies [[`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f), [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22)]:
  - @qlan-ro/mainframe-types@0.9.0


### Minor Changes

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add integrated terminal panel with node-pty and xterm.js

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#184](https://github.com/qlan-ro/mainframe/pull/184) [`42efa20`](https://github.com/qlan-ro/mainframe/commit/42efa2069c59429f721f5fb01809ea406a4d3fb2) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Allow app-protocol URLs (slack://, vscode://, figma://, etc.) to render as clickable links in chat messages

- Updated dependencies [[`0d1b34f`](https://github.com/qlan-ro/mainframe/commit/0d1b34f8e41b65b3474a41c3fc18cdcd762bb6f4), [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f), [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22)]:
  - @qlan-ro/mainframe-core@0.9.0
  - @qlan-ro/mainframe-types@0.9.0


### Minor Changes

- [#182](https://github.com/qlan-ro/mainframe/pull/182) [`9626715`](https://github.com/qlan-ro/mainframe/commit/96267156d277265eef3086b25101f84884289d22) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show Claude's TodoWrite task checklist in the Context tab

### Patch Changes

- [#185](https://github.com/qlan-ro/mainframe/pull/185) [`a565f26`](https://github.com/qlan-ro/mainframe/commit/a565f26447784feea17ebe0e718e34285849ba5f) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service


## 0.8.1


### Patch Changes

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.8.1


### Patch Changes

- [#178](https://github.com/qlan-ro/mainframe/pull/178) [`80d7698`](https://github.com/qlan-ro/mainframe/commit/80d7698832270d83cb55185e32b697e98f607d89) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Pass default model when creating new chat sessions and show compacting indicator

- Updated dependencies []:
  - @qlan-ro/mainframe-types@0.8.1
  - @qlan-ro/mainframe-core@0.8.1


## 0.8.0


### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#176](https://github.com/qlan-ro/mainframe/pull/176) [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): read correct field path for context_usage control response

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0


### Minor Changes

- [#175](https://github.com/qlan-ro/mainframe/pull/175) [`6a1107f`](https://github.com/qlan-ro/mainframe/commit/6a1107f6a10893725a433befb1dc834c3ac71df5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add "Copy Reference" context menu action to Monaco editors

### Patch Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

- [#171](https://github.com/qlan-ro/mainframe/pull/171) [`27ee58a`](https://github.com/qlan-ro/mainframe/commit/27ee58af44a8019e3fc7f3152db2f358e3849201) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Fix preview URL not updating when switching to a worktree session

- Updated dependencies [[`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63), [`4dd60b5`](https://github.com/qlan-ro/mainframe/commit/4dd60b5ad3a4a599491e47813a42ea5319c528f4), [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365)]:
  - @qlan-ro/mainframe-types@0.8.0
  - @qlan-ro/mainframe-core@0.8.0


### Minor Changes

- [#173](https://github.com/qlan-ro/mainframe/pull/173) [`93e366e`](https://github.com/qlan-ro/mainframe/commit/93e366e20d18ba1585695e33e27d64f5608a1a63) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add dynamic Claude model list with CLI probe on startup

  Expand the hardcoded 4-model list to all 11 known Claude models with capability flags (supportsEffort, supportsFastMode, supportsAutoMode). On daemon startup, probe the CLI via an initialize handshake to get the user's actual available models based on their subscription tier. The desktop model selector updates reactively when the probe completes.

### Patch Changes

- [#172](https://github.com/qlan-ro/mainframe/pull/172) [`cec5426`](https://github.com/qlan-ro/mainframe/commit/cec542641047855cd60bc8a298f2ebbe365e1365) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(core): resolve provider default model and permissionMode in plugin chat service


## 0.7.0


### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

### Patch Changes

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): add --ff-only to pull commands to prevent merge commits on divergent branches

- [#159](https://github.com/qlan-ro/mainframe/pull/159) [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - fix(git): pass localBranch to pull service so non-current branches use fetch instead of ff-only pull

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20)]:
  - @qlan-ro/mainframe-types@0.7.0


### Minor Changes

- [#163](https://github.com/qlan-ro/mainframe/pull/163) [`919fa40`](https://github.com/qlan-ro/mainframe/commit/919fa406bb5a006f49301a2e9d3841351f955e42) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): make file paths in tool cards clickable to open in editor

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#162](https://github.com/qlan-ro/mainframe/pull/162) [`58346d2`](https://github.com/qlan-ro/mainframe/commit/58346d2f9a217814241dfcce7e8fac48aac009f5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(desktop): session rename context menu, copy tool output, scroll to diff

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements

- [#158](https://github.com/qlan-ro/mainframe/pull/158) [`105deb5`](https://github.com/qlan-ro/mainframe/commit/105deb59ffcc59076e32362d4ea8f63c576c6999) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add sorting options (by number, priority, type) to the tasks board columns

- [#161](https://github.com/qlan-ro/mainframe/pull/161) [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): bigger titles, label autocomplete, and status change notifications

- [#167](https://github.com/qlan-ro/mainframe/pull/167) [`26b6bf7`](https://github.com/qlan-ro/mainframe/commit/26b6bf76e2e8f02c1dca1e11edd2257581ca74ff) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Show unread and waiting count badges on project filter pills and bold unread session titles

### Patch Changes

- [#168](https://github.com/qlan-ro/mainframe/pull/168) [`c04af83`](https://github.com/qlan-ro/mainframe/commit/c04af838d05cc96107996989345b037be82e289b) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Restore composer draft persistence across chat switches and clean up drafts on archive

- [#153](https://github.com/qlan-ro/mainframe/pull/153) [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: replace slow JS content search with ripgrep for faster Find in Path on large projects. File name search now excludes .gitignore'd and binary files. Search palette is wider and resizable.

- [#157](https://github.com/qlan-ro/mainframe/pull/157) [`8b9ce57`](https://github.com/qlan-ro/mainframe/commit/8b9ce57a6dfcd5d2ba26817e347ebf29e9519aed) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Rename default session label from "New Chat" to "Untitled session" to match mobile

- Updated dependencies [[`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818), [`177be44`](https://github.com/qlan-ro/mainframe/commit/177be440aafc9170ef6c7aa7c27852bf370835fe), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497), [`a46abf7`](https://github.com/qlan-ro/mainframe/commit/a46abf72d75c750d048ee90007a5b90a680ae27c), [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8), [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20), [`102eb0a`](https://github.com/qlan-ro/mainframe/commit/102eb0aa64042e6cb53809562c4222e44add7f7e)]:
  - @qlan-ro/mainframe-types@0.7.0
  - @qlan-ro/mainframe-core@0.7.0


### Minor Changes

- [#156](https://github.com/qlan-ro/mainframe/pull/156) [`fea6fe7`](https://github.com/qlan-ro/mainframe/commit/fea6fe73a2f91bfc2e607ce117cc54e27d0e0818) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add in-app toast and system notifications for agent task completion, permission requests, and plugin events

- [#160](https://github.com/qlan-ro/mainframe/pull/160) [`cf230d8`](https://github.com/qlan-ro/mainframe/commit/cf230d8e940b3ce0fb19abc076e47e5dae6cb497) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat: handle protocol events for background agents, compacting status, and context usage

- [#165](https://github.com/qlan-ro/mainframe/pull/165) [`767ed2b`](https://github.com/qlan-ro/mainframe/commit/767ed2b4f93fd2d959ed2d8324037a856decb7c8) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Queued messages: send immediately to CLI stdin instead of holding until turn completes. Messages sent while agent is busy show a "Queued" badge. Users can edit (cancel + re-send) or cancel via the CLI's native cancel_async_message protocol. Badge clears and message repositions when the CLI processes it (tracked via uuid + isReplay).

- [#164](https://github.com/qlan-ro/mainframe/pull/164) [`a6b3d19`](https://github.com/qlan-ro/mainframe/commit/a6b3d19c65c4dd60cb06959f7f45bedea97e0c20) Thanks [@doruchiulan](https://github.com/doruchiulan)! - feat(todos): dependency picker, warning notifications, and toast improvements


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
