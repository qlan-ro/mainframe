# Claude CLI — /clear

How the Claude CLI's `/clear` (aliases `/reset`, `/new`) resets a session, which
hooks fire, what in-process state survives, and whether a headless client can
trigger it. Ends with a concrete feasibility recommendation for Mainframe.

Sources: TypeScript source (`claude-code/src/`, 2026-03-31 leak) for the
mechanics; installed binary **v2.1.211** (Mach-O, string-verified) for the
current command surface. **Note a version drift** called out throughout: the
leaked source marks `/clear` interactive-only, but 2.1.211 flipped it to
headless-capable. Both states are documented.

## TL;DR

- `/clear` **regenerates the session id** and starts writing to a new
  `<newSessionId>.jsonl`. The **old transcript is never deleted** — it stays on
  disk and is resumable by its old id. In 2.1.211 the command's own description
  says so: *"Start a new session with empty context; previous session stays on
  disk (resumable with /resume)."*
- It runs **in-process**: `SessionEnd` hooks (reason `clear`) fire *before* the
  wipe, `SessionStart` hooks (source `clear`) fire *after*. The live child
  process is **not** restarted.
- Backgrounded tasks and their per-agent state are **preserved** across the
  clear; foreground tasks are killed.
- There is **no dedicated control-protocol (`control_request`) subtype** for
  clear, in either the leaked source or 2.1.211. But 2.1.211 exposes `/clear` to
  thin clients via `thinClientDispatch: "post-text"` — send the literal text
  `/clear` as a stream-json `user` message and the CLI runs it in-process.

## What /clear Does to the Session

Source: `commands/clear/conversation.ts` (`clearConversation`), `commands/clear/caches.ts`
(`clearSessionCaches`), `commands/clear/index.ts` (command metadata).

| Aspect | Behavior | Source |
|--------|----------|--------|
| Session id | Regenerated: `regenerateSessionId({ setCurrentAsParent: true })` — a fresh `randomUUID()`, with the **old id recorded as `parentSessionId`** for analytics lineage | `conversation.ts` (call); `bootstrap/state.ts:435-450` |
| Transcript file | New session id → new path. `getTranscriptPath()` returns `<projectDir>/<sessionId>.jsonl`, so the next write lands in a brand-new file | `utils/sessionStorage.ts:202-204` |
| Old transcript | **Survives untouched.** Nothing in `clearConversation` deletes a file. `resetSessionFilePointer()` only nulls the in-memory pointer (`this.sessionFile = null; this.pendingEntries = []`) so the next write re-derives a fresh path | `sessionStorage.ts:688-691`, `1505-1507` |
| Resumability of old id | The old `<oldSessionId>.jsonl` remains a valid resume target (`claude --resume <oldSessionId>` / `/resume`) | 2.1.211 command description (string-verified) |
| In-memory messages | Emptied immediately: `setMessages(() => [])` | `conversation.ts` |
| `env.CLAUDE_CODE_SESSION_ID` | Updated to the new id (ant/internal builds only) so subprocesses see it | `conversation.ts` |

