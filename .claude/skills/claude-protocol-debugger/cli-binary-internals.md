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

### Terminal Escape is NOT Affected

The Ink terminal UI handles Escape via a keypress listener (`sK8` function) that calls `onCancel` (`PYH`), which calls `ZT?.abort("user-cancel")` directly on the AbortController — an in-process call that bypasses the message loop entirely.

### SIGINT Workaround

The print-mode message loop runner (`DvK`) registers a SIGINT handler:

```js
let G = () => {
    i_("info", "shutdown_signal", { signal: "SIGINT" });
    if (X && !X.signal.aborted) X.abort();
    W9(0);  // process.exit(0) with cleanup
};
process.on("SIGINT", G);
```

This calls `X.abort()` on the current turn's AbortController — same effect as Escape — then exits. Since SIGINT is delivered as an OS signal, it fires even while the agent-wait loop blocks the message loop.

**Mainframe fix:** Send `child.kill('SIGINT')` in addition to the stdin `control_request` interrupt. The stdin path handles normal cases; SIGINT is the fallback for the blocked-by-agents case. The CLI exits after SIGINT, which the daemon handles as a normal session end.

### Three Interrupt Paths Summary

| Path | Mechanism | Blocked by agent-wait? | Process survives? |
|------|-----------|----------------------|-------------------|
| Terminal (Escape) | `ZT?.abort("user-cancel")` in Ink keypress | No — in-process | Yes |
| WebSocket bridge | `onInterrupt` callback via WS | No — async handler | Yes |
| Stdio (Mainframe) | `control_request` on stdin | **Yes** — loop blocked | Yes (if read) |
| SIGINT (workaround) | OS signal → `X.abort()` | **No** — signal handler | No (exits) |

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
| `"tengu_cancel"` | Telemetry event for cancel actions (escape, kill_agents, interrupt_on_submit) |
| `"user-cancel"` | Abort reason passed to AbortController from Escape/cancel |
| `"shutdown_signal"` | Log event for SIGINT/SIGTERM/SIGHUP handlers |
| `"chat:cancel"` | Keybinding action for Escape key in Chat context |
| `"app:interrupt"` | Keybinding action for Ctrl+C (global interrupt) |

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

## Effort Levels & ultracode (verified in v2.1.156 binary + live probe)

The `initialize` control_response advertises effort capability **per model**, and
the set of levels is **model-specific** — do not hardcode it.

### Live `initialize` response (v2.1.156)

Each entry in `response.response.models[]` now carries:

```jsonc
{
  "value": "default",
  "displayName": "Default (recommended)",
  "description": "Opus 4.8 with 1M context · Most capable for complex work",
  "supportsEffort": true,
  "supportedEffortLevels": ["low", "medium", "high", "xhigh", "max"],  // <-- the inference source
  "supportsAdaptiveThinking": true,
  "supportsFastMode": true,
  "supportsAutoMode": true
}
```

Per-model variance observed live (this is *why* a hardcoded list is wrong):

| Model | supportedEffortLevels |
|-------|-----------------------|
| `default` (Opus 4.8 1M) | low, medium, high, **xhigh**, **max** |
| `sonnet` / `sonnet[1m]` (4.6) | low, medium, high, **max** (NO xhigh) |
| `haiku` (4.5) | *(no `supportsEffort`, no array)* |

### Canonical effort enum (binary)

The runtime enum is `nN=["low","medium","high","xhigh","max"]`. Confirmed in three Zod schemas:
- `supportedEffortLevels: z.array(z.enum(["low","medium","high","xhigh","max"]))`
- agent config: `effort: z.union([z.enum([...]), z.number().int()])` — **effort may also be a raw integer**
- applied config: `effort: z.enum([...]).nullable(), ultracode: z.boolean()`

### "ultracode" is NOT an effort level — it's a session flag

Binary string: *"Enable ultracode for the session: **xhigh effort plus standing
dynamic-workflow orchestration**."* and *"ultracode · xhigh effort + dynamic
workflows for maximum thoroughness."*

