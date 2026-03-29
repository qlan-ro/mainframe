---
name: codex-protocol-debugger
description: Use when investigating Codex app-server protocol behavior — event shape mismatches, missing fields, approval handling, or any question about what the app-server actually sends. Covers live event tracing, generated schema verification, and daemon log analysis.
---

# Codex Protocol Debugger

## Overview

The Codex CLI communicates via JSON-RPC 2.0 over stdio using `codex app-server`. This skill covers three debugging techniques:

1. **Live event tracing** — intercept raw JSON-RPC messages to see exact shapes
2. **Generated schema verification** — use the CLI's built-in type generator as source of truth
3. **Daemon log analysis** — inspect approval and event handling in Mainframe logs

## When to Use

- Codex adapter sends messages but UI shows "Thinking..." forever (turn never completes)
- Fields are undefined or have wrong types at runtime
- Approval requests aren't reaching the UI or responses aren't sent back
- Types in `packages/core/src/plugins/builtin/codex/types.ts` don't match actual protocol
- Need to verify what the app-server actually sends for a notification or response

## Technique 1: Live Event Tracing

Spawn `codex app-server` and log every message. This is the fastest way to discover actual response shapes.

```bash
node -e "
const { spawn } = require('child_process');
const child = spawn('codex', ['app-server'], { stdio: ['pipe','pipe','pipe'] });
let buf = '';
let threadId = null;

child.stdout.on('data', d => {
  buf += d.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method) {
      console.log('NOTIF:', msg.method, JSON.stringify(msg.params).slice(0,300));
    } else {
      console.log('RESP id=' + msg.id, JSON.stringify(msg.result || msg.error).slice(0,300));
      if (msg.id === 2 && msg.result) {
        threadId = msg.result.thread.id;
        // Start turn after getting thread ID
        child.stdin.write(JSON.stringify({
          id: 3, method: 'turn/start',
          params: { threadId, input: [{ type: 'text', text: 'Say hello', text_elements: [] }] }
        }) + '\n');
      }
    }
  }
});
child.stderr.on('data', () => {});

// Handshake
child.stdin.write(JSON.stringify({
  id: 1, method: 'initialize',
  params: { clientInfo: { name: 'debug', title: 'Debug', version: '1.0.0' }, capabilities: { experimentalApi: true } }
}) + '\n');

setTimeout(() => {
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  child.stdin.write(JSON.stringify({
    id: 2, method: 'thread/start',
    params: { cwd: '/tmp', approvalPolicy: 'never', sandbox: 'danger-full-access', experimentalRawEvents: false, persistExtendedHistory: false }
  }) + '\n');
}, 300);

setTimeout(() => { child.kill(); process.exit(0); }, 20000);
" 2>/dev/null
```

### What to look for

- **Response shapes** differ from docs. Always check the real `id=N` response before writing types.
- **Notification names** — the app-server sends both `codex/event/*` (legacy) and v2 notifications (`item/completed`, `turn/completed`). Use v2 only.
- **`params` is always required** — omitting `params` from a request causes `"missing field params"` error. Send `params: {}` for no-arg methods.

### Key protocol quirks discovered

| Expectation | Reality |
|---|---|
| `model/list` returns `{ models: [...] }` | Returns `{ data: [...] }` with `displayName` not `name` |
| `turn/completed` has `usage` field | Usage comes from `thread/tokenUsage/updated` notification |
| `Turn.status` uses `'running'` | Uses `'inProgress'` |
| `reasoning` item has `text: string` | Has `summary: string[]` and `content: string[]` |
| `commandExecution` uses snake_case | Uses camelCase: `aggregatedOutput`, `exitCode` |
| `mcpToolCall.result` is a string | Is `{ content: unknown[], structuredContent: unknown }` |
| `mcpToolCall.error` is a string | Is `{ message: string }` |
| `ThreadStartParams` has optional fields only | `experimentalRawEvents` and `persistExtendedHistory` are **required** booleans |
| `thread/list` returns `{ threads: [...] }` | Returns `{ data: [...] }` |
| `Thread.createdAt` is ISO string | Is unix timestamp (seconds as number) |

## Technique 2: Generated Schema Verification

The Codex CLI can generate exact TypeScript types from the running binary. This is the authoritative source of truth — always prefer it over documentation.

```bash
# Generate TypeScript types
mkdir -p /tmp/codex-schema
codex app-server generate-ts --out /tmp/codex-schema

# Include experimental API types
codex app-server generate-ts --out /tmp/codex-schema --experimental

# Generate JSON Schema instead
codex app-server generate-json-schema --out /tmp/codex-schema
```

