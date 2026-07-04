# Claude Protocol Findings

Accumulated knowledge about the Claude CLI's JSON-RPC-like protocol over stdio. Updated as new findings are discovered during debugging sessions.

See also: [`cli-binary-internals.md`](cli-binary-internals.md) for binary reverse-engineering findings (minified JS structure, abort controller chains, agent wait loops).

## snake_case vs camelCase

Stream-json (live) uses **snake_case**. JSONL (history) uses **camelCase**.

| Stream-JSON (live) | JSONL (history) |
|---------------------|-----------------|
| `tool_use_result` | `toolUseResult` |
| `request_id` | `requestId` |
| `tool_use_id` | `toolUseId` |
| `tool_name` | `toolName` |
| `permission_suggestions` | `permissionSuggestions` |

Always check both casings when reading event fields.

## Event Pipeline

```
CLI stdout (stream-json, snake_case)
  -> events.ts: handleEvent() dispatches by event.type
    -> handleAssistantEvent: sink.onMessage(content)
    -> handleUserEvent: sink.onToolResult(content) via buildToolResultBlocks()
    -> handleControlRequestEvent: sink.onPermission(request)
    -> handleResultEvent: sink.onResult(data)
  -> event-handler.ts: buildSessionSink() processes sink callbacks
    -> Caches messages, emits DaemonEvents to WebSocket clients

CLI JSONL files (camelCase, includes toolUseResult)
  -> history.ts: loadHistory() reads on daemon restart / --resume
    -> convertUserEntry() via buildToolResultBlocks() (same function, different input casing)
```

## Daemon Log Analysis

The daemon logs every `control_response` payload at INFO level in `session.ts:respondToPermission`.

### See all permission responses sent today

```bash
grep "writing permission response" ~/.mainframe/logs/server.$(date +%Y-%m-%d).log
```

### Extract structured data from payloads

```bash
python3 -c "
import json
with open('$HOME/.mainframe/logs/server.$(date +%Y-%m-%d).log') as f:
    for line in f:
        if 'writing permission response' in line:
            try:
                obj = json.loads(line)
                payload = json.loads(obj['payload'])
                inner = payload['response']['response']
                tool = obj.get('toolName','?')
                perms = inner.get('updatedPermissions')
                print(f'Tool: {tool}, behavior: {inner.get(\"behavior\")}')
                if perms:
                    for p in perms:
                        print(f'  dest={p.get(\"destination\")}, type={p.get(\"type\")}')
                else:
                    print('  NO updatedPermissions')
            except: pass
"
```

### Dev vs production log paths

```bash
# Dev app logs (port 31416)
grep "DEBUG" ~/.mainframe_dev/logs/server.$(date +%Y-%m-%d).log | tail -5

# Production app logs
grep "DEBUG" ~/.mainframe/logs/server.$(date +%Y-%m-%d).log | tail -5
```

## Adding Debug Logging

The entry point is `packages/core/src/plugins/builtin/claude/events.ts`. Each event type has a handler: `handleAssistantEvent`, `handleUserEvent`, `handleControlRequestEvent`, `handleResultEvent`.

Use `log.warn` (not debug/trace — dev daemon default is INFO) with:
- `Object.keys(event)` to discover available fields
- Raw values (truncated with `.slice(0, 200)`)
- Both snake_case and camelCase variants

```typescript
log.warn(
  {
    eventKeys: Object.keys(event),
    hasTurCamel: !!event.toolUseResult,
    hasTurSnake: !!event.tool_use_result,
    turSnakeKeys: event.tool_use_result ? Object.keys(event.tool_use_result) : [],
  },
  'DEBUG raw event data',
);
```

The dev daemon (`tsx watch`) auto-restarts on file changes. Trigger the action in the dev app (port 31416).

**Remove all debug logging before committing.**

## Message Queue in stream-json Mode (verified in leaked source, 2026-06-12)

The CLI **fully owns the message queue** in `--input-format stream-json` mode. Source: `src/utils/messageQueueManager.ts` + `src/cli/print.ts` + `src/query.ts` in the leaked tree.

