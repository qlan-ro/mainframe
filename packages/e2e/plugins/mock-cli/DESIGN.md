# E2E Mock CLI Plugin (v2)

Record real Claude CLI sessions once, replay them deterministically in CI. The E2E suite gains
three modes selected by `E2E_MODE`: unset (normal), `record` (capture fixtures from the real CLI),
and `mock` (replay fixtures through an external adapter plugin). This unblocks the AI-coupled E2E
specs — they can run in CI with no Claude API calls, cost, or nondeterminism.

This supersedes the 2026-03-28 spec on `spec/e2e-mock-cli-plugin` (222-line doc, never
implemented, 234 commits behind main). The architecture is the same; this version reconciles two
months of interface drift and replaces the brittle enumerated fixture format with a generic one.

## Goals

- Run the AI-coupled Playwright specs in CI without Claude API calls or costs.
- Exercise the plugin system with a real external plugin that registers an adapter.
- Keep production-code change to a single `E2E_MODE`-gated block.
- **First milestone:** prove the loop end-to-end on one real permission-flow spec.

## Non-Goals

- Recording fixtures for every AI spec now (incremental, after the loop is proven).
- Real-time timing fidelity (replay is instant unless a `delayMs` is recorded).
- Content-based matching of messages to responses (positional is sufficient — see Replay).
- Automatic re-recording when tests change (recording is a manual step).

## What changed since the 2026-03-28 spec (drift reconciliation)

Verified against `main` on 2026-05-31:

| Spec assumption | Reality on main | Consequence |
|-----------------|-----------------|-------------|
| Adapter interface `Adapter` | Exists at `packages/types/src/adapter.ts`; all spec methods present, plus optional `probeModels`, `createPlanModeHandler` | Mock adapter implements the small required set; optionals omitted. |
| `SessionSink` has 8 methods | Has **17** (`onInit`, `onMessage`, `onToolResult`, `onPermission`, `onResult`, `onExit`, `onError`, `onCompact`, `onCompactStart`, `onContextUsage`, `onPlanFile`, `onSkillFile`, `onQueuedProcessed`, `onTodoUpdate`, `onPrDetected`, `onCliMessage`, `onSkillLoaded`, `onSubagentChild`) | **Drove the format change to a generic proxy** (below) so growth never rots fixtures again. |
| `spawn(sink)` | Real signature: `spawn(options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess>` | RecordingSink injected at the `spawn` call; ReplaySession returns an `AdapterProcess`. |
| `onInit({sessionId, model})` | Real: `onInit(sessionId: string)` | Fixture args follow the real signatures (captured verbatim, so this is automatic). |
| Plugin system, `ctx.adapters.register()`, manifest `adapter` block, builtin Claude plugin, `adapterId` in `createTestChat` | All present as specced | No new plumbing needed for registration or adapter selection. |
| Recording/replay machinery | Absent | This is the work. |

## Architecture

### Mode toggle

| `E2E_MODE` | Adapter | Behavior |
|------------|---------|----------|
| unset | `claude` | Normal operation. Zero code path entered. |
| `record` | `claude` (wrapped) | Real CLI; tees every sink call to a fixture. |
| `mock` | `mock-cli` (plugin) | Replays the fixture; no real process. |

`E2E_RECORDINGS_DIR` (absolute path) is required whenever `E2E_MODE` is set; the harness points it
at `packages/e2e/fixtures/recordings/`.

### Components

```
packages/core/src/testing/
  recording-sink.ts          # createRecordingSink(realSink, filePath): SessionSink (Proxy)

packages/core/src/index.ts   # one E2E_MODE==='record' block wrapping claude createSession

packages/e2e/plugins/mock-cli/
  manifest.json              # id: "mock-cli", capabilities: ["adapters"], adapter block
  package.json               # name, build script (tsc/esbuild → dist CJS)
  tsconfig.json
  src/index.ts               # activate(ctx) → ctx.adapters.register(new MockCliAdapter())
  src/adapter.ts             # MockCliAdapter implements Adapter
  src/session.ts             # ReplaySession implements AdapterSession
  dist/                      # built CJS (gitignored; built on demand by the harness)

packages/e2e/fixtures/recordings/    # committed NDJSON fixtures
```

### Data flow

```
record:  test → daemon → claude createSession → spawn(options, RecordingSink(realSink, file))
                                                  │ forwards every call to realSink
                                                  └ appends {method,args,delayMs} to file

mock:    test → daemon → mock-cli plugin → MockCliAdapter.createSession()
                                            └ ReplaySession loads {project}.{index}.ndjson
                                               drains queued events through the sink per interaction
```

## Generic fixture format

NDJSON. Each line is either an **output** event (`dir:"out"` — a `SessionSink` call the daemon
emitted) or an **input** marker (`dir:"in"` — a session method the daemon *called*:
`sendMessage`/`respondToPermission`/`interrupt`). **The recorder does not enumerate method names** —
it records whatever was called. This is the core fix for the 8→17 drift.

