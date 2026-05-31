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

NDJSON, one object per recorded `SessionSink` call. **The recorder does not know the method names** —
it records whatever was called. This is the core fix for the 8→17 drift.

```jsonl
{"method":"onInit","args":["sess_abc"],"delayMs":0}
{"method":"onMessage","args":[[{"type":"text","text":"I'll create that file."}]],"delayMs":120}
{"method":"onPermission","args":[{"requestId":"r1","toolName":"Write","input":{"path":"/tmp/x"}}],"delayMs":900}
{"method":"onToolResult","args":[[{"type":"tool_result","content":"ok"}]],"delayMs":40}
{"method":"onResult","args":[{"cost":0.01,"durationMs":5200}],"delayMs":2000}
```

- `method` — any `SessionSink` method name.
- `args` — the exact arguments array passed (serialized as-is).
- `delayMs` — ms since session start when the call happened; replay waits this long *relative to the
  previous event* before emitting (so loading/intermediate states render).

Filenames: `{sanitized-project-path}.{session-index}.ndjson`. Path is sanitized (separators/special
chars → `-`, collapse repeats, trim). A per-project counter increments on each `createSession`, so
multiple chats on one project key to `.0`, `.1`, … Both recorder and replayer maintain this counter.

## Recording (`packages/core/src/testing/recording-sink.ts`)

`createRecordingSink(realSink, filePath)` returns a `Proxy<SessionSink>`:

- `get(target, prop)`: returns a function that (1) appends `{method: prop, args, delayMs}` to
  `filePath`, then (2) calls `realSink[prop](...args)`. Non-function props pass through.
- `delayMs` = `now - sessionStart` captured at first call; relative deltas computed on write.
- Writes are append-only (one line per call). A serialization guard reduces non-JSON-able args
  (e.g. an `Error` in `onError` becomes `{name,message}`) and logs a warning, so the file stays
  valid NDJSON.

### Daemon hook (`packages/core/src/index.ts`)

A single block, after the Claude builtin registers and before user plugins load:

```ts
if (process.env.E2E_MODE === 'record') {
  const dir = requireEnv('E2E_RECORDINGS_DIR');
  wrapCreateSessionForRecording(adapters.get('claude'), dir); // Proxy createSession → inject sink at spawn
}
```

`wrapCreateSessionForRecording` returns a `Proxy` over the adapter whose `createSession` returns a
`Proxy` over the session whose `spawn(options, sink)` is called with `createRecordingSink(sink, file)`.
The file path is derived from the session's `projectPath` + per-project index. Nothing runs unless
`E2E_MODE==='record'`, so production is untouched.

## Replay (`packages/e2e/plugins/mock-cli/`)

### MockCliAdapter implements `Adapter`

- `id="mock-cli"`, `name="Mock CLI"`, `capabilities={planMode:true}`.
- `isInstalled()→true`, `getVersion()→"0.1.0"`, `listModels()→` static list mirroring Claude's.
- `createSession(options)→ new ReplaySession(options, recordingsDir, indexFor(projectPath))`.
- `killAll()→` no-op. Optional `Adapter` methods return `[]`/static values to satisfy the interface.

### ReplaySession implements `AdapterSession`

Loads `{project}.{index}.ndjson` on construction (throws a clear error naming the path if missing).
Holds a queue of events and a cursor. Replay is **generic**: emit an event by `sink[method](...args)`,
honoring `delayMs` via `setTimeout`.

Drain boundaries (an interaction emits events up to and including the boundary):

| Method | Drains until |
|--------|--------------|
| `spawn(options, sink)` | stores sink; drains until first `onPermission` or queue empty (covers `onInit` + any pre-input messages). Returns a stub `AdapterProcess`. |
| `sendMessage()` | next `onPermission`, `onResult`, or `onExit` |
| `respondToPermission()` | resumes from cursor; same boundaries |
| `interrupt()` | skips forward to next `onResult`/`onExit` |

- **Positional matching only.** Nth interaction → Nth recorded batch. The session never inspects
  message content. E2E tests drive a fixed interaction order, so this is sufficient.
- Queue exhausted before the test finishes → emit `onError` with a descriptive message.
- Replay is fully deterministic: the same fixture yields the same event sequence every run, so any
  conditional UI helper (e.g. `waitForPermissionCardHandlingPlan`) behaves identically each replay.
- Irrelevant methods (`setModel`, `setPermissionMode`, `setPlanMode`, `sendCommand`, `loadHistory`,
  `extractPlanFiles`, `extractSkillFiles`, `cancelQueuedMessage`, `stopBackgroundTask`) are no-ops /
  return empty values.

## E2E harness changes

### `fixtures/app.ts`
When `E2E_MODE` is set: build the mock-cli plugin once (idempotent `pnpm --filter mock-cli build`),
symlink `packages/e2e/plugins/mock-cli` → `~/.mainframe/plugins/mock-cli` (under the **isolated test
data dir**, not the real `~/.mainframe`), and pass `E2E_MODE` + `E2E_RECORDINGS_DIR` into the spawned
daemon's env. Remove the symlink on teardown.

### `fixtures/chat.ts`
`createTestChat` adapter id defaults to `mock-cli` when `E2E_MODE==='mock'`, else `claude`. The
`adapterId` parameter and its threading through `createChat` → ChatManager already exist.

### Spec files
Unchanged. They call `sendMessage` / `waitForAIIdle` / `waitForPermissionCardHandlingPlan` as today.

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

One `E2E_MODE`-gated block in `packages/core/src/index.ts` plus a new `packages/core/src/testing/`
module that is only imported from that block. No other production files change.

## Testing

- **Unit (core):** `recording-sink` records `{method,args,delayMs}` and forwards to the real sink;
  delay math; non-serializable-arg guard.
- **Unit (plugin):** `ReplaySession` drain boundaries against a hand-written fixture — `spawn` drains
  to first permission; `sendMessage` to next boundary; `respondToPermission` resumes; exhaustion →
  `onError`; missing file → clear throw.
- **Integration (the proof):** recorded `06-permissions` Interactive block replays green in mock mode.

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
