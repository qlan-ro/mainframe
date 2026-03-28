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

## Common Pitfalls

- **Logging at debug/trace level**: Dev daemon default is INFO. Use `log.warn` for temporary debug output.
- **Assuming stream-json matches JSONL**: Always verify field names empirically.
- **Forgetting nested object casing**: Top-level key might exist but inner fields may differ (e.g. `tool_use_result.oldString` vs `toolUseResult.oldString`).
- **Trusting docs over binary**: Protocol docs may be incomplete or outdated. When in doubt, verify against the binary source (see [`cli-binary-internals.md`](cli-binary-internals.md)).
- **Minified names are version-specific**: Search by behavior patterns (string literals, field names) not by minified function names.