The input markers are essential (see "Why input markers" below): they record the exact cadence of
daemon→session calls, so replay re-emits the right run of outputs after each one — without guessing
which output belongs to which interaction.

```jsonl
{"dir":"in","method":"sendMessage","args":["Create a file at /tmp/x"],"delayMs":0}
{"dir":"out","method":"onInit","args":["sess_abc"],"delayMs":40}
{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"I'll create that file."}]],"delayMs":120}
{"dir":"out","method":"onPermission","args":[{"requestId":"r1","toolName":"Write","input":{"path":"/tmp/x"}}],"delayMs":900}
{"dir":"in","method":"respondToPermission","args":[{"requestId":"r1","behavior":"deny"}],"delayMs":1500}
{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"Okay, cancelled."}]],"delayMs":1600}
{"dir":"out","method":"onResult","args":[{"total_cost_usd":0.01}],"delayMs":2000}
```

- `dir` — `"in"` (daemon called the session) or `"out"` (session called the sink).
- `method` — any session/sink method name.
- `args` — the exact arguments array passed (serialized as-is; non-JSON-able values reduced).
- `delayMs` — ms since session start when the call happened (`in` and `out` share one timeline).
  Replay fires each turn's outputs *relative to the `in` marker that preceded them* (not relative to
  the prior output), so recorded test/user think-time between turns is never replayed — only the
  intra-turn output spacing is.

### Why input markers

`ChatManager` spawns a session lazily on the first `sendMessage`, and Claude's `onInit` fires only
*after* the first API call — so there is no reliable output-only boundary between "startup", "first
user turn", and "permission response". Splitting replay on output types (e.g. "drain until
`onPermission`") desyncs: `spawn()` would consume the first turn's response before the test even
sends a message. Recording the `in` markers makes the split exact and content-agnostic.

Filenames: `{sanitized-recording-key}.{session-index}.ndjson`. The key comes from
`E2E_RECORDING_KEY` (not the project path — e2e project paths are random temp dirs, so they can't
key a fixture that must match across separate record and replay runs). A per-key counter increments
on each `createSession`, so multiple chats under one key map to `.0`, `.1`, … Both recorder and
replayer maintain this counter. The key is set per-describe via `launchApp({ recordingKey })`.

## Recording (`packages/core/src/testing/`)

`createRecordingSink(realSink, deps)` returns a `Proxy<SessionSink>`:

- `get(target, prop)`: returns a function that (1) writes `{dir:"out", method, args, delayMs}`, then
  (2) calls `realSink[prop](...args)`. Non-function props pass through.
- `delayMs` = `now() - sessionStart`. `deps.write`/`deps.now` are injected (file append + `Date.now`
  in the daemon; captured array + fake clock in tests).
- A serialization guard reduces non-JSON-able args (e.g. an `Error` in `onError` becomes
  `{name,message}`) so the file stays valid NDJSON.

### Daemon hook (`packages/core/src/index.ts` + `record-wrapper.ts`)

A single `E2E_MODE==='record'` block replaces the registered `claude` adapter with a recording Proxy.
The session Proxy does two things:

1. **`spawn(options, sink)`** — injects `createRecordingSink(sink, …)` so every output is teed.
2. **`sendMessage` / `respondToPermission` / `interrupt`** — writes a `{dir:"in", method, args,
   delayMs}` marker *before* delegating to the real method.

