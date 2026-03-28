# Claude CLI Binary Internals (v2.1.85)

Reverse-engineered from `~/.local/share/claude/versions/2.1.85` on 2026-03-27.
Binary is a Mach-O arm64 SEA. The JS is duplicated at two offsets (each code section appears twice).

**Minified names change between versions.** Always search by string literals and behavior patterns, not by function names.

## Binary Search Technique

`strings` output is extremely noisy. Use Python with `re.finditer` on the raw binary for precise extraction:

```python
import re
with open(CLI_BIN, 'rb') as f:
    data = f.read()
pattern = b'case"interrupt"'
for m in re.finditer(pattern, data):
    start = max(0, m.start() - 300)
    end = min(len(data), m.end() + 500)
    chunk = data[start:end].decode('ascii', errors='replace')
    print(chunk)
```

This avoids the `strings | grep` approach which returns enormous lines of concatenated minified JS.

## Two Entry Points for Control Requests

The CLI has two distinct code paths for processing `control_request` messages:

### 1. Stdio Message Loop (used by Mainframe)

This is the path when CLI is launched with `--input-format stream-json --output-format stream-json --permission-prompt-tool stdio`.

**Class:** `mq_` — structured stdin/stdout IO handler.

- `read()`: async generator that parses NDJSON lines from stdin, yields parsed messages
- `processLine(H)`: handles `control_response`, `keep_alive`, `update_environment_variables` inline; other types yielded to the consumer
- `sendRequest(H, _, q)`: sends `control_request` to host (via stdout), awaits `control_response` on stdin
- `write(H)`: writes NDJSON to stdout

