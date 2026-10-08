# Mainframe MCP orchestration server

Sources: t3code's orchestration V2 MCP toolkit (`docs/orchestration-v2/orchestrator-mcp-server.md`,
`thread-lineage-and-context-transfer.md`, `apps/server/src/mcp/{OrchestratorMcpService,McpSessionRegistry,McpHttpServer}.ts`,
`orchestration-v2/{DispatchModeLimit,NotificationMailbox}.ts`, `DelegatedCompletionDelivery.test.ts`) and
the t3code fixes merged after it (#15617, #15627, #15892, #16002, #14918, #15033). Mainframe facts were
checked against `main` at `155940a` (v2.7.1) and the Claude CLI binary at `/opt/claude-code/bin/claude`
(2.1.292). Codex facts come from Mainframe's adapter code and t3code's Codex adapter. No Codex binary
was available, so each Codex claim is listed under Gate 0 for live verification.

User decision (final): the server is **always on**. Every Claude and Codex chat that Mainframe spawns
gets the tools. There is no setting.

## Problem

An agent running in a Mainframe chat cannot see or drive other Mainframe chats. It cannot hand a
review to a different model, start parallel implementation chats in worktrees, or check on a chat it
started. Native subagents (Claude's Agent tool, Codex collab) stay inside one provider and one
transcript, and the user cannot open, steer, or answer permissions in them as ordinary chats. The
automations engine can create a chat and wait for it (`mainframe-server/src/automations_deps/agent.rs`),
but only from an automation definition, not from an agent mid-turn.

## Behavior

### Who gets the tools

Every chat whose CLI Mainframe spawns gets the tools on every spawn: Claude and Codex, project and
non-project chats, temporary chats, side chats, forks, automation-created chats, and delegated
children. Title-generation one-shots are not chats and get nothing. The mock adapter receives the
credential but ignores it.

### Tool overview

The MCP server is named `mainframe`, so Claude sees `mcp__mainframe__<tool>`. Every tool takes and
returns **Mainframe chat ids**, never provider session or thread ids.

| Tool | Kind | Purpose |
|---|---|---|
| `capabilities` | read | Caller's adapter, model, and modes; installed adapters and models; limits |
| `chat_list` | read | Chats in a project, newest first, paged |
| `chat_read` | read | A chat's timeline, incrementally, with bounded item text |
| `chat_wait` | read, blocking | Wait until a chat is idle, waiting for permission, or ended |
| `chat_launch` | mutate | Create an ordinary top-level chat, optionally with a first prompt |
| `chat_send` | mutate | Send a message to an existing chat (`auto`, `queue`, or `steer`) |
| `chat_interrupt` | mutate | Stop a chat's active turn (cascades to its delegated tasks) |
| `delegate_task` | mutate | Create a child chat with lineage that runs one task prompt |
| `task_status` | read, optionally blocking | Read one task, optionally waiting for it; or list the caller's tasks |
| `task_cancel` | mutate | Stop a delegated task and everything it delegated |

### Delegated tasks

`delegate_task` creates a **child chat** with `parent_chat_id = caller` and a `delegated_tasks` row,
then sends the task prompt as the child's first message. The child receives only that prompt, wrapped
in a task marker that names the parent. It does not receive the parent's conversation, tags, pin,
detected PRs, todos, mentions, context files, launch processes, tunnels, side chat, or title.
Children inherit the parent's project, adapter, model, tuning, permission mode, plan mode, and working
directory unless the call overrides them. Overrides may only narrow (see Security). A child can be
given its own worktree (`workspace.mode = "new_worktree"`); otherwise it shares the parent's directory.

A task has a `status` (`queued | running | waiting | completed | failed | cancelled | interrupted`) and
a `workState` (`working | waiting_for_children | result_available`). A task is terminal only when its
child chat is idle with nothing queued for it, and no task the child itself delegated is still
nonterminal. A child whose turn ends while its own tasks are pending is `waiting_for_children`. Those
results are delivered to the child, the child runs again, and the task completes after that turn. The
result `summary` is the child's last assistant text at that point, capped at 16 000 characters. A
failed child reports the error text before any progress text. Once a task is terminal, its summary is
fixed. Messages a user or agent later sends to the child chat do not reopen the task.

`mode: "async"` (default) returns immediately. `mode: "wait"` blocks until the task is terminal, the
child is waiting for a permission answer, or `timeoutMs` passes. A timeout never cancels the child.
The result says why the wait returned (`waitReturned: "terminal" | "waiting_for_permission" | "timeout"`).

### Completion delivery

When an async task becomes terminal, Mainframe owes the parent a delivery. The parent's **outbox** in
the daemon holds it until the parent is idle: process not working, no pending permission, and no
CLI-queued prompts. It is then sent as one ordinary user message. Every task result that is ready at
that moment is batched into the same message. Delivery never uses Claude's `priority: "now"` and never
lands inside a running turn. "now" aborts in-flight tool batches (t3code #15892,
`terminal_reason: "aborted_tools"`). The message body is a task-result marker per task:

```text
<mainframe-task-result task="<taskId>" chat="<childChatId>" status="completed">
<summary, or the error for failed/interrupted tasks>
</mainframe-task-result>
```

A delivery is acknowledged and not sent when the parent already received the terminal result as a
tool result from `delegate_task` (wait mode) or `task_status`. If the parent is not running when the
delivery becomes due, the send resumes it, as any send does. One exception applies after a daemon
restart: deliveries still owed at boot are held until the parent's CLI has been spawned once since
boot, typically by the user's next message. This stops a restart from waking every parent at once.

### Stop cascade

A Stop on a chat stops its delegated work depth-first. That covers the user's Stop button,
`chat_interrupt`, `task_cancel`, archive, and discard. In order:

1. Cancel the chat's in-flight MCP calls and mark it stopping. A late MCP call from the stopped turn
   is rejected with `caller_not_active` and starts nothing.
2. For each nonterminal task of the chat, deepest descendants first: interrupt the child chat, mark
   the task `cancelled` (with the optional reason), and drop its outbox entries.
3. Drop every outbox entry owed **to** the stopped chat, both task results and queued agent messages.
4. Interrupt the chat's own turn (existing `interrupt_chat`).

Child chats are kept after a cascade. The user can open, read, or continue them. Archiving or
discarding a parent never archives or deletes its children.

### Agent-sent messages

`chat_send`, `chat_launch` prompts, task prompts, and task-result deliveries are wrapped in a
whole-message marker (`<mainframe-agent-message from="<chatId>" kind="send|launch|task|task_result">`).
The marker survives transcript reload, because it is part of the message text. `chat_read` reports
these items as `origin: "agent"`, and the UI renders them as cards instead of plain user bubbles.
The marker is mirrored in `mainframe-chat/src/message_markers.rs` so titles never show it.

### UI

A delegated child is a **task chat**. It lives inside its parent's transcript, in the
`delegate_task` card, and has no row in any session list (user decision, 2026-10-07).

- **Sidebar and lists.** A task chat whose parent is loaded has no sidebar row: no nested row, no
  top-level row, no place in any sort or project grouping. The same projection
  (`features/sessions/view-model/task-chats.ts`) drops it from the archived dialog, search, the
  `@`-session picker, project ordering, the first-run count, and the boot auto-open. The parent
  lookup spans archived chats, so a task of an archived parent stays in that parent's card. One
  exception keeps nothing orphaned: a task chat whose parent is gone (deleted or discarded) keeps an
  ordinary row; its fallback glyph and hover line read `Delegated by a deleted chat`. Fork counts
  exclude task chats. Side chats stay excluded from every listing.
- **Search.** The palette lists what the sidebar lists, so task chats are not search results. They
  are found through their parent, whose card opens them.
- **Hover card.** On a launched chat, `Started by "<chat>"` (`sessions-meta-card-started-by`). On an
  orphaned task chat, `Delegated by "<parent>" · <role> · <status>`
  (`sessions-meta-card-delegated-by`).
- **Parent header.** A chip, `N tasks running · M waiting` (`chat-header-tasks-chip`), opens a
  popover. It lists the parent's tasks with status and an open link (`chat-header-task-row-<taskId>`).
  A task counts as waiting while it, or a task below it, waits on a gate.
- **Child header.** "Delegated by" (`chat-header-parent-link`) links back to the parent.
- **Transcript.** The `delegate_task` tool card shows the child title, a live status, and an open
  link (`chat-tool-delegate-task-open-<taskId>`); on an archived child the link reads "Restore and
  open" (opening a thread unarchives it). Expanded, the card shows the child's live transcript,
  read-only, through the path a native subagent uses (`SubagentTranscript` ›
  `ReadonlyThreadProvider`; `chat-tool-delegate-task-transcript-<taskId>`). It holds the latest 20
  messages; when there are more, a leading row counts them and opens the full chat
  (`chat-tool-delegate-task-open-full-<taskId>`). Until the call returns, the body is the task
  prompt; a wait-mode call returns on the child's first gate, so the transcript is there by the time
  one needs answering. The card stays a full card in compact mode. Task-result and agent-message
  markers render as compact cards (`chat-agent-message-card-<messageId>`,
  `chat-task-result-card-<taskId>`).
- **Transcript data.** The card reads the child through the child's own per-chat controller
  (`chatControllerRegistry`), the one its thread uses, so opening the child afterwards finds it warm.
  While the card is expanded it holds the controller's facade activation (`holdActive`, the
  split-zone hold): a `session/resume` for the child on the shared per-adapter `/acp/{profile}`
  connection. Collapsing or unmounting releases the hold, which detaches the stream
  (`_mainframe.dev/session_detach`). A collapsed card subscribes to nothing, and the body is
  lazy-loaded. The daemon needed no change: `session/resume` only reads history and redelivers an
  open gate.
- **Gates in the card.** The child's queue-front gate renders under its transcript
  (`chat-tool-delegate-task-gate-<taskId>`) through `GateCard`, the dispatch `ChatGateMount` uses
  for the thread's own gate, and answers into the child's session. The card opens itself whenever
  the child, or a task below it, starts waiting on the user (`hasPending || delegatedWaiting`); the
  user can collapse it again, and its status keeps reading `waiting`. A grandchild's card sits in the
  child's transcript inside the parent's card, and each level opens itself the same way.
- **Pending agent messages.** A target chat with Mainframe-held messages shows a composer chip,
  `1 message from "<sender>" after this turn` (`chat-composer-agent-outbox-chip`). The chip has a
  cancel action (`chat-composer-agent-outbox-cancel-<entryId>`).

### Permission prompts in children

Only the user answers a child's permission and question gates: in the parent's `delegate_task`
card, or in the child chat once opened, through the existing gate cards. No tool answers gates. A
child's gates surface in three ways:

- **Sidebar.** The top-level chat's row and tab show the waiting state while any unfinished task
  below it is waiting (derived `delegatedWaiting`, the same pattern as `side_chat_waiting`, over the
  whole open task subtree). The tasks chip counts it, and the card opens itself on it.
- **Notifications.** The existing push fires for the child. Its body names the parent:
  `"<child>" (task of "<parent>") needs permission`. Its `data.chatId` is the nearest ancestor that
  is not itself a task chat, so tapping it opens the chat whose card holds the gate;
  `data.taskChatId` names the child.
- **Agent side.** `chat_wait`, `task_status`, and `delegate_task` in wait mode return
  `waiting_for_permission` with the pending tool name, so the parent agent can tell the user.

## Protocol and transport

### Endpoint

`POST http://127.0.0.1:<DAEMON_PORT>/mcp`, a stateless MCP Streamable HTTP server. The daemon binds
`127.0.0.1` only (`mainframe-daemon/src/main.rs`), so `127.0.0.1` is always the right host.

The route is mounted beside the WS upgrade routes in `mainframe-server/src/http.rs`. It is outside
the device-token `auth_middleware`, whose loopback bypass would admit any local caller, and outside
`compression_layer` (Claude reads only gzip/deflate responses, binary-verified). It authenticates
itself:

| Condition | Response |
|---|---|
| Method other than `POST` (`GET` for SSE, `DELETE`) | `405`, `Allow: POST` (no server-initiated stream) |
| `Origin` header present (DNS-rebinding guard) | `403` |
| `Forwarded`, `X-Forwarded-For`, or `Cf-Connecting-Ip` present (cloudflared tunnel traffic) | `403` |
| Missing or unknown bearer token | `401`, `WWW-Authenticate: Bearer realm="mainframe"`, `tracing::warn!` with reason, never the token |
| Body over 1 MiB (route-level `RequestBodyLimitLayer`) | `413` |
| `Content-Type` not `application/json` | `415` |
| `MCP-Protocol-Version` header with an unsupported version | `400` |
| Unparseable JSON | `400`, JSON-RPC `-32700`, `id: null` |
| JSON array (batch; removed in 2025-06-18) | `400`, JSON-RPC `-32600` |
| JSON-RPC notification or response | `202`, empty body |
| JSON-RPC request | `200`, `application/json`, one JSON-RPC response |

No `Mcp-Session-Id` is issued. The bearer token already identifies the caller, so sessions add
nothing.

### JSON-RPC methods

- `initialize`: echoes the client's `protocolVersion` if it is one of `2025-11-25`, `2025-06-18`,
  `2025-03-26`, else answers `2025-11-25`. Claude 2.1.292 offers `2025-11-25` first (binary-verified).
  Returns `capabilities: { tools: { listChanged: false } }`, `serverInfo: { name: "mainframe",
  title: "Mainframe", version: <daemon version> }`, and `instructions`: at most 800 characters saying
  that ids are Mainframe chat ids, async delegation is preferred, results arrive as a message, and
  agents should end the turn instead of polling.
- `notifications/initialized`, `notifications/cancelled`: accepted (`202`).
  `notifications/cancelled` cancels the matching in-flight call.
- `ping`: `{}`.
- `tools/list`: all ten tools with `name`, `title`, `description`, `inputSchema`, and `annotations`
  (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint: false`). No `outputSchema`; see
  Decisions. No pagination.
- `tools/call`: dispatches by name. An unknown tool name is JSON-RPC error `-32602`. Every other
  failure, input validation included, is a **tool result** with `isError: true`, so the model can read
  it and correct itself.

### Tool results

Success: `{ content: [{ type: "text", text: <JSON of result> }], structuredContent: <result>, isError: false }`.
Claude shows `structuredContent` in place of text when both exist, so both carry the same bounded
object. Each result is capped at 20 KB of JSON. Claude moves larger results to a file.

Failure: `{ content: [{ type: "text", text: "<code>: <message>" }], structuredContent: { error: { code, message } }, isError: true }`.
`message` is the orchestration layer's public reason, cut to 1000 characters (t3code #15627). Port
errors that wrap storage, IO, or adapter internals are logged with `tracing::error!` and become
`orchestration_error: The operation could not be completed.`

### Credentials

The credential is a per-spawn bearer token. Before `do_start_chat` calls `session.spawn`, the
lifecycle asks the deps for a credential scoped to `(mainframe chat id, adapter session id)`. The
token is 32 random bytes, base64url. The registry stores only its SHA-256 hash, with
`issued_at`/`last_used_at`. Issuing for a chat revokes any earlier credential for that chat. The
registry revokes on adapter exit (`sink_exit.rs`), `stop_chat`, `end_chat`, archive, discard, and idle
offload, and on daemon shutdown (in-memory only). The raw token lives only in the spawn options
(`#[serde(skip)]`, `Debug` redacted) and in the child's environment. It is never persisted, logged,
or put in argv.

### Injection: Claude (binary-verified on 2.1.292)

`build_args` appends:

```text
--mcp-config {"mcpServers":{"mainframe":{"type":"http","url":"http://127.0.0.1:<port>/mcp","headers":{"Authorization":"Bearer ${MAINFRAME_MCP_TOKEN}"},"timeout":3900000}}}
--allowedTools mcp__mainframe
```

`build_spawn_command` sets the env var `MAINFRAME_MCP_TOKEN=<token>`. Each fact below was verified in
the binary:

- `--mcp-config <configs...>` accepts JSON strings. Inline JSON is parsed with
  `expandVars:!0, scope:"dynamic"`, so `${MAINFRAME_MCP_TOKEN}` expands from the child env. This keeps
  the token out of `/proc/<pid>/cmdline`, which is world-readable. `environ` is owner-only.
- The `type:"http"` schema is `{type, url, headers?, tools?, timeout?, request_timeout_ms?, alwaysLoad?}`.
  `timeout` is "Per-server tool-call timeout in milliseconds … Hard wall-clock limit per call; progress
  notifications do not extend it." The same field lifts the idle-timeout abort ("sent no response or
  progress for Ns … set a per-server 'timeout'"). Without it a wait call dies at 60 s with "The
  operation timed out." The value 3 900 000 (65 min) sits above the server's 60-minute wait maximum,
  so Mainframe's own timeout governs.
- `--allowedTools` is variadic. `mcp__mainframe` is a server-wide allow rule (`mcp__server` matches
  every tool on that server; `docs/research/adapters/claude/PERMISSIONS.md`). Its source is `cliArg`,
  so user `deny` rules still win.
- `alwaysLoad` is left unset, so the tools stay deferred behind tool search and cost no prompt tokens
  until used. `--strict-mcp-config` is not passed; user MCP servers keep working.
- Server key collision: a user server also named `mainframe` would collide with the dynamic one.
  Gate 0 records which wins.

### Injection: Codex (Gate 0: verify live)

`build_app_server_command` appends, as separate argv elements with no shell:

```text
app-server
-c mcp_servers.mainframe.url="http://127.0.0.1:<port>/mcp"
-c mcp_servers.mainframe.bearer_token_env_var="MAINFRAME_MCP_TOKEN"
-c mcp_servers.mainframe.tool_timeout_sec=3900
```

It also sets `MAINFRAME_MCP_TOKEN` in the env. Each chat has its own app-server process
(`session_spawn.rs::spawn_process`), so process-scoped config matches credential scope. Codex's
default `tool_timeout_sec` is 60, the same trap as Claude's.

The approval handler's catch-all currently answers unknown server requests with
`{"decision":"decline"}` (`approval_handler/intake.rs`). Two changes:

- `mcpServer/elicitation/request` with `serverName == "mainframe"` is answered `{"action":"accept"}`.
  The daemon enforces the ceiling, so no prompt is needed.
- Other servers' elicitations get the correctly shaped `{"action":"decline"}`.

`steer` on Codex uses `turn/steer {threadId, expectedTurnId, input}`. t3code's Codex adapter uses this
shape. It is new consumed surface (CODEX-RPC row).

## Tool schemas

Shared definitions (JSON Schema draft 2020-12; every object has `additionalProperties: false`):

```json
{
  "Id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]{1,64}$" },
  "PermissionMode": { "enum": ["default", "acceptEdits", "auto", "yolo"] },
  "ChatState": { "enum": ["idle", "working", "waiting_for_permission", "ended", "archived"] },
  "TimeoutMs": { "type": "integer", "minimum": 1000, "maximum": 3600000 },
  "Text100k": { "type": "string", "minLength": 1, "maxLength": 100000 },
  "Workspace": {
    "type": "object",
    "properties": {
      "mode": { "enum": ["inherit", "project_root", "new_worktree", "existing_worktree"] },
      "baseBranch": { "type": "string", "maxLength": 200 },
      "branchName": { "type": "string", "maxLength": 200 },
      "worktreePath": { "type": "string", "maxLength": 4096 }
    },
    "required": ["mode"]
  }
}
```

`ChatState` is derived adapter-neutrally, with the first match winning:

- `archived`: status archived.
- `ended`: status ended.
- `waiting_for_permission`: the permission manager has a pending gate.
- `working`: `process_state == Working`, or CLI-queued refs exist, or outbox entries exist.
- `idle`: none of the above.

`ChatSummary`:
`{chatId, projectId, title, adapterId, model, permissionMode, planMode, state, parentChatId, lineage: "fork"|"delegated"|null, createdByChatId, taskId, worktreePath, branchName, createdAt, updatedAt}`.

`TaskResult`:
`{taskId, childChatId, title, role, status, workState, adapterId, model, permissionMode, planMode, depth, summary, error, waitReturned, createdAt, completedAt}`.
`summary`, `error`, `waitReturned`, and `completedAt` may be `null`.

| Tool | Input (`properties`; required in **bold**) | Result |
|---|---|---|
| `capabilities` | `{}` | `{caller:{chatId,projectId,adapterId,model,permissionMode,planMode,depth}, adapters:[{id,name,installed,available,unavailableReason,models:[{id,label}],steer:bool}], allowedPermissionModes:[PermissionMode], limits:{maxDepth,maxActiveTasksPerTree,activeTasksInTree,launchesRemaining,defaultWaitMs,maxWaitMs,readMaxItems,readMaxChars}}` |
| `chat_list` | `projectId: Id` (default: caller's), `status: "active"\|"archived"\|"all"` (default active), `titleContains: string ≤200`, `includeDelegated: bool` (default true), `limit: 1–100` (default 50), `offset: ≥0` | `{projectId, chats:[ChatSummary], total, nextOffset\|null}`. Side chats, temporary chats, and automation chats are excluded. |
| `chat_read` | **`chatId: Id`**, `view: "messages"\|"activity"` (default messages), `cursor: string ≤128`, `limit: 1–100` (default 20), `maxChars: 200–8000` (default 2000), `fromEnd: bool` (default true when no cursor), `messageId: Id` + `textOffset: ≥0` (continue one truncated item) | `{chatId, state, items:[{position, messageId, role:"user"\|"assistant"\|"tool"\|"system"\|"error"\|"permission", origin:"human"\|"agent"\|"provider"\|"mainframe", toolName\|null, text, textTruncated, nextTextOffset\|null, timestamp}], nextCursor\|null, lastPosition}` |
| `chat_wait` | **`chatId: Id`**, `until: ["idle","waiting_for_permission","ended"]` subset (default all), `timeoutMs: TimeoutMs` (default 600000); the caller may not name its own `chatId` (`invalid_request`) | `{chatId, state, matched, waitTimedOut, stillWaiting, lastAssistantText\|null (≤4000), pendingPermission:{toolName,summary}\|null}`. Each call actually blocks for at most `policy::MAX_SINGLE_WAIT_MS` (45 s), well under `timeoutMs`; see Security. A call that returns before `timeoutMs` has elapsed because it hit that cap, not because anything happened, reports `stillWaiting: true` and `waitTimedOut: false` — call again with the same arguments. `waitTimedOut: true` means the caller's own `timeoutMs` is now exhausted. |
| `chat_launch` | `projectId: Id` (default caller's; `"no-project"` allowed), `prompt: Text100k`, `title: string ≤200`, `adapterId: Id`, `model: string ≤200`, `permissionMode`, `planMode: bool`, `workspace: Workspace` (default `project_root`; `inherit` only within the caller's project) | `{chatId, projectId, adapterId, model, permissionMode, planMode, worktreePath, branchName, state, promptDelivery:"started"\|"none"}` |
| `chat_send` | **`chatId: Id`**, **`message: Text100k`**, `mode: "auto"\|"queue"\|"steer"` (default auto) | `{chatId, delivery:"started"\|"queued"\|"steered", outboxEntryId\|null, state}` |
| `chat_interrupt` | **`chatId: Id`**, `reason: string ≤500` | `{chatId, interrupted:bool, state, cancelledTaskIds:[Id]}` |
| `delegate_task` | **`task: Text100k`**, `title: string ≤200`, `role: "implementation"\|"research"\|"review"\|"design"\|"test"\|"general"` (default general), `adapterId: Id`, `model: string ≤200`, `permissionMode`, `planMode: bool`, `workspace: Workspace` (`inherit` (default) or `new_worktree` only), `mode: "async"\|"wait"` (default async), `timeoutMs: TimeoutMs`, `clientRequestId: Id` | `TaskResult` |
| `task_status` | `taskId: Id` (omitted: list the caller's 50 newest tasks), `waitMs: 0–3600000` (default 0; only with `taskId`) | `TaskResult`, or `{tasks:[TaskResult]}` |
| `task_cancel` | **`taskId: Id`**, `reason: string ≤500` | `TaskResult` plus `cancelledDescendantTaskIds:[Id]` |

**`chat_read` paging.** `position` is the item's 0-based index in the chat's cached `ChatMessage` list.
The cursor is opaque base64url of `<position>:<messageId>`. On read, the id at `position` must match.
If it does not (a queued message was cancelled, or history was rewound), the server re-locates the id.
If the id is gone, it returns `invalid_cursor`. `messages` view returns user and assistant text only.
`activity` adds tool calls (name plus a 200-character input summary), tool results, system/error
items, and permission requests. Items are added until `limit` or the 20 KB result budget runs out.
`nextCursor` is `null` when the reader has caught up. Reading never loads a chat's CLI. It uses
`ChatManager::get_messages`, which may load history from disk.

**`chat_send` modes.** The modes are defined against Mainframe's existing queue. The Claude CLI owns
its queue (`supports_replay_ack`, `send_queue.rs`). Codex has no queue.

| Target state | `auto` | `queue` | `steer` |
|---|---|---|---|
| idle (live or offloaded) | send now → `started` | same | `no_active_turn` |
| working / waiting_for_permission | same as `queue` | hold in the target's Mainframe outbox; flush when idle → `queued` | Claude: existing busy-send path with explicit `priority:"next"` (folds at the next tool boundary; never `"now"`) → `steered`. Codex: `turn/steer` → `steered`. Adapter without steer: `not_steerable` |
| ended / archived / side chat / temporary / automation | `chat_not_sendable` | same | same |

`queue` uses the Mainframe outbox for Claude too, not the CLI queue. Claude's default priority for
stdin user messages is flag-gated in 2.1.292: it falls back to `next`, which folds mid-turn, or to
`later`. The outbox gives the documented "after the active turn" contract on both adapters.

**`delegate_task` idempotency.** `clientRequestId` is unique per parent. A retry with the same key
returns the existing task. Without a key, every call creates new work. `chat_launch` has no retry key,
as in t3code. The description tells agents to `chat_list` before retrying a lost launch.

### Error codes

| Code | When |
|---|---|
| `invalid_request` | Schema or refinement failure (message names the field) |
| `chat_not_found` / `project_not_found` / `task_not_found` | Unknown id, or a task that belongs to another parent |
| `caller_not_active` | A mutating tool was called while the caller is not `working`, or while it is stopping |
| `permission_mode_escalation_denied` / `plan_mode_escalation_denied` | Ceiling violation |
| `adapter_unavailable` / `model_unavailable` | Adapter not installed or not registered; model not advertised |
| `chat_not_sendable` / `no_active_turn` / `not_steerable` | See the send table; `chat_interrupt` on an idle chat returns `no_active_turn` |
| `invalid_cursor` | Unrecoverable `chat_read` cursor |
| `workspace_invalid` | Bad branch name, missing base branch, or a path that is not a worktree of the project |
| `depth_limit_exceeded` / `task_limit_exceeded` / `rate_limited` | Limits in Security |
| `orchestration_error` | Internal failure (generic public message) |

## Data model

Migration **32** (31 is reserved for the in-place provider-switch migration; the runner applies any
version above the stamped one, so the gap is safe only if 31 merges before a build stamped 32 ships.
`migrations.rs` is already 568 lines, so the body goes in a new `mainframe-db/src/migrations/orchestration.rs`
and the list grows by one entry):

```sql
ALTER TABLE chats ADD COLUMN created_by_chat_id TEXT;          -- agent provenance (launch + delegate)
CREATE INDEX IF NOT EXISTS idx_chats_created_by ON chats(created_by_chat_id);
CREATE TABLE IF NOT EXISTS delegated_tasks (
  id                TEXT PRIMARY KEY,
  parent_chat_id    TEXT NOT NULL,
  child_chat_id     TEXT NOT NULL UNIQUE,
  client_request_id TEXT,
  title             TEXT,
  role              TEXT NOT NULL DEFAULT 'general',
  status            TEXT NOT NULL,      -- queued|running|waiting|completed|failed|cancelled|interrupted
  depth             INTEGER NOT NULL,   -- 1 for a top-level chat's child
  summary           TEXT,
  error             TEXT,
  cancel_reason     TEXT,
  delivery          TEXT NOT NULL DEFAULT 'pending', -- pending|owed|delivered|acknowledged|dropped
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_delegated_tasks_parent ON delegated_tasks(parent_chat_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_tasks_request
  ON delegated_tasks(parent_chat_id, client_request_id) WHERE client_request_id IS NOT NULL;
```

Children are inserted with `temporary = 0`. The side-chat invariant `idx_chats_one_side_chat ON
chats(parent_chat_id) WHERE temporary = 1` would otherwise reject a second child, and would let a
child pose as a side chat. Lineage kind is derived on read: a row in `delegated_tasks` → `delegated`;
`temporary = 1` → side chat; otherwise `fork`. The fork queries and the UI's `fork-lineage.ts` must
exclude delegated children from fork counts.

Credentials and outbox `send` entries are in memory only. CLIs die with the daemon, so neither can
outlive it. Task deliveries are persisted through `delegated_tasks.delivery`.

**Types** (`mainframe-types`, mirrored in `packages/types`):

- New `orchestration.rs`: `DelegatedTask`, `TaskStatus`, `TaskWorkState`, `TaskRole`, `TaskDelivery`.
- `Chat` gains `created_by_chat_id: Option<String>` (stored) and three derived, never-stored fields:
  `delegation: Option<ChatDelegation{task_id, role, status}>` on a child, `delegated_active_count:
  Option<u32>` and `delegated_waiting: Option<bool>` on a parent.
- `SessionSpawnOptions` gains `orchestration_mcp: Option<OrchestrationMcpLaunch{url, token: SecretToken}>`
  with `#[serde(skip)]`. `SecretToken`'s `Debug` prints `***`.
- `NewChat` gains `lineage: Option<NewChatLineage{parent_chat_id, created_by_chat_id}>`.

**Events.** New `DaemonEvent::DelegatedTaskUpdated { task }` (`"delegated_task.updated"`), emitted on
every status, workState, or delivery change. Parents get `chat.updated` when their derived task
counts change. Outbox changes emit `chat.updated` on the target with derived
`agent_outbox: Option<Vec<{entry_id, from_chat_id, preview}>>`. Cancelling an entry uses
`DELETE /api/chats/:chatId/agent-outbox/:entryId`: ids are validated, the handler returns `404` if the
entry does not exist, and it is behind the normal auth layer.

## Security

- **Token scope.** One credential per spawned process, scoped to one Mainframe chat. It grants only
  the orchestration tools. It is revoked on exit, stop, end, archive, discard, and offload.
  Revocation and Stop cancel the credential's in-flight calls (`tokio_util::sync::CancellationToken`
  per credential). An HTTP disconnect drops the handler future (hyper) and cancels waits. Committed
  mutations stay durable.
- **What the token is.** The token identifies the caller. It is not a sandbox. The REST API already
  admits any loopback process without a token (`middleware/auth.rs`), so a local agent could reach
  chats by other means. The ceiling and limits below stop agents from escalating **through these
  tools**. They do not defend against a hostile local process. Codex's default
  `shell_environment_policy` excludes `*TOKEN*` variables from tool shells (verify in Gate 0). Claude's
  Bash inherits the variable, which is acceptable for the same reason.
- **Validation.** Each tool input deserializes into a `#[serde(deny_unknown_fields)]` struct and runs
  an explicit `validate()`, the `ws_schemas.rs` idiom. `validate()` checks id patterns, length caps,
  enum membership, and that `textOffset` requires `messageId`. A golden test pins each `inputSchema` to
  its struct with accept and reject fixtures.
- **Paths.** `new_worktree` validates `branchName` with the existing `branch_name_ok`, moved from
  `routes/worktree.rs` into a shared helper, and checks that `baseBranch` exists with
  `git rev-parse --verify` (array args). `existing_worktree` canonicalizes `worktreePath`
  asynchronously and requires it to equal a path from `git worktree list --porcelain` for the project.
  This is the `resolveAndValidatePath` equivalent, because worktrees live outside the project root.
- **Privilege ceiling.** Ranks: `default 0 < acceptEdits 1 < auto 2 < yolo 3` **by label**, but the
  ceiling compares *effective* rank (`policy::effective_mode_rank(adapter_id, mode)`), not the label.
  Codex has no "ask before every edit" mode: its `default`, `acceptEdits`, and `auto` all map to
  approval `on-request` plus sandbox `workspace-write`
  (`mainframe-adapter-codex::session_thread::permission_mode_policy`), i.e. unprompted edits, the same
  real privilege as Claude's `acceptEdits` — never Claude's `default`. Comparing labels alone let a
  cautious, prompt-before-every-edit Claude `default` parent (label rank 0) delegate to a Codex child
  in `default` or `acceptEdits` (label rank 0 or 1) because 0 ≤ 0 or the check even ran against the
  wrong adapter's rank table; `effective_mode_rank` ranks every Codex mode but `yolo` at 1, so that
  delegation is now refused. Plan mode is narrower than not-plan, compared as before. A delegated
  child, a launched chat, and the target of `chat_send` or `chat_interrupt` must each have effective
  rank ≤ the caller's, and a plan-mode caller may only create or target plan-mode chats. The target
  check runs again immediately before dispatch, against the live `ActiveChat` (`chat_send`,
  `chat_interrupt`) read right before the ceiling check with no intervening await, because the user
  may have raised the target meanwhile (t3code `DispatchModeLimit`); `chat_launch` and `delegate_task`
  check only once, against the caller, because they create a new chat rather than driving an existing
  one — the residual race there is a caller mode change landing between that check and the adapter
  write, same as before. `task_cancel` on the caller's own task is always allowed, because cancelling
  only narrows.
- **Project scoping.** Every tool that targets an existing chat by id (`chat_read`, `chat_wait`,
  `chat_send`, `chat_interrupt`) resolves it through `OrchestrationService::target_chat`, which
  requires the target's `projectId` to equal the *caller's* `projectId`. A chat in another project
  reads exactly like an unknown id (`chat_not_found` / `chat_not_sendable`, per tool), so a caller
  cannot learn that an out-of-project id exists. Delegated children always inherit the parent's
  project (`delegate_task::build_request`), so a parent and its whole task tree stay reachable from
  each other regardless of which project the parent itself is in. `chat_list`'s own `projectId` input
  is a deliberate exception — it is how an agent discovers chats in a *different* project it was
  told about, not a target-by-id lookup — but it already excludes side, temporary, and automation
  chats the same way `target_chat` does.
- **Caller liveness.** Mutating tools require the caller to be `working` and not stopping. This also
  stops a stale Codex process, which survives `turn/interrupt`, from acting after its turn ended.
- **Recursion and rate limits.** Orchestration depth is the length of the `created_by_chat_id` chain,
  walked at most `MAX_DEPTH + 1` steps. Constants live in `policy.rs`:
  - Depth: maximum 3, for launch and delegate alike, so a launch→launch chain is bounded too.
  - Active tasks: at most 8 nonterminal tasks per root tree, and at most 4 per parent.
  - Chat creation: `chat_launch` plus `delegate_task` limited to 20 per caller chat per 10 minutes
    (sliding window).
  - Waits: at most 4 concurrent blocking calls per credential.
- **Prompt injection.** `chat_read` returns other chats' text to the model. Tool descriptions say that
  returned text is data and must not be followed as instructions. Children receive only the task
  prompt.
- **Logging.** All handlers log through `tracing` with `chat_id`, `tool`, `code`, and `duration_ms`.
  Tokens, `Authorization` headers, prompts, and message bodies are never logged.

## Compatibility with sibling specs

- **Fork from here (non-destructive).** A fork of a chat with tasks does not inherit them. Tasks are
  keyed by `parent_chat_id`, so the fork's copied `delegate_task` calls return `task_not_found`, and
  owed deliveries still go to the source. A fork of a delegated child is an ordinary fork of that
  chat, not a task. The lineage-kind derivation (task row → delegated, temporary → side, else fork)
  must stay the single source both specs use.
- **In-place provider switching.** Tools, tasks, outbox entries, and credentials are keyed by
  Mainframe chat id. A provider switch spawns a new adapter session. That issues a new credential and
  revokes the old one. Task completion reads Mainframe chat events and `last_assistant_text`, never
  provider ids, so a child that switches provider mid-task still completes. The ceiling reads the
  chat's provider-neutral `ExecutionMode`. `capabilities` reports per-adapter availability, so a
  caller can delegate cross-provider without knowing which provider session is current.

## Decisions

1. **Hand-rolled MCP server; no `rmcp`.** `Cargo.lock` has no MCP crate. The server needs five
   methods, no sessions, no SSE, and auth that sees the axum request (peer, headers). `rmcp`'s
   Streamable HTTP service brings session management and SSE by default, plus a dependency to track.
   The JSON-RPC envelope reuses `mainframe_types::acp::jsonrpc`. Estimated cost is about 300 lines
   across `protocol.rs` and `dispatch.rs`.
2. **New Tier-1 crate `mainframe-orchestration`, port-based** like `mainframe-automations`. It depends
   on `mainframe-types` plus external crates only. ChatManager, DB, git, and the event bus are reached
   through `OrchestrationPort` traits, implemented in `mainframe-server/src/orchestration_deps/`. This
   keeps the policy logic testable with fakes and the crate graph acyclic. The repository for
   `delegated_tasks` lives in `mainframe-db`. The axum handler stays thin in `mainframe-server`.
3. **Server key `mainframe`, unprefixed tool names.** Claude already namespaces as
   `mcp__mainframe__chat_read`. A `mainframe_` prefix would read `mcp__mainframe__mainframe_chat_read`
   and cost tokens on every call. Flipping to prefixed names is a one-constant change if a future
   adapter has no namespacing.
4. **All tools auto-allowed on Claude** (`--allowedTools mcp__mainframe`). Prompting on every read or
   wait would make the feature unusable. The daemon enforces the ceiling, and user `deny` rules still
   apply. Codex accepts `mainframe` elicitations for the same reason.
5. **The outbox, not the CLI queue, carries deliveries and `queue` sends.** It is adapter-neutral,
   batches sibling results, can drop entries on Stop, and never folds into a running turn.
6. **Event-driven waits.** A waiter subscribes to the `DaemonEvent` broadcast **before** reading
   state, then re-reads on each `chat.updated`, `chat.ended`, or `delegated_task.updated` for the
   chats involved, and on `RecvError::Lagged`. There is no periodic poll.
7. **No `outputSchema`.** Declaring one makes clients validate `structuredContent` strictly. Error
   results and evolving shapes would then fail client-side.
8. **Restart behavior.** CLIs die with the daemon. At boot, tasks that were `queued`, `running`, or
   `waiting` become `interrupted` with delivery `dropped`. Completed tasks keep delivery `owed` but
   flush only after the parent's first spawn since boot. In-memory `queue` sends are lost; their
   callers' turns died too.
9. **Children are non-temporary and live in their parent's card.** They are real work the user may
   need to open, answer permissions in, or continue, so they are kept and openable. They have no
   sidebar row (user decision, 2026-10-07); the `delegate_task` card and the child's "Delegated by"
   link are the ways in. Launched chats are ordinary top-level chats with `created_by_chat_id`
   provenance and no lineage.
10. **Wait mode returns on a child's permission gate.** t3code waits for the result only. Mainframe
    returns early so the parent agent can tell the user, instead of blocking silently for up to an hour.
11. **The card reads the child's own stream.** It reuses the child's controller and the split-zone
    activation hold instead of a new subscription kind, so a gate answered in the card is the gate
    the child's thread shows, and opening the child afterwards replays nothing. The hold lives only
    while the card is expanded.
12. **Twenty messages inline.** The card is a window onto the child, not a second chat: the latest
    20 messages hold the last few turns, enough to follow the task and answer its gate. "Open full
    chat" has the rest. The bound is a count, not a height, so nothing scrolls inside the card.
13. **A pending gate opens the card.** The alternative, a collapsed card with a gate badge, makes the
    user click before they can answer; the gate is the reason they came. Each rise of the waiting
    state opens it again; a user collapse holds until then.
14. **Search excludes task chats.** Search lists what the sidebar lists. A task chat is found through
    its parent, whose card shows and opens it. An orphaned task chat (parent gone) is listed and
    searchable like any chat.

## Not included

- Agents answering permission or question gates in other chats.
- Agent tools for rename, tags, pin, archive, or worktree management. t3code's
  `thread_update` and `create_threads` batch launch are left out too.
- Scheduled or recurring tasks (t3code `schedule_task`).
- Context transfer to children (portable summaries, native forks). Children get the prompt only.
- Remote callers: OAuth, tunnel access, or a user-visible MCP URL for outside agents.
- MCP resources, prompts, sampling, elicitation from the server, and `listChanged`.
- ACP, Gemini, and OpenCode adapters. Gemini and OpenCode would receive the credential the same way
  once they are spawned by the daemon.

## Test plan

Rust unit tests live next to each module. Run single tests: `cargo test -p <crate> <name>`.

- **`mainframe-orchestration`, protocol.** Version negotiation for all four cases. `initialize`
  result. `tools/list` names and annotations. An unknown tool returns `-32602`. A notification returns
  `NoContent`. Error text is capped at 1000 characters and a port error does not leak.
- **`mainframe-orchestration`, credentials.** Issue revokes the prior credential. `resolve` matches
  only the hash. Revoke cancels in-flight tokens. `Debug` never prints the token.
- **`mainframe-orchestration`, inputs.** For each tool, the golden schema matches the serde struct
  with accept and reject fixtures. Unknown fields are rejected.
- **`mainframe-orchestration`, policy.** The ceiling matrix covers 4×4 modes × plan. Depth walk.
  Per-tree and per-parent task limits. Sliding-window rate limit, using a fake clock.
- **`mainframe-orchestration`, tools (fake port).** `chat_read` paging, cursor relocation,
  `invalid_cursor`, and text continuation. Every cell of the `chat_send` matrix. `chat_wait` returns on
  the event without a poll (assert no timer wakeups), re-reads on `Lagged`, and times out without side
  effects. `delegate_task` covers inheritance and narrowing overrides, idempotent `clientRequestId`,
  and an async completion that lands in the outbox and flushes only on idle. Siblings batch into one
  message. A `task_status` read acknowledges the delivery so it is not re-sent. Nested
  `waiting_for_children` holds the task nonterminal until the grandchild result is processed. Stop
  cascades depth-first, drops owed deliveries, and rejects a late call with `caller_not_active`.
  Wait mode returns on `waiting_for_permission`.
- **`mainframe-db`.** Migration 32 on a fresh DB and on a v30 DB. Repository CRUD, the partial unique
  request index, and lineage-kind derivation (fork, side, and delegated coexisting under one parent).
- **`mainframe-server` route.** axum `oneshot` covers `405`, `403` for an Origin header, `403` for a
  forwarded header, `401` for a missing or unknown token, `413`, `415`, `400` for a batch, and
  `202` for a notification. A happy-path `tools/call` returns `capabilities`. The route never passes
  through `auth_middleware` or compression.
- **`mainframe-server` integration.** Uses `chat_test_support` with the mock adapter: launch,
  delegate, child completion, delivery to the parent, the stop cascade, and boot reconcile.
- **Adapters.** Claude `build_args` contains `--mcp-config` with the `${MAINFRAME_MCP_TOKEN}`
  placeholder (never the token), `"timeout":3900000`, and `--allowedTools mcp__mainframe`; the command
  env carries the token. Codex app-server argv has the three `-c` entries; env carries the token. A
  `mainframe` elicitation gets `{"action":"accept"}` and another server's gets `{"action":"decline"}`.
  `steer` maps to `turn/steer` and to a Claude payload with `priority:"next"`.
- **Lifecycle.** The credential is issued before `spawn` and revoked on `on_exit`, `stop_chat`,
  `end_chat`, archive, discard, and offload. Interrupt triggers the cascade hook.
- **UI (vitest, single files).** `task-chats.ts` drops a task chat with a loaded parent from the
  lists and keeps an orphan; fork counts exclude task chats; the boot pick skips task chats. Tasks
  chip counts, including a nested gate. The `delegate_task` card mounts the child's transcript only
  when expanded and opens itself on `hasPending` or `delegatedWaiting`; the transcript body's
  states, bound, and gate answer; `useTaskChat` holds and releases the child's stream. Marker cards
  render. Outbox chip cancel. Parent waiting state from `delegatedWaiting`.
- **E2E (Playwright, mock adapter).** A mock fixture step `mcp_call` performs a real HTTP call with
  the spawn credential. It covers delegate → no sidebar row for the child → result card in parent →
  the card expands into the child's transcript → open the child → its "Delegated by" link back.
- **Live smoke (manual).** Use the `claude-protocol-debugger` and `codex-protocol-debugger` skills. A
  wait longer than 61 s completes. Delegation across Claude→Codex and Codex→Claude. A steer mid-tool
  batch ends with no `aborted_tools`.

## Implementation tasks

0. **Gate 0, live probes.** Record each result in `docs/research/adapters/{claude,codex}/CONSUMED-SURFACE.md`.
   - Claude 2.1.292:
     - `${VAR}` expansion in inline `--mcp-config` headers.
     - A tool call longer than 60 s with `timeout`.
     - No permission prompt with `--allowedTools mcp__mainframe` in `default` and plan mode.
     - A stdin payload `priority:"next"` folds at a tool boundary without `aborted_tools`.
     - A long MCP call is **not** auto-backgrounded in stream-json mode. The binary returns 0 for
       non-interactive sessions unless `CLAUDE_AUTO_BACKGROUND_TASKS` is set. If it is backgrounded,
       set `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` in the spawn env.
     - Collision precedence for a user server also named `mainframe`.
   - Codex:
     - The three `-c` keys and `bearer_token_env_var`.
     - Whether streamable HTTP needs a feature flag on the pinned version.
     - The `mcpServer/elicitation/request` shape.
     - `turn/steer` params.
     - `shell_environment_policy` token exclusion.
1. **Types.** `mainframe-types/src/orchestration.rs`; the `Chat`, `NewChat`, `SessionSpawnOptions`,
   and `DaemonEvent` additions. Mirror them in `packages/types/src/{chat,events}.ts`, then run
   `pnpm --filter @qlan-ro/mainframe-types build` and `exec tsc --noEmit`. Update the Codex
   `configure_spawn` literal.
2. **DB.** `mainframe-db/src/migrations/orchestration.rs` (migration 32, `LATEST_VERSION` bump),
   `delegated_tasks.rs` repository, `chats.rs` `created_by_chat_id` plus derived lineage fields in
   `CHAT_SELECT_FIELDS`, and fork-count exclusion. Tests in `mainframe-db/tests/`.
3. **Crate skeleton.** `crates/mainframe-orchestration/` (workspace member, `#![forbid(unsafe_code)]`):
   `protocol.rs`, `dispatch.rs`, `errors.rs`, `credentials.rs`, `policy.rs`, `ports.rs`. Add it to the
   tier table in `docs/ARCHITECTURE.md`.
4. **Route.** `mainframe-server/src/routes/mcp.rs`, mounted in `http.rs` beside the WS routes with a
   route-level 1 MiB limit. Add `AppCtx.orchestration`. Wire the boot in `mainframe-daemon/src/main.rs`.
5. **Credential issuance.** `ChatManagerDeps::{issue_orchestration_credential,
   revoke_orchestration_credential, on_chat_stopping}` with no-op defaults (`chat_manager/deps.rs`). Add
   a helper in `lifecycle_manager/spawn_prep.rs` called from `do_start_chat`. Add revoke calls in
   `event_handler/sink_exit.rs`, `stop_chat`, `end_chat`, `archive_chat`, `discard.rs`, and
   `idle_offload.rs`. Implement these in `mainframe-server/src/chat_deps.rs`.
6. **Claude injection.** New `mainframe-adapter-claude/src/orchestration_args.rs` (`session_spawn.rs`
   is at 231 lines). Add `env` in `build_spawn_command`. Add `steer` via an optional `priority` on
   `build_user_payload`. Add the `AdapterSession::{supports_steer, steer}` trait methods, defaulting to
   unsupported, in `mainframe-adapter-api/src/adapter/adapter_session.rs`.
7. **Codex injection.** `-c` args and env in `session_spawn.rs::build_app_server_command`. Elicitation
   handling in `approval_handler/intake.rs`. New `turn_steer.rs`.
8. **Ports.** `mainframe-server/src/orchestration_deps/{mod,chat_port,task_store,events,workspace}.rs`
   over `ChatManager`, `Db`, the broadcast, and `GitFactory`. Reuse `last_assistant_text` from
   `automations_deps/chat_port.rs` by moving it to a shared module.
9. **Read tools.** `tools/{capabilities,chat_list,chat_read}.rs` and `waiter.rs` plus
   `tools/chat_wait.rs`.
10. **Mutating tools.** `outbox.rs` (flush on idle, batching, armed-after-boot set), and
    `tools/{chat_launch,chat_send,chat_interrupt}.rs`.
11. **Delegation.** `tasks.rs` (finalize on terminal, nested `waiting_for_children`, acknowledgement,
    depth-first cascade) and `tools/{delegate_task,task_status,task_cancel}.rs`. Boot reconcile is
    called from `main.rs` after bind.
12. **Markers.** `mainframe-chat/src/message_markers.rs` plus the TS mirror in
    `packages/ui/src/features/chat/markers/message-markers.ts`. Add the agent-message and task-result
    card renderers.
13. **UI.** Load `mainframe-design-system` first. Changes go in `features/sessions/view-model/task-chats.ts`
    (task chats out of every list), `SessionMetaCard.tsx`, the chat header tasks chip, the
    `delegate_task` tool card with the child's transcript and gate, and the composer outbox chip. Add
    the outbox `DELETE` route with validation and tests.
14. **Docs and release.** Update `docs/API-REFERENCE.md` (the `/mcp` endpoint, tools, the outbox
    route, the event), `docs/ARCHITECTURE.md`, and the consumed-surface rows. Add a changeset (minor:
    ui, types).

## Implementation status

Built on branch `worktree-agent-a520919eb3cf212c7` (2026-10-06); the UI, the derived `Chat` fields,
and the E2E fixture on branch `worktree-agent-a30868585bf2155ed` (2026-10-07); task chats moved
from the sidebar into the `delegate_task` card on branch `worktree-agent-a15a5d1eec15e84cd`
(2026-10-07).

**Done.** The `mainframe-orchestration` crate (protocol, dispatch, credentials, policy, ports, outbox,
waiter, tasks, all ten tools); `POST /mcp` with every row of the endpoint table; credential issue
before every spawn and revocation on exit, stop, end, archive, discard, offload, and shutdown;
Claude and Codex injection; Codex elicitation answers; steer (`priority:"next"` on Claude,
`turn/steer` on Codex); the outbox with idle flush, sibling batching, acknowledgement, and boot
hold; the depth-first Stop cascade; boot reconcile; migration 32 and the `delegated_tasks`
repository; `delegated_task.updated`; `DELETE /api/chats/:id/agent-outbox/:entryId`; title
unwrapping of the agent-message marker; TS type mirrors; agent-message and task-result cards in
the transcript. The derived `Chat` fields (`created_by_chat_id`, `delegation`,
`delegated_waiting`, `agent_outbox`); `chat.updated` on a chat whenever its held messages change
and on both chats whenever a task changes; fork-count exclusion; the delegated-by and started-by
hover-card lines; "Delegated by" in the child's header; the tasks chip; the `delegate_task` tool
card; the composer outbox chip with cancel; the parent's waiting state on its row and tab; the
push body naming the parent; the E2E `mcp_call` fixture step and the delegate scenario.

Task chats in the card: task chats out of the sidebar, the archived dialog, search, the
`@`-session picker, project ordering, the first-run count, and the boot auto-open, with the
orphan exception; the nested-row variant for delegated children removed (its glyph and the
`Task · <role>` label); the card's live read-only transcript (20 messages, "Open full chat") over
the child's controller and activation hold, lazy-loaded; the child's gate in the card through the
shared `GateCard`; the card opening itself on `hasPending || delegatedWaiting`; the card as a full
card in compact mode; restore-and-open for an archived child; `delegated_waiting` over the whole
open task subtree (a recursive walk in `CHAT_SELECT_FIELDS`); the tasks chip counting a nested
gate; the push opening the top-level chat (`data.chatId`) and naming the child
(`data.taskChatId`).

**Deviations.**

- Hooks: the chat layer reaches the service through `mainframe-chat::orchestration_hooks`
  (`OrchestrationHooks` attached with `ChatManager::set_orchestration_hooks`), not new
  `ChatManagerDeps` methods. `build_chat_manager` has eight call sites; a post-build attach
  (the chat-surface pattern) avoids touching all of them. The same slot answers
  `agent_outbox`, so one attach reaches spawns and reads.
- Exit revocation listens for `process.stopped` (keyed by the adapter session id) instead of a
  call in `sink_exit.rs`; `stop_chat`, `end_chat`, archive, discard, and offload revoke directly.
- The derived fields live in one flattened `Chat.orchestration: ChatOrchestration` (the wire
  shape stays flat). `CHAT_SELECT_FIELDS` reads `created_by_chat_id`, the child's task, and the
  ids of its unfinished children; `delegated_waiting` follows live gates over those ids (the
  `side_chat_waiting` pattern), so it covers direct children; a grandchild's gate shows on its
  own parent. One `Enricher` derives every computed field for reads and for every sub-manager's
  emit. `ChatManager::refresh_agent_lineage` re-reads the row into a loaded cell before the
  re-announce (port `chat_changed`), since the cell otherwise keeps what it loaded.
- `delegated_active_count` is not built: the tasks chip counts the child rows' `delegation`, and a
  second count on the parent would be a second source of truth.
- The narrow provenance queries and `GET /api/chats/:id/agent-outbox` are removed; the port and
  the chip read the `Chat`.
- The push body is rewritten in `mainframe-server`'s `send_push` (`orchestration_deps/push.rs`),
  one place for both permission push sites.
- The tasks chip sits in each chat column's header (`ChatColumnHeader`): the window-level chat
  header was retired on 2026-10-04.
- UI: the `delegate_task` card is a `TOOL_REGISTRY` by-name entry on assistant-ui's tool engine,
  in the shared card shell. The outbox chip follows `QueuedUserTurn` (daemon-held, so the native
  `Queue` model does not apply). The tasks chip is a `DropdownMenu`.
- The E2E step is `{"dir":"out","method":"mcp_call","args":[{toolUseId, tool, arguments}]}`; the
  mock emits the tool use, makes the call, and emits the answer as the tool result.
- Task ids are `task_<childChatId>`.
- `branch_name_ok` moved to `mainframe-server/src/orchestration_deps/workspace.rs`;
  `existing_worktree` reuses `mainframe_services::workspace::get_worktrees`.

**Not run.** The Playwright scenario (`packages/e2e/tests-tauri/mcp-delegate.spec.ts`), updated for
task chats in the card, has not been run; Rust tests cover the `mcp_call` step against a local server, against the real `/mcp` route,
and the recording's shape.

### Post-review fixes (2026-10-08)

A QA and code review of this feature found daemon-side issues; fixed here, with tests:

- **Privilege ceiling by effective privilege, not label (`policy.rs`).** See Security; the ceiling
  now reads `effective_mode_rank(adapter_id, mode)` instead of the bare label rank, so a Codex
  `default`/`acceptEdits`/`auto` chat (all unprompted edits) never compares as lower-privilege than a
  Claude `default` chat (prompts on every edit) just because the labels did.
- **Project scoping on every chat-id-targeting tool (`service.rs::target_chat`, `chat_send.rs`).** See
  Security; `chat_read`, `chat_wait`, `chat_send`, and `chat_interrupt` now read a chat in another
  project as not found. `chat_list`'s own cross-project `projectId` parameter is unchanged — it is a
  project-id lookup the spec always documented, not a chat-id guess, and a different threat model.
- **`chat_wait` capped well under a minute per call (`policy::MAX_SINGLE_WAIT_MS`, `chat_wait.rs`).**
  The injected `timeout`/`tool_timeout_sec` (Injection sections above) raise each *client's* own
  per-tool-call ceiling to 3 900 000 ms, above the server's 3 600 000 ms maximum — but that relies on
  the raised value actually taking effect end to end (unverified live, Gate 0) and is silently lost if
  a user's own MCP server named `mainframe` wins the collision the Claude section calls out. Rather
  than depend on that, every single wait call (`chat_wait`, `task_status` `waitMs`, `delegate_task`
  `mode: "wait"`) now actually blocks for at most 45 s regardless of the caller's requested timeout,
  safely under both clients' *un-configured* default (60 s). `chat_wait` reports the distinction
  explicitly (`stillWaiting: true`, `waitTimedOut: false`) so the agent knows to call again rather than
  give up; the task tools needed no new field, because their existing `waitReturned: "timeout"`
  already means "not finished, not cancelled, ask again" per their docs above.
- **`chat_wait` rejects a self-wait.** A chat could pass its own `chatId`, which would never resolve
  until the internal cap (previously: up to the full 60-minute maximum) because nothing else runs on
  its own turn to flip its own state. Added as a dedicated `invalid_request`, not folded into the
  project-scope or not-found checks, since the caller *can* read its own state at any time — it was
  never not-found, just a guaranteed stall.
- **Concurrent `delegate_task` calls can no longer pass the per-parent/per-tree limits or the
  idempotency check together (`service.rs::tree_lock`, `tasks_ops.rs::tree_root`,
  `delegate_task.rs`).** The idempotency check, the limit check, and the insert now run under one
  lock per delegation-tree root (not global), closing the check-then-insert race; released before a
  `wait` call blocks, so one caller's wait never holds up a sibling delegation in the same tree.
- **A Codex steer that loses the turn-end race no longer relatches the chat to Working
  (`chat_manager/send.rs::send_plain_text`).** Steering no longer calls `set_working`: it only ever
  folds into a turn the caller already confirmed is Working, so re-asserting it was always redundant
  on success and, on a steer that raced the turn's own end (Codex rejects `turn/steer` once its
  `expectedTurnId` has ended), was actively wrong — nothing else would ever flip the chat back, since
  the real turn had already finished.
- **A switch before the first message now narrows plan mode the same way `plan_switch` does
  (`chat_manager/switch_api.rs`).** That path bypasses `plan_switch` (no native session exists yet to
  plan against) and wrote the config directly; it was passing plan mode through unchanged instead of
  applying "kept when `capabilities.planMode`, else `false`", so a plan-mode chat that switched to a
  provider without plan mode, before ever sending a message, silently kept a plan-mode flag the new
  provider cannot honor.
- **A `chat_launch`/`delegate_task` config-mode-apply failure (`finish`) no longer leaves an orphaned
  chat (`orchestration_deps/launch.rs`).** Setting plan mode on the freshly created chat now archives
  it on failure, the same cleanup the adjacent worktree-provisioning failure already did — previously
  only that one path cleaned up; the plan-mode path left a stray chat the caller never learns the id
  of (the tool call itself fails).
- **A chat's `is_stopping` flag could outlive its Stop (`lifecycle.rs::on_event`).** Discard deletes
  the chat row before emitting `ChatEnded`, so `port.chat` reads `None` by the time the event loop
  sees it; the flag only cleared on a chat confirmed present and idle, so a discarded chat's entry
  leaked for the rest of the process (harmless — the chat is unreachable either way — but unbounded).
  Clearing now also covers "the chat is gone".
- **Dead tool-name reference in the handoff recovery line (`mainframe-chat/src/handoff/render.rs`).**
  `recovery_line` pointed agents at a tool named `read_chat`; the real tool is `chat_read`. Also fixed
  in the surrounding doc comments and the `chat_read_available` field name (was `read_chat_available`).
- **Not a bug, evidence recorded by a new test.** "Interrupted tasks never reported to an
  async-waiting parent": `finalize` already sets `delivery: Owed` for every non-`cancelled` terminal
  status, `interrupted` included — only a `task_cancel`'d task (the parent's own request) drops
  delivery. `a_directly_interrupted_child_still_delivers_to_an_async_waiting_parent` pins this.
  "Children are interrupted rather than stopped on cascade": the Stop cascade section above already
  specifies "interrupt the child chat" for each cancelled task, and `cancel_task` does exactly that
  (`self.port.interrupt(&child)`); archiving or deleting children was never the design — see "Child
  chats are kept after a cascade" in the same section.
- **Not fixed here.** "Dual-write mirror columns can drift across a downgrade/upgrade cycle"
  (provider-switch spec, `chats` as a segment-repository-only mirror) is an inherent cost of that
  design, already called out as "reversible" in that spec's Decision 2; closing it needs
  migration-time reconciliation, a separate task. "Stop-cascade re-entrancy tested only against
  `FakePort`" is addressed by a new integration test exercising the real hook
  (`interrupting_a_chat_through_the_real_hook_cascades_through_its_whole_task_tree`,
  `mainframe-server/src/orchestration_deps/tests.rs`), but true re-entrancy — a second Stop arriving
  while the first's cascade is still in flight — is not separately covered; the lock shapes
  (`tree_lock`, `task_lock`) make a concurrent second cascade on the *same* tree safe by construction,
  but that is argued, not tested.

### Pending live verification (Gate 0)

None of these could run here: no authenticated standalone Claude CLI and no Codex binary.

- Claude 2.1.292: `${MAINFRAME_MCP_TOKEN}` expansion in inline `--mcp-config` headers; a tool call
  longer than 60 s with `timeout`; no permission prompt with `--allowedTools mcp__mainframe` in
  `default` and plan mode; `priority:"next"` folds at a tool boundary without `aborted_tools`; a
  long MCP call is not auto-backgrounded in stream-json mode (else set
  `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0`); precedence when a user server is also named `mainframe`.
- Codex: the three `-c` keys and `bearer_token_env_var`; whether streamable HTTP needs a feature
  flag on the pinned version; the `mcpServer/elicitation/request` shape; `turn/steer` params;
  `shell_environment_policy` excluding `*TOKEN*` from tool shells.

Record each result in `docs/research/adapters/{claude,codex}/CONSUMED-SURFACE.md` (rows
CLAUDE-FLAG-04, CLAUDE-IO-03, CODEX-FLAG-05, CODEX-RPC-09, CODEX-RPC-10).

## Open questions (guesses made)

- Limits (depth 3, 8 per tree, 4 per parent, 20 creations per 10 min, 4 concurrent waits) are guesses
  to tune after use.
- `chat_launch` defaults to `project_root` (as in t3code). It could instead inherit the caller's
  worktree.
- Whether the user's Stop on a parent should cancel children by default, or ask. The spec follows
  t3code (always cancel).
- A grandchild's gate re-emits `chat.updated` only on its own chat and its direct parent. The desktop
  reloads the list on any `chat.updated`, so the top-level chat's `delegatedWaiting` is current
  there; a client that patches single chats would need the re-announce to walk up the tree.