The command is `type: 'local'` and lazy-loads its implementation. In the leaked
source it carried `supportsNonInteractive: false` with the comment *"Should just
create a new session"* — i.e. interactive-only. In 2.1.211 this is
`supportsNonInteractive: true` (see [Headless / stream-json](#headless--stream-json-equivalent)).

## Hooks: Order

`clearConversation` brackets the wipe with two hook phases, in this exact order
(`commands/clear/conversation.ts`):

1. **`SessionEnd` — before the wipe.**
   `await executeSessionEndHooks('clear', …)`. First arg is the `reason`
   (`ExitReason`); `'clear'` is a member of `EXIT_REASONS`
   (`entrypoints/sdk/coreSchemas.ts` / `coreTypes.ts`). Bounded by
   `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` (default 1.5s) via
   `getSessionEndHookTimeoutMs()`. Signature: `utils/hooks.ts:4097-4105`.
2. *(the wipe: preserve-task computation → `setMessages([])` → `clearSessionCaches` → task partition/kill → `clearSessionMetadata` → `regenerateSessionId` → `resetSessionFilePointer` → symlink re-point → mode/worktree re-persist)*
3. **`SessionStart` — after the wipe.**
   `await processSessionStartHooks('clear')`. The arg is the `source`
   (`'startup' | 'resume' | 'clear' | 'compact'`) reported to the hook; it maps
   to the `SessionStart` hook input's `source: 'clear'`
   (`entrypoints/sdk/coreSchemas.ts:497`, `SessionStartHookInputSchema`).
   Signature: `utils/sessionStart.ts:35-42`. Any messages the hooks emit
   (e.g. injected context) become the new session's opening messages.

Both `'clear'` values were string-confirmed in the 2.1.211 binary:
`["startup","resume","clear","compact"]` (SessionStart source) and
`["clear","resume","logout",…]` (exit reasons).

## In-Process State: Cleared vs Preserved

`/clear` is a **live-process reset**, not a restart, so the distinction between
what it drops and what it keeps matters.

### Preserved

Source: `commands/clear/conversation.ts` (preserve-task computation + `AppState` partition),
`commands/clear/caches.ts` (`preservedAgentIds` handling).

- **Backgrounded tasks.** A task is preserved unless it explicitly has
  `isBackgrounded === false` (`shouldKillTask`). This includes local-agent
  tasks, in-process teammate tasks, and main-session background tasks (Ctrl+B),
  which write to isolated per-task transcripts and survive session-id
  regeneration.
- **Per-agent state of preserved tasks.** `clearSessionCaches(preservedAgentIds)`
  is passed the set of surviving agent ids. Agent-keyed state (invoked skills)
  is *selectively* cleared; request-keyed state that can't be safely scoped to
  the main session (pending permission callbacks, dump state, prompt-cache-break
  tracking) is **left intact** when any task is preserved.
- **Preserved tasks' TaskOutput symlinks** are re-pointed to the new session
  directory (`initTaskOutputAsSymlink(...)`) so their live transcript reads
  don't freeze at a pre-clear snapshot.
- **MCP `pluginReconnectKey`** is preserved (only `/reload-plugins` bumps it) so
  the clear doesn't force a redundant plugin reconnect; MCP clients/tools/commands
  themselves are reset to trigger re-init.
- **Process mode + worktree** are re-persisted after the wipe
  (`saveMode(...)`, `saveWorktreeState(...)`) so a later `--resume` of the
  new session knows its mode/dir.

### Cleared / Reset

- **Conversation messages** (`setMessages([])`).
- **Foreground tasks** (`isBackgrounded === false`): killed (shell `kill()` +
  `cleanup()`, `abortController.abort()`, `unregisterCleanup()`), dropped from
  `AppState.tasks`, and their output evicted (`evictTaskOutput`).
- **Session identity**: title/tag/agent name+color (`clearSessionMetadata`),
  `standaloneAgentContext`, commit `attribution`, `fileHistory` snapshots, plan
  slugs (`clearAllPlanSlugs`).
- **A large cache set** (`clearSessionCaches`): user/system/git-status context,
  file-suggestion and command/skill caches, dynamic + invoked skills, LSP
  diagnostics, WebFetch cache (up to 50 MB), ToolSearch description cache, agent
  definitions cache, session env vars, magic docs, repository detection,
  bash-prefix caches, and more. Also `resetSentSkillNames()` (so the full skill
  listing is re-sent — `/clear` wipes messages, unlike compaction which keeps
  them) and `resetGetMemoryFilesCache('session_start')` (so the next memory load
  is attributed to `session_start`, not `compact`).

## Headless / stream-json Equivalent

**Definitive: there is no dedicated `control_request` subtype for clear** — not
in the leaked source, not in 2.1.211.

- Cross-checked against the SDK control-protocol union
  `SDKControlRequestInnerSchema` (`entrypoints/sdk/controlSchemas.ts:551-575`):
  its 21 members are `interrupt`, `permission`, `initialize`,
  `set_permission_mode`, `set_model`, `set_max_thinking_tokens`, `mcp_status`,
  `get_context_usage`, `hook_callback`, `mcp_message`, `rewind_files`,
  `cancel_async_message`, `seed_read_state`, `mcp_set_servers`, `reload_plugins`,
  `mcp_reconnect`, `mcp_toggle`, `stop_task`, `apply_flag_settings`,
  `get_settings`, `elicitation`. **None is `clear`/`reset`/`new`.**
- Binary grep of 2.1.211 for `subtype:"clear"` / `"reset"` / `"new_session"`
  returns nothing; the only control subtypes present are the ones above.
- The `'clear'` token in the SDK schemas is **only** the `SessionEnd` reason and
  the `SessionStart` source — i.e. hook payloads, not an invocable wire command.
  (PROTOCOL_REVERSED.md is not present in this doc set; the cross-check was run
  directly against the `entrypoints/sdk/` control + core schemas that document
  derives from.)

**But 2.1.211 makes `/clear` reachable from a thin client** (SDK/stream-json
consumer such as Mainframe). Two facts, both string-verified in the 2.1.211
binary:

- `/clear` is now `supportsNonInteractive: true`. In headless mode the CLI
  builds `commandsHeadless` = prompt commands + local commands whose
  `supportsNonInteractive` is true (`main.tsx:2622`). In the leaked source
  `/clear` was excluded; in 2.1.211 it is included.
- `/clear` carries a **new** field absent from the leak:
  `thinClientDispatch: "post-text"`. 2.1.211 classifies every command's
  thin-client dispatch as one of `"control-request"` (9 commands),
  `"post-text"` (8 commands), or `"unavailable"`. `post-text` means: **the thin
  client triggers the command by posting its literal text** (`/clear`) as a
  stream-json `user` message — there is intentionally no control frame for it.

So the supported headless mechanism is: send `{ "type": "user", … "/clear" }`
over stream-json input. The CLI parses it as a headless local command and runs
`clearConversation` **in the same live process** — session-id regeneration,
`SessionEnd`/`SessionStart` hooks, and background-task preservation all apply as
above.

**Open verification point (implementation-time):** confirm how the new
session id surfaces on stdout after a mid-stream `/clear`. `system:init`
(`{type:"system",subtype:"init"}`) is built with `session_id: getSessionId()`
and yielded per query pass (`QueryEngine.ts:540`, `utils/messages/systemInit.ts:59`).
All post-clear stdout events are stamped with the *current* `getSessionId()`, so
even if a fresh `init` is not re-emitted for the local-command turn, the next
`assistant`/`result` event carries the new id. A client can rely on reading
`session_id` off the next event rather than assuming a re-`init`.

## Feasibility for Mainframe

### How Mainframe manages a Claude session today

- Each chat stores its CLI session id in `chats.claude_session_id`
  (`packages/core/src/db/chats.ts`).
- Resume passes it as `--resume <claudeSessionId>`:
  `lifecycle-manager.ts:399-402,516-518` construct the session with
  `chatId: chat.claudeSessionId`; `session.ts:149,212` turn that into the
  `--resume` arg. A chat with no stored id spawns **without** `--resume`, and the
  CLI mints a fresh id.
- Mainframe already captures the CLI's real session id from `system:init`:
  `events.ts:57` calls `sink.onInit(session_id)`, and
  `chat/event-handler.ts:146-150` writes it back with
  `db.chats.update(chatId, { claudeSessionId })`. **This plumbing is exactly
  what a native clear needs.**

### Recommended mapping — two viable options

**Option A (preferred, 2.1.211+): in-process clear via `post-text`.**
Send `/clear` as a stream-json `user` message on the existing child process,
then reconcile the new session id from the next stdout event (via the existing
`onInit`, or by reading `session_id` off the following event). This is the
closest possible parity with the CLI's own `/clear`: same process, real
`SessionEnd('clear')` / `SessionStart('clear')` hooks, and **backgrounded tasks
+ per-agent state preserved** — none of which a respawn can reproduce. Requires
gating on CLI ≥ the version that ships `supportsNonInteractive: true` +
`thinClientDispatch: "post-text"` for clear (present in 2.1.211; absent in the
2026-03-31 source, so probe/version-gate it).

**Option B (fallback, any version): fresh spawn without `--resume`.**
Kill the child, null `claude_session_id` for the chat, and let `doStartChat`
spawn a new CLI without `--resume`; `onInit` repopulates `claude_session_id`
with the fresh id. Simple and uses only existing plumbing, but see the
[headless gaps](#what-cannot-be-replicated-headlessly).

### What Mainframe should retain

- **The chat row itself** — a clear resets the *conversation*, not the Mainframe
  chat. Keep the chat id, project/worktree binding, adapter, model, and
  permission mode.
- **The old `claude_session_id` as parent lineage.** The CLI records the
  outgoing id as `parentSessionId`; Mainframe should persist the pre-clear id
  (e.g. a `parent_claude_session_id` / history-of-session-ids field) so the
  pre-clear transcript stays discoverable and **resumable by its old id** (the
  `<oldSessionId>.jsonl` is never deleted). This also lets the UI offer "view /
  resume the conversation before clear."
- **Chat title/metadata** if desired — though note the CLI *clears* its own
  session title on `/clear`; Mainframe can choose to keep the user-facing chat
  title regardless, since it owns that separately from the CLI's session title.

### What cannot be replicated headlessly

- **Option B loses in-process state by construction.** A fresh spawn starts with
  no backgrounded tasks and no per-agent state; the CLI's `/clear` deliberately
  preserves those. There is no headless way to carry a live background task
  across a respawn.
- **Hook fidelity.** Option B fires `SessionStart` with source `startup` (fresh
  spawn), and the old process's `SessionEnd` fires with whatever reason the
  daemon's kill path uses — **not** `clear`. Only Option A produces the true
  `SessionEnd('clear')` → `SessionStart('clear')` pair that user hooks expect.
- **Analytics/lineage `parentSessionId`** is only set by the in-process path;
  Option B produces two unrelated sessions unless Mainframe records the link
  itself.

### Follow-up todo seed

Implement a native "Clear" action on a Claude chat:
1. Version-probe the adapter; if `/clear` is `supportsNonInteractive` on the
   installed CLI, use **Option A** (post-text `/clear`), else **Option B**.
2. Reconcile the new `claude_session_id` from the post-clear stream (extend the
   existing `onInit`/event-handler path; do not assume a re-`init`).
3. Persist the pre-clear session id as parent lineage; keep the old transcript
   discoverable/resumable.
4. Verify with a live run that `SessionEnd('clear')`/`SessionStart('clear')`
   fire and that a backgrounded task survives (Option A only).