The consumer is a **main message loop** in `print.ts` (the CLI's headless/print mode entry point):

```js
for await (let zH of H.structuredInput) {
    if (zH.type === "control_request") {
        if (zH.request.subtype === "interrupt") {
            if (X) X.abort();
            Z.abortController?.abort();
            Z.abortController = null;
            Z.lastEmitted = null;
            Z.pendingSuggestion = null;
            jH(zH);  // sends success response
        }
        else if (zH.request.subtype === "end_session") { ... }
        else if (zH.request.subtype === "initialize") { ... }
        else if (zH.request.subtype === "set_permission_mode") { ... }
        else if (zH.request.subtype === "set_model") { ... }
        // ... other subtypes
    }
    // handle user messages, control_responses, etc.
}
```

**Key variable `X`:** The current turn's `AbortController`. Created fresh at the start of each API turn (`X = V4()`). Passed as `abortController: X` to the API call function (`kl9`). When `X.abort()` is called, it cancels the in-flight API request and tool execution.

### 2. REPL Bridge (used by remote control / WebSocket)

This is the path when CLI connects to a WebSocket server via `--sdk-url`.

**Function:** `ci_(H, _)` — handles control_requests from the remote bridge.

```js
function ci_(H, _) {
    let { transport: q, sessionId: $, outboundOnly: K,
          onInterrupt: O, onSetModel: T, ... } = _;
    switch (H.request.subtype) {
        case "interrupt":
            O?.();  // calls onInterrupt callback
            A = { type: "control_response", response: { subtype: "success", ... } };
            break;
        // ... other subtypes
    }
}
```

The `onInterrupt` callback is defined where the bridge is initialized:

```js
onInterrupt() { X?.abort() }
```

Same `X` abort controller, but accessed through a callback closure rather than directly in the message loop.

## Interrupt + Background Agents Bug (v2.1.85)

### The Problem

When background agents are running, the stdio interrupt is **silently ignored** because the message loop is blocked.

### Root Cause: Agent Wait Loop

After each API turn's tool execution completes, the CLI enters a polling loop that waits for background agents to finish **before** emitting the `result` event and **before** reading the next stdin message:

```js
// Inside the for-await message loop iteration, after the API turn:
do {
    j = "draining_commands";
    await VH();  // flush pending
    zH = false;
    {
        let CH = z();  // getAppState
        // Check if any agents are still running
        let bH = zV_(CH).some((NH) => lD(NH) && NH.type !== "in_process_teammate");
        let XH = fTH();  // check other conditions
        if (bH || XH) {
            zH = true;
            if (!XH) {
                j = "waiting_for_agents";
                await U9(100);  // sleep 100ms
            }
        }
    }
} while (zH);

// Only AFTER all agents finish:
if (J) {
    R.enqueue(J);  // emit the deferred result event
    J = null;
}
```

**Consequence:** The `for await(zH of H.structuredInput)` loop cannot advance to read the next stdin message (including `interrupt`) until the current iteration completes. The current iteration is stuck in the `do...while` agent-wait loop. The interrupt `control_request` sits unread in the stdin buffer.

### Why `result` is Deferred

The `result` event variable `J` is set during API turn processing but **not immediately enqueued to stdout**. It's held until after the agent wait loop. This means Mainframe's daemon sees `processState` stay as `working` (no `result` received yet) and shows the stop button, but clicking it does nothing because the CLI can't read the interrupt.

### REPL Bridge is NOT Affected

The REPL bridge handles interrupts via a separate WebSocket message handler that runs concurrently with the message loop. The `onInterrupt` callback can fire at any time, calling `X?.abort()` even while the agent wait loop is running. Only the stdio path has this blocking issue.

## Abort Controller Chain

```
Interrupt received (stdin or bridge)
  → X.abort()                          // current turn's AbortController
  → signal propagates to:
    → in-flight API request (cancelled)
    → tool execution (cancelled)
    → per-session abort signals in bridge mode
```

In bridge mode (`K48` function), there's a hierarchical abort chain:
- `T` = parent signal (from bridge interrupt)
- `w` = local AbortController, listens to `T`
- `D` = `w.signal`
- `v` = per-session AbortController (aborted on session exit, recreated)
- `h()` factory creates per-session signals listening to BOTH `D` and `v`

## Key String Literals for Searching

These appear in the binary and are stable across versions (search by these, not minified names):

| String | Context |
|--------|---------|
| `"waiting_for_agents"` | Agent wait loop state |
| `"cli_message_loop_started"` | Start of stdio message loop |
| `"bridge:repl"` | REPL bridge log prefix |
| `"bridge:sdk"` | SDK bridge log prefix |
| `"bridge:session"` | Session bridge log prefix |
| `"bridge:shutdown"` | Bridge shutdown log prefix |
| `case"interrupt"` | Interrupt handler (both paths) |
| `subtype==="interrupt"` | Stdio interrupt check |
| `onInterrupt` | Bridge interrupt callback |
| `"error_during_execution"` | Result subtype for interrupted/failed sessions |
| `"control_cancel_request"` | Sent when aborting a pending control_request |

## Permission Persistence (v2.1.83)

Traced to confirm how `updatedPermissions` in a `control_response` get written to disk.

### Call chain

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

### Key functions (v2.1.83 minified names)

| Minified name | Purpose |
|---------------|---------|
| `Nu(updates)` | Iterates `updatedPermissions`, calls `Rc()` per update |
| `Rc(update)` | Routes by `update.type` (`addRules`, `setMode`, etc.) after checking `e_8(destination)` |
| `e_8(dest)` | Returns `true` for `localSettings`, `projectSettings`, `userSettings`; `false` for `session`, `cliArg` |
| `du6({rules, behavior}, dest)` | Merges rules into settings, calls `f8()` to write |
| `f8(dest, settings)` | Resolves path via `Vj()` and writes settings JSON to disk |
| `Vj(dest)` | Maps destination to file path (e.g. `localSettings` -> `.claude/settings.local.json`) |

### Destination mapping

| `destination` value | `e_8()` result | Persisted? | File |
|---------------------|----------------|------------|------|
| `localSettings` | `true` | Yes | `.claude/settings.local.json` |
| `projectSettings` | `true` | Yes | `.claude/settings.json` |
| `userSettings` | `true` | Yes | `~/.claude/settings.json` |
| `session` | `false` | No | In-memory only |
| `cliArg` | `false` | No | In-memory only |

## Known Internal Structure (v2.1.85)

| Area | Key identifiers |
|------|----------------|
| Stdin IO class | `mq_` — has `read()`, `processLine()`, `sendRequest()`, `write()` |
| Bridge control handler | `ci_(H, _)` — switch on `H.request.subtype` |
| Session bridge | `K48(H, _, q, $, K, O, T, z, f, A)` — manages child sessions |
| AbortController factory | `V4()` — creates new AbortController |
| API turn execution | `kl9(...)` — accepts `abortController` param |
| Agent running check | `zV_(state).some((x) => lD(x))` — checks for active agents |
| Sleep utility | `U9(ms)` — Promise-based sleep |
| JSON serialize | `mH(obj)` — `JSON.stringify` |
| Log function | `N(msg)` — internal logger |
| Telemetry | `Q(event, data)` — sends telemetry events |
| Permission iterate | `Nu(updates)` — iterates `updatedPermissions` (v2.1.83) |
| Permission route | `Rc(update)` — routes by `update.type` after destination check (v2.1.83) |
| Destination check | `e_8(dest)` — returns `true` for persistent destinations (v2.1.83) |
| Settings write | `f8(dest, settings)` — writes settings JSON to disk (v2.1.83) |