Resolution order (function `z67`):
```js
let _ = hx(H.cli.effort);              // explicit --effort wins
if (_ !== void 0) return _;
if (H.settings.ultracode === true) return "xhigh";  // ultracode => xhigh effort
return BjH(H.settings.effortLevel...); // persisted settings default
```

So `ultracode` is a boolean in `settings` (alongside `effortLevel`, `fastMode`,
`alwaysThinkingEnabled`). It is *not* a value you pass to `--effort`; it desugars
to `xhigh` effort + turns on the standing dynamic-workflow orchestration behavior.
The new high tiers reachable via `--effort` are `xhigh` and `max`.

### Effort permission-layer masking (why `apply_flag_settings` effort + `--effort` don't mix)

Surprising and important for any runtime effort control:

- The per-turn effective effort is computed by `kz(H)`:
  ```js
  function kz(H){ let _=H.getAppState().effortValue, q=H.permissionLayers;
    if(!q) return _; for(let K of q) if(K.kind==="effort") _=K.effort; return _ }
  ```
  i.e. `effortValue` from app state, **overridden by the last `{kind:"effort"}`
  permission layer** if any exist. Every API query reads `effortValue: kz(_)`.
- `--effort <x>` at spawn installs a persistent `{kind:"effort", effort:x}` permission
  layer (`f3.permissionLayers=[...,{kind:"effort",effort:Y9}]` at query-context load).
- `apply_flag_settings{effortLevel}` only mutates `effortValue` (`{...X6,effortValue:X_}`)
  — it does **not** touch permission layers. So if `--effort` installed a layer, every
  later `apply_flag_settings` effort change is **masked** by that layer and silently
  ignored. Same for `ultracode:true` (sets `effortValue:"xhigh"` via `hi3`) — masked.
- There is **no `set_effort` control request**. The only runtime `set_*` controls are
  `set_model`, `set_permission_mode`, `set_max_thinking_tokens`.
