---
name: debugging-live-events
description: Use when investigating mismatches between live stream-json events and JSONL history, missing event fields, permission issues, or unexpected behavior in the Claude adapter event pipeline. Also use when session features work after daemon restart but not during live sessions.
---

# Debugging Live Stream-JSON Events

## Overview

The Claude CLI emits events via `--output-format stream-json` (live) and writes them to JSONL files on disk (history). These two formats can differ in key naming and field availability. This skill shows how to inspect raw event data to find mismatches.

## When to Use

- Feature works after daemon restart (history path) but not during live sessions
- `modifiedFile`, `originalFile`, `structuredPatch` or other fields are missing in live mode
- Permission responses aren't being persisted or honored
- Any suspicion that stream-json event shape differs from JSONL entries

## Key Insight: snake_case vs camelCase

Stream-json uses **snake_case** keys. JSONL history uses **camelCase**.

| Stream-JSON (live) | JSONL (history) |
|---------------------|-----------------|
| `tool_use_result` | `toolUseResult` |
| `request_id` | `requestId` |
| `tool_use_id` | `toolUseId` |
| `tool_name` | `toolName` |
| `permission_suggestions` | `permissionSuggestions` |

Always check both casings when reading event fields.

## Technique

### 1. Add debug logging to the event handler

The entry point is `packages/core/src/plugins/builtin/claude/events.ts`. Each event type has a handler: `handleAssistantEvent`, `handleUserEvent`, `handleControlRequestEvent`, `handleResultEvent`.

Add `log.warn` (not debug/trace, so it appears in default log level) with:
- `Object.keys(event)` or `Object.keys(subObject)` to discover available fields
- The raw values of fields you're investigating (truncated with `.slice(0, 200)`)
- Both snake_case and camelCase variants to confirm which one has data

```typescript
// Example: inspecting user event for tool_result data
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

### 2. Trigger the event

The dev daemon (`tsx watch`) auto-restarts on file changes. Trigger the relevant action in the dev app (port 31416).

### 3. Read the logs

```bash
# Dev app logs
grep "DEBUG" ~/.mainframe_dev/logs/server.$(date +%Y-%m-%d).log | tail -5

# Production app logs
grep "DEBUG" ~/.mainframe/logs/server.$(date +%Y-%m-%d).log | tail -5
```

### 4. Clean up

Remove all debug logging before committing.

## Event Pipeline Reference

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

## Common Pitfalls

- **Logging at debug/trace level**: Dev daemon default is INFO. Use `log.warn` for temporary debug output.
- **Assuming stream-json matches JSONL**: Always verify field names empirically.
- **Forgetting to check nested objects**: The top-level event key might exist but inner fields may also differ in casing (e.g. `tool_use_result.oldString` vs `toolUseResult.oldString`).
