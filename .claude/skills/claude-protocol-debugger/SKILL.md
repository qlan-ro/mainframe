---
name: claude-protocol-debugger
description: Use when investigating Claude CLI protocol behavior — stream-json event mismatches, permission handling, control_request/response fields, or any question about what the CLI actually does internally. Covers live event debugging, JSONL history comparison, and binary reverse-engineering.
---

# Claude Protocol Debugger

## Overview

The Claude CLI communicates via a JSON-RPC-like protocol over stdio. This skill covers three debugging techniques:

1. **Live event inspection** — debug mismatches between stream-json events and JSONL history
2. **Daemon log analysis** — inspect control_request/response payloads as logged by the daemon
3. **Binary reverse-engineering** — read the CLI's minified JS source to verify protocol behavior

## When to Use

- Feature works after daemon restart (history path) but not during live sessions
- Fields are missing or named differently in live mode vs JSONL
- Permission responses aren't being persisted or honored
- Need to verify what the CLI actually does with a protocol field
- Investigating undocumented CLI behavior or protocol edge cases

## Technique 1: Live Event Inspection

### Key Insight: snake_case vs camelCase

Stream-json (live) uses **snake_case**. JSONL (history) uses **camelCase**.

| Stream-JSON (live) | JSONL (history) |
|---------------------|-----------------|
| `tool_use_result` | `toolUseResult` |
| `request_id` | `requestId` |
| `tool_use_id` | `toolUseId` |
| `tool_name` | `toolName` |
| `permission_suggestions` | `permissionSuggestions` |

Always check both casings when reading event fields.

### Add debug logging

The entry point is `packages/core/src/plugins/builtin/claude/events.ts`. Each event type has a handler: `handleAssistantEvent`, `handleUserEvent`, `handleControlRequestEvent`, `handleResultEvent`.

Add `log.warn` (not debug/trace — dev daemon default is INFO) with:
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

### Trigger and read logs

The dev daemon (`tsx watch`) auto-restarts on file changes. Trigger the action in the dev app (port 31416).

```bash
# Dev app logs
grep "DEBUG" ~/.mainframe_dev/logs/server.$(date +%Y-%m-%d).log | tail -5

# Production app logs
grep "DEBUG" ~/.mainframe/logs/server.$(date +%Y-%m-%d).log | tail -5
```

Remove all debug logging before committing.

## Technique 2: Daemon Log Analysis

The daemon logs every `control_response` payload at INFO level in `session.ts:respondToPermission`. Extract and analyze them:

```bash
# See all permission responses sent today
grep "writing permission response" ~/.mainframe/logs/server.$(date +%Y-%m-%d).log

# Extract structured data from payloads
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

## Technique 3: Binary Reverse-Engineering

The Claude CLI binary is a bundled Node.js SEA (Single Executable Application) with **readable minified JS** embedded in it. Use this when docs are incomplete or you need to verify what the CLI actually does with a protocol field.

### Locate the binary

```bash
# Find the CLI version and binary
claude --version  # e.g. 2.1.83
ls ~/.local/share/claude/versions/
# Binary is at: ~/.local/share/claude/versions/<version>/claude
```

### Extract and search the JS source

The binary contains minified JS that can be searched with grep/ripgrep:

```bash
CLI_BIN=~/.local/share/claude/versions/$(claude --version | head -1)/claude

# Search for a specific function or field name
strings "$CLI_BIN" | grep -i "updatedPermissions" | head -20

# Search for specific protocol handling
strings "$CLI_BIN" | grep -i "addRules" | head -20

# Extract larger JS chunks around a match
strings "$CLI_BIN" | grep -B2 -A5 "persistPermissions" | head -30
```

### Trace execution chains

When you find a function, trace its callers and callees through the minified source:

```bash
# Find the function that processes permission updates
strings "$CLI_BIN" | grep "updatedPermissions" | grep "function\|=>"

# Check what destinations are considered "permanent" (written to disk)
strings "$CLI_BIN" | grep "localSettings\|userSettings\|projectSettings" | grep "function\|return"
```

### Known internal structure (v2.1.83)

Key functions discovered via reverse-engineering:

| Minified name | Purpose |
|---------------|---------|
| `Nu(updates)` | Iterates `updatedPermissions`, calls `Rc()` per update |
| `Rc(update)` | Routes by `update.type` (`addRules`, `setMode`, etc.) after checking `e_8(destination)` |
| `e_8(dest)` | Returns `true` for `localSettings`, `projectSettings`, `userSettings`; `false` for `session`, `cliArg` |
| `du6({rules, behavior}, dest)` | Merges rules into settings, calls `f8()` to write |
| `f8(dest, settings)` | Resolves path via `Vj()` and writes settings JSON to disk |
| `Vj(dest)` | Maps destination to file path (e.g. `localSettings` -> `.claude/settings.local.json`) |

**Note:** Minified names change between CLI versions. Search by behavior, not name.

### Example: verifying permission persistence

This chain was traced to confirm that `addRules` with `destination: "localSettings"` writes to `.claude/settings.local.json`:

```
control_response (stdin)
  -> onResponse handler checks updatedPermissions
  -> persistPermissions(updatedPermissions)
  -> Nu(updates): iterates each update
  -> Rc(update): checks e_8(destination)
     - "session" -> e_8 returns false -> skip (in-memory only)
     - "localSettings" -> e_8 returns true -> proceed
  -> du6({rules, behavior}, destination): merge into settings
  -> f8(destination, merged): write to .claude/settings.local.json
```

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
- **Forgetting nested object casing**: Top-level key might exist but inner fields may differ (e.g. `tool_use_result.oldString` vs `toolUseResult.oldString`).
- **Trusting docs over binary**: Protocol docs may be incomplete or outdated. When in doubt, verify against the binary source.
- **Minified names are version-specific**: Search by behavior patterns (string literals, field names) not by minified function names.