### Finding the right type

The v2 types (current protocol) are in `/tmp/codex-schema/v2/`. Root-level types are legacy.

```bash
# Master method-to-type mapping
cat /tmp/codex-schema/v2/ClientRequest.ts    # All client→server methods
cat /tmp/codex-schema/v2/ServerNotification.ts  # All server→client notifications
cat /tmp/codex-schema/v2/ServerRequest.ts    # Server-initiated requests (approvals)

# Find a specific type
ls /tmp/codex-schema/v2/ | grep -i "ThreadItem\|TurnStart\|Model"

# Read the full type
cat /tmp/codex-schema/v2/ThreadItem.ts
```

### Two protocol versions coexist

| Feature | Root (legacy) | v2 (current) |
|---|---|---|
| Case style | snake_case / kebab-case | camelCase |
| SandboxPolicy types | `"danger-full-access"` | `"dangerFullAccess"` |
| Item events | `codex/event/item_completed` | `item/completed` |
| ThreadItem variants | PascalCase `"AgentMessage"` | camelCase `"agentMessage"` |

Always use v2 types for the `thread/*`, `turn/*`, `item/*` methods.

### Inconsistencies within v2

Some v2 types still use snake_case internally:

- `CollaborationMode.settings` has `reasoning_effort` and `developer_instructions` (snake_case)
- `UserInput` text variant has `text_elements` (snake_case)

When in doubt, check the generated schema.

## Technique 3: Daemon Log Analysis

### Codex adapter logs

```bash
# All codex-related warnings/errors
grep '"codex:' ~/.mainframe/logs/server.$(date +%Y-%m-%d).log | grep -E '"WARN"|"ERROR"'

# Approval request/response flow
grep 'codex approval' ~/.mainframe/logs/server.$(date +%Y-%m-%d).log

# JSON-RPC errors
grep 'jsonrpc.*malformed\|jsonrpc.*error' ~/.mainframe/logs/server.$(date +%Y-%m-%d).log

# Unhandled notifications (what are we missing?)
grep 'unhandled notification' ~/.mainframe/logs/server.$(date +%Y-%m-%d).log
```

### Add debug logging to adapter

Entry point: `packages/core/src/plugins/builtin/codex/event-mapper.ts`

```typescript
// In handleNotification, log raw params for specific methods
log.warn({ method, params: JSON.stringify(params).slice(0, 500) }, 'DEBUG codex notification');
```

Entry point for JSON-RPC: `packages/core/src/plugins/builtin/codex/jsonrpc.ts`

```typescript
// In handleStdout, log raw lines before parsing
log.warn({ line: line.slice(0, 300) }, 'DEBUG raw jsonrpc line');
```

Remove all debug logging before committing.

## Event Pipeline Reference

```
codex app-server (child process)
  -> jsonrpc.ts: line-buffered JSONL on stdout
    -> dispatch() classifies by message shape:
       has id + result     -> resolve pending request promise
       has id + error      -> reject pending request promise
       has id + method     -> server request (approval) -> onRequest handler
       has method (no id)  -> notification -> onNotification handler
  -> event-mapper.ts: handleNotification() dispatches by method
    -> thread/started           -> sink.onInit(threadId)
    -> item/completed           -> sink.onMessage / sink.onToolResult
    -> thread/tokenUsage/updated -> store in state.lastUsage
    -> turn/completed           -> sink.onResult (uses stored lastUsage)
  -> approval-handler.ts: handleRequest() for approval methods
    -> item/commandExecution/requestApproval -> sink.onPermission
    -> item/fileChange/requestApproval      -> sink.onPermission
```

## Common Pitfalls

- **Trusting docs over generated schema**: The official docs describe intent, but the generated types from `codex app-server generate-ts` show what actually ships. When they disagree, the generated types win.
- **Assuming response shapes match docs**: Always trace a real response before writing types (Technique 1).
- **Missing required fields**: `ThreadStartParams` silently fails or returns cryptic errors when `experimentalRawEvents` or `persistExtendedHistory` are omitted.
- **Confusing legacy and v2 events**: `codex/event/item_completed` (legacy, PascalCase item types) and `item/completed` (v2, camelCase) both fire. Use v2 only and silence legacy.
- **Omitting `params` from requests**: Unlike standard JSON-RPC, the Codex app-server requires `params` even for no-arg methods. Send `params: {}`.