- The CLI's own mid-session effort mechanism is the **`/effort <level>` slash command**
  (and the model menu's ultracode pick), which push a *new* last-wins `{kind:"effort"}`
  layer — not `apply_flag_settings`.

**Consequence for Mainframe:** to control effort at runtime via `apply_flag_settings`,
do **not** pass `--effort` at spawn (no layer → `effortValue` is the sole source of
truth, mutable at startup and mid-session). Mixing the flag with `apply_flag_settings`
breaks mid-session changes.

**Mainframe status (since #378):** `probe-models.ts` consumes `supportedEffortLevels` into
`AdapterModel.supportedEfforts`, and the daemon applies effort at runtime via
`apply_flag_settings{effortLevel}` — never `--effort` at spawn, so the permission-layer
masking above never triggers. `clampEffortToSupported()` clamps a requested effort to
each model's own `supportedEfforts` (falling back to its default), so a model without
`xhigh` (e.g. Sonnet) is never offered it.

## Model/Harness Config Flags — full inventory (v2.1.156)

Per-model capability flags arrive in the `initialize` response. Application is
split between **spawn flags** and the **`apply_flag_settings` control request**
(the generic runtime settings push — merges an arbitrary settings object, then
specially handles `model`/`effortLevel`/`ultracode` into app state).

| Knob | Model capability field | Meaning (binary string) | Applied via | Spawn flag? |
|------|------------------------|--------------------------|-------------|-------------|
| effort | `supportsEffort` + `supportedEffortLevels[]` | reasoning depth low→max | `--effort` **or** `apply_flag_settings{effortLevel}` | `--effort` ✅ |
| ultracode | *(none — session flag)* | "xhigh effort + standing dynamic-workflow orchestration" | `apply_flag_settings{ultracode}` only | ❌ |
| fast mode | `supportsFastMode` | "faster output, paid subscription / usage credits required; uses Opus" | `apply_flag_settings{fastMode}` only | ❌ |
| adaptive thinking | `supportsAdaptiveThinking` | "Claude decides dynamically when & how much to think; recommended for 4.6+" | `--thinking` / `apply_flag_settings{alwaysThinkingEnabled}` | `--thinking`, `--thinking-display` ✅ |
| auto (permission) | `supportsAutoMode` | "Auto mode — Claude handles permission prompts, classifies risk/injection" — a **permission mode**, not a model knob | `set_permission_mode` / `--permission-mode` | via permission-mode |
| fallback model | — | model to fall back to | `--fallback-model` | ✅ |
| auto-compact | — | context auto-compaction window | `--autocompact` / settings `autoCompactWindow` | ✅ |

Settings keys seen together in the flag-settings struct: `alwaysThinkingEnabled`,
`effortLevel`, `ultracode`, `autoCompactWindow`, `advisorModel`, `fastMode`,
`fastModePerSessionOptIn`. There is **no `--fast` or `--ultracode` spawn flag** —
both are reachable only through `apply_flag_settings`.

**Mainframe status:** spawns with `--model`, `--effort`, `--permission-mode` only.
It probes `supportsEffort/supportsFastMode/supportsAutoMode` but **drops
`supportedEffortLevels` and `supportsAdaptiveThinking`**, has **no
`apply_flag_settings` path at all**, and exposes only the EffortPicker in the
composer. So fast mode, ultracode, adaptive thinking, and the xhigh/max effort
tiers are all currently unreachable from the UI.

## Tools Added Post-Leak (verified in v2.1.118 binary)

The 2026-03-31 source leak does NOT include all tools shipping in current
binaries. Examples confirmed via binary string-extraction in v2.1.118:

### `ScheduleWakeup` (powers `/loop` dynamic mode)

- **Tool name constant**: `SCHEDULE_WAKEUP_TOOL_NAME = "ScheduleWakeup"` (mangled `Xj`)
- **Tool class**: `ScheduleWakeupTool` (mangled `vA5`, exported from module `H27`)
- **Constants module** exports: `SCHEDULE_WAKEUP_TOOL_NAME`, `PROMPT`, `DESCRIPTION`, `AUTONOMOUS_LOOP_SENTINEL`, `AUTONOMOUS_LOOP_DYNAMIC_SENTINEL`
- **Schema** (Zod `strictObject`):
  - `delaySeconds: z.number().describe("Seconds from now to wake up. Clamped to [60, 3600] by the runtime.")`
  - `reason: z.string().describe("One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific.")`
  - `prompt: z.string().describe("The /loop input to fire on wake-up...")`
- **Sentinels**:
  - `<<autonomous-loop>>` — for CronCreate-based autonomous loops
  - `<<autonomous-loop-dynamic>>` — for ScheduleWakeup-based dynamic loops
- **Registration**: in default toolset alongside `CronCreateTool`/`CronDeleteTool`/`CronListTool`/`RemoteTriggerTool`/`MonitorTool`/`PushNotificationTool`

**Lesson**: when a tool is missing from the leaked source but appears in
sessions, search the installed binary (`~/.local/share/claude/versions/<v>`)
with Python `re.finditer` before assuming it's harness-injected.

## Background Task Events (live-probed v2.1.202, 2026-07-08)

Two stream-json probes (bg bash via `run_in_background`, bg subagent via Task
`run_in_background`) against v2.1.202. Contradicts both the 2026-03-31 leak and
the v2.1.85 findings above:

- **The `result` hold-back for background agents is REMOVED.** The main turn's
  `result` fires immediately (~1s after "started" text), while the bg agent is
  still running. In v2.1.85 / the leak, `result` was deferred in the agent wait
  loop until all bg agents/workflows finished. Bash was never held back.
- **All kinds emit the same bookends**: `system:task_started` (`task_id`,
  `task_type: "local_bash" | "local_agent" | ...`, `tool_use_id`, `description`)
  and `system:task_notification` (`status: completed|failed|stopped`,
  `output_file`, `summary`). Task ids keep the type prefix (`b…` bash, `a…` agent).
- **New `system:task_updated` event** (not in the leak): fires alongside
  `task_notification` with the task's status. Agents also emit
  `system:task_progress` (usage, last_tool_name) per tool-use.
- **Completion re-invokes a turn**: task_notification → a fresh `system:init`
  (subtype init, tools "connected") → drain-turn assistant message → a **second
  `result`**. Consumers must expect multiple init+result pairs per stdin message.
- **`session_state_changed` was NOT observed** in either probe despite existing
  in the leak's sdkEventQueue. Don't build on it without further verification.
- **Nested tasks surface at top level**: the bg subagent's own bash task emitted
  its own top-level `task_started`/`task_notification` (`task_type:"local_bash"`)
  with a distinct task_id, interleaved with the parent's `task_progress`.
- Consequence: the only reliable "background work still running" accounting is
  the live set `task_started` ids minus `task_notification` ids. Neither `result`
  nor `session_state_changed` can be trusted for it.

## Command / Skill / Agent Enumeration (v2.1.198)

Full method + the post-leak inventory it produced live in the (git-excluded) doc
`docs/adapters/claude/PREBUILT_PROMPTS_CATALOG.md` (§Methodology). Technique + traps:

### Extraction (Python `re.finditer` over bytes decoded `latin-1`)

| What | Pattern | 2.1.198 result |
|------|---------|----------------|
| Commands | `[,{]type:"(prompt\|local\|local-jsx)",name:"([\w-]+)"` (type-first; ~25 use `get description(){}` getters) | 90 distinct builtin command names |
| Agents | `agentType:"([a-z0-9_-]+)"` | 11: Explore, Plan, claude, general-purpose, main, main-session, statusline-setup, subagent, teammate, worker, workflow-subagent |
| Bundled skills | grep a known skill's description → read the minified registrar (`Qc({name,description,source:"bundled"})` in 2.1.198), enumerate its `name:` args | 25 (registrar name changes per version + is sometimes reused — verify matches) |

### Traps (each produced a wrong draft first)

- **Version drift mid-session.** `2.1.162` (used at the session start) was
  auto-pruned during the work; only `2.1.196/197/198` remained. Re-resolve `$BIN`
  every run; a conclusion tied to an exact version expires.
- **Filename diff over-reports "new".** `ls src/commands/` lists files/dirs, but
  commands nest/rename: `bridge/index.ts` → `name:'remote-control'`,
  `terminalSetup/` → `name:'terminal-setup'`, `review.ts` → `ultrareview`,
  `services/mcp/client.ts` → dynamic `mcp__…`. Diff on `grep -rn "name:'X'" src/`,
  not filenames. (Raw ls-diff said 32 new; real answer was 27.)
- **Runtime-served prompts.** `/team-onboarding`'s prompt is GrowthBook-served
  (`tengu_flint_harbor_prompt`) with a bundled fallback constant (`Puf`, 4677 chars);
  the binary literal is the *fallback*, not necessarily what runs.
- **Moved-to-plugin ≠ removed.** `commit`, `security-review`, `pr-comments`,
  `init-verifiers` are absent from the 90-command builtin scan because they're
  plugin-provided now; the prompt strings still exist in the binary.
- **False friends.** `name:"sharp"` is the npm image module (package.json), not a
  skill. The SEA duplicates each code section at two offsets. Classify from context.

### Post-leak command inventory (in 2.1.198, not in leaked source) — 27

Orchestration/autonomous: `workflows` ("Browse running and completed workflows"),
`fork`, `background` (alias `bg`), `goal`, `loops`, `daemon`, `stop`, `recap`.
Setup/util: `autocompact`, `usage-credits` (was `extra-usage`), `update`,
`setup-bedrock`, `setup-vertex`, `pause-memory` (was `toggle-memory`),
`reload-skills`, `tui`, `focus`, `scroll-speed`, `powerup`, `wellbeing`, `radio`,
`pro-trial-expired`, `cd`, `design`, `design-login`, `skill-doctor`.
Prompt: `team-onboarding`. New agentTypes: only `worker` + `workflow-subagent`
(others existed in source outside `built-in/`). New bundled skills include
`memory-types`, `code-review`, `dataviz`, `run`, `run-skill-generator`,
`design-sync`, `fewer-permission-prompts`, `claude-code-docs`. Removed since leak:
`lorem-ipsum`, `remember`, `skillify`, `stuck`.