Both share one writer + clock per session. The fixture file is **truncated when the session is
created** (so re-recording overwrites cleanly — the per-key index resets to `0` each daemon run and
would otherwise append to the previous run's file). Nothing runs unless `E2E_MODE==='record'`, so
production is untouched.

## Replay (`packages/e2e/plugins/mock-cli/`)

### MockCliAdapter implements `Adapter`

- `id="mock-cli"`, `name="Mock CLI"`, `capabilities={planMode:true}`.
- `isInstalled()→true`, `getVersion()→"0.1.0"`, `listModels()→` static list mirroring Claude's.
- `createSession(options)→ new ReplaySession(options, recordingsDir, key, indexForKey(key))`.
- `killAll()→` no-op. Optional `Adapter` methods return `[]`/static values to satisfy the interface.

### ReplaySession implements `AdapterSession`

Loads `{key}.{index}.ndjson` on construction (throws a clear error naming the path if missing).
Holds the parsed event list and a cursor. Replay is **generic**: emit an event by
`sink[method](...args)`, honoring `delayMs` via `setTimeout`.

Splitting is driven by the `in` markers, never by output type:

| Method | Behavior |
|--------|----------|
| `spawn(options, sink)` | stores sink; **drains leading `out` events** (up to the first `in` marker — usually none, since Claude's `onInit` arrives after the first message). Returns a stub `AdapterProcess`. |
| `sendMessage()` | if exhausted → `onError`; else consume the next `in` marker, then drain the following run of `out` events (until the next `in` marker or end). |
| `respondToPermission()` | same as `sendMessage`. |
| `interrupt()` | same as `sendMessage` (the recorded `in` interrupt marker is followed by its result outputs). |

- **Positional matching only.** Nth daemon call → Nth recorded `in` marker + its outputs. Content is
  never inspected. E2E tests drive a fixed interaction order, so this is sufficient.
- **Exhausted before the test finishes** → emit `onError(new Error(...))` so Playwright fails fast
  with a clear desync message instead of waiting for a timeout.
- Replay is fully deterministic: the same fixture yields the same event sequence every run, so any
  conditional UI helper (e.g. `waitForPermissionCardHandlingPlan`) behaves identically each replay.
- Irrelevant methods (`setModel`, `setPermissionMode`, `setPlanMode`, `sendCommand`, `loadHistory`,
  `extractPlanFiles`, `extractSkillFiles`, `cancelQueuedMessage`, `stopBackgroundTask`) are no-ops /
  return empty values.

## E2E harness changes

### `fixtures/app.ts`
`launchApp({ recordingKey? })`. When `E2E_MODE` is set: pass `E2E_MODE`, `E2E_RECORDINGS_DIR`, and
(if provided) `E2E_RECORDING_KEY` into the spawned daemon's env. In **mock** mode also build the
plugin (esbuild → single CJS `index.js`) and **copy** `packages/e2e/plugins/mock-cli` into
`<testDataDir>/plugins/mock-cli` — the isolated data dir, never the real `~/.mainframe` (the daemon
now scans `getDataDir()/plugins`; see Production-code impact).

> **Copy, not symlink.** The daemon's plugin loader skips symlinked entries —
> `readdirSync(dir, { withFileTypes: true })` reports a symlinked directory as
> `isDirectory() === false`, so `loadAll()` never discovers it and the adapter is never registered.
> A real directory copy is required. (Supporting symlinked plugin dirs in the production loader is a
> possible future enhancement, but carries symlink-escape considerations and is out of scope here.)

### `fixtures/chat.ts`
`createTestChat` adapter id defaults to `mock-cli` when `E2E_MODE==='mock'`, else `claude`. The
`adapterId` parameter and its threading through `createChat` → ChatManager already exist.

### Spec files
A spec is **enrolled** for record/replay by giving its describe's `beforeAll` a
`launchApp({ recordingKey: '<stable-key>' })`; otherwise its body is unchanged (still
`sendMessage` / `waitForAIIdle` / `waitForPermissionCardHandlingPlan`). Non-enrolled specs are not
touched. **Mock mode is only meaningful for enrolled specs** — running an un-enrolled AI spec in
mock mode fails fast (the `ReplaySession` constructor throws "fixture not found"), so the
`test:mock` runs target enrolled specs explicitly rather than the whole suite.

## First milestone — the one proof

Target: **`06-permissions.spec.ts` → "§6 Permission system — Interactive"** (one session, three
tests). It exercises the full AI-coupled machinery: `sendMessage` → `onPermission` → `permission-card`
→ `respondToPermission` (deny, then allow-once, then deny again), multiple sequential interactions on
a single session.

Loop:
1. `E2E_MODE=record` run of the Interactive block against real Claude → commit the fixture.
2. `E2E_MODE=mock` run → the same block passes with no API call.
3. CI runs mock mode.

If Claude enters plan mode during recording, the plan events are captured and replay reproduces them
identically, so `waitForPermissionCardHandlingPlan` takes the same branch every replay. (If a
recording is messy, re-record — it's a manual step.)

## Production-code impact

Two changes in `packages/core/src/index.ts`:
1. One `E2E_MODE==='record'`-gated block (calls into the new `packages/core/src/testing/` module).
2. The user-plugin scan dir changes from a hardcoded `~/.mainframe/plugins` to `getDataDir()/plugins`
   — behavior-neutral in production (`getDataDir()` defaults to `~/.mainframe`), and it aligns with
   the todos builtin already using `getDataDir()`. This is what lets the harness load the plugin
   from the isolated test data dir. Tracked with a core `patch` changeset.

The `packages/core/src/testing/` module is only imported from the record block.

## Testing

- **Unit (core):** `recording-sink` records `{dir:"out",method,args,delayMs}` and forwards to the
  real sink; delay math; non-serializable-arg guard. `replay-core` split logic: `drainOutputs` stops
  at the next `in` marker; `consumeInput` skips one `in` marker; `isExhausted`.
- **Integration (the proof):** recorded `06-permissions` Interactive block replays green in mock mode
  (covers `spawn`/`sendMessage`/`respondToPermission` splitting and exhaustion `onError` end-to-end).

## Edge cases

- Multiple sessions per project → per-project session-index in the filename.
- Delayed/loading states → `delayMs` per event.
- Missing fixture in mock mode → throw naming the expected path.
- Queue exhausted early → `onError`.
- Recording interrupted mid-test → partial file; re-record that spec.
- Non-JSON args (Errors, circular) → reduced to a safe shape by the recorder's guard.

## Rollout

1. Land infra + the one recorded proof (this milestone).
2. Tag AI-coupled specs and record their fixtures incrementally (follow-up).
3. CI job runs the suite in `mock` mode; `record` stays a local manual step.