- **Two concurrent loops**: the stdin reader (`for await (message of structuredIO.structuredInput)`) runs independently of the turn runner (`run()`). User messages arriving mid-turn are read immediately, deduped by `uuid` (both against session JSONL history and a runtime Set), then `enqueue()`d into a module-level priority queue. `run()` has a mutex (`if (running) return`) — a busy turn leaves the message queued. This supersedes the v2.1.85 "single blocked loop" picture in cli-binary-internals.md.
- **Priorities**: `'now' > 'next' > 'later'`, FIFO within a level. User messages default to `'next'`; system notifications to `'later'`. **The incoming stream-json user message accepts a `priority` field** (print.ts forwards `message.priority`). A `'now'` message triggers `abortController.abort('interrupt')` via a queue subscriber — interrupt-and-inject in a single stdin write.
- **Mid-turn drain**: between tool-use iterations *within* a turn, query.ts snapshots queued commands at priority ≥ `'next'` (≥ `'later'` if the Sleep tool just ran) and injects them as **attachments into the current turn** — the model can see a queued message without waiting for the next turn. Slash commands are excluded from mid-turn drain.
- **Between-turn batching**: `drainCommandQueue` in print.ts greedily merges consecutive `prompt`-mode commands into ONE follow-up turn (`joinPromptValues`), keeping the last uuid; with `--replay-user-messages` it emits `isReplay: true` user events for every merged uuid so per-message acks still arrive.
- **Cancellation**: `control_request {subtype: "cancel_async_message", message_uuid}` removes a still-queued message; the `control_response` carries a boolean (false = already dequeued/consumed). Mainframe's daemon already uses this (`session.cancelQueuedMessage`).
- **Mainframe has TWO queue implementations** (verified 2026-07-04): legacy `main` forwards straight to stdin and mirrors CLI state via `queuedRefs`; current `feat/app-tauri-wt` (2026-06-27 refactor) holds messages in the daemon (`ChatManager.chatQueues`) and flushes ONE per run-end — the CLI never sees them mid-run, so mid-turn drain and batching are bypassed. `cancel_async_message` IS implemented in the CLI (`print.ts:3011`, `dequeueAllMatching` by uuid) — the refactor's "never implemented" rationale was wrong; see memory `daemon-owns-queued-messages`.

### Queued messages are NOT durable (verified 2026-06-12)

- A queued-but-not-yet-drained message exists **only in the CLI's memory**. The CLI logs `{type:"queue-operation", operation:"enqueue", content}` lines into the session JSONL (`sessionStorage.insertQueueOperation`), but these are **diagnostics only**: `--resume` explicitly filters them out (`QueryEngine.ts:441` "getLastSessionLog filters those out") and nothing re-enqueues them. CLI exit ⇒ undelivered queued messages are permanently lost.
- On the Mainframe side the queued bubble is a `createTransientMessage` (in-memory MessageCache, never in SQLite) and `queuedRefs` is an in-memory Map — both vanish on daemon restart / history reload from JSONL. Net effect: **reload drops queued messages from the UI and they will never be processed**. No reconciliation/re-send exists.
- A queued message that WAS drained **mid-turn** is persisted as a normal user JSONL entry whose text is `<system-reminder>The user sent a new message while you were working:\n<original>\n\nIMPORTANT: ...</system-reminder>` (`wrapCommandText` + `wrapMessagesInSystemReminder`), with `uuid = source_uuid` and **no isMeta** in current source (older CLIs hardcoded `isMeta:true`, which Mainframe's `history.ts` isMeta filter would drop). So on reload it reappears as the wrapped text, not the clean original.
- Queued messages drained **between turns** are batched (`joinPromptValues`) — JSONL gets ONE merged user entry, so N queued bubbles collapse into one on reload.

## Common Pitfalls

- **Logging at debug/trace level**: Dev daemon default is INFO. Use `log.warn` for temporary debug output.
- **Assuming stream-json matches JSONL**: Always verify field names empirically.
- **Forgetting nested object casing**: Top-level key might exist but inner fields may differ (e.g. `tool_use_result.oldString` vs `toolUseResult.oldString`).
- **Trusting docs over binary**: Protocol docs may be incomplete or outdated. When in doubt, verify against the binary source (see [`cli-binary-internals.md`](cli-binary-internals.md)).
- **Minified names are version-specific**: Search by behavior patterns (string literals, field names) not by minified function names.
