# E2E Mock CLI Plugin

Record real Claude CLI interactions, replay them deterministically in CI. The E2E Playwright suite gains two modes: `record` (captures fixtures from the real CLI) and `mock` (replays them via an external plugin). CI runs mock mode only.

## Goals

- Run the existing 20+ Playwright E2E specs in CI without Claude API calls or costs.
- Exercise the plugin system with a real external plugin that registers an adapter.
- Serve as a reference implementation for third-party adapter plugins.
- Keep changes to production code minimal (one conditional block in daemon startup).

## Non-Goals

- Testing NDJSON parsing or stdout buffering (already covered by unit tests).
- Real-time timing fidelity (replay is instant by default).
- Automatic re-recording on test changes (recording is a manual step).

## Architecture

### Mode Toggle

Two environment variables control behavior:

- `E2E_MODE` -- `record`, `mock`, or unset.
- `E2E_RECORDINGS_DIR` -- absolute path to the fixtures directory. Required when `E2E_MODE` is set. The E2E harness sets this to `packages/e2e/fixtures/recordings/`.

| Value | Adapter used | Behavior |
|-------|-------------|----------|
| unset | `claude` | Normal operation |
| `record` | `claude` (wrapped) | Real CLI; writes fixture files |
| `mock` | `mock-cli` (plugin) | Replays from fixture files |

### Components

```
packages/e2e/plugins/mock-cli/       # External plugin (CJS)
  manifest.json                      # id: "mock-cli", capabilities: ["adapters"]
  src/
    index.ts                         # activate(ctx) registers MockCliAdapter
    adapter.ts                       # MockCliAdapter implements Adapter
    session.ts                       # ReplaySession implements AdapterSession
  tsconfig.json
  package.json

packages/e2e/fixtures/recordings/    # Committed NDJSON fixture files

packages/core/src/testing/
  recording-sink.ts                  # RecordingSink wraps SessionSink, writes NDJSON
```

### Data Flow

```
Record mode:
  E2E test -> daemon -> ClaudeAdapter.createSession() -> wrapped session
                                                          |
                                        RecordingSink tees every SessionSink call
                                                          |
                                        writes {project}.{index}.ndjson

Mock mode:
  E2E test -> daemon -> mock-cli plugin -> MockCliAdapter.createSession()
                                            |
                                  ReplaySession loads {project}.{index}.ndjson
                                            |
                                  drains events through SessionSink on each interaction
```

## Mock CLI Plugin

### Manifest

```json
{
  "id": "mock-cli",
  "name": "Mock CLI Adapter",
  "version": "0.1.0",
  "description": "Replays recorded CLI sessions for E2E testing",
  "capabilities": ["adapters"],
  "adapter": {
    "binaryName": "mock-cli",
    "displayName": "Mock CLI"
  }
}
```

### MockCliAdapter

Implements `Adapter`:

- `id`: `"mock-cli"`
- `isInstalled()`: returns `true`
- `getVersion()`: returns `"0.1.0"`
- `listModels()`: returns the same list as `ClaudeAdapter` (hardcoded)
- `createSession(options)`: returns a `ReplaySession` that loads the fixture file for the given project path. Reads fixture directory from `E2E_RECORDINGS_DIR`.
- `killAll()`: no-op (no real processes)

Optional adapter methods (`getToolCategories`, `getContextFiles`, `listSkills`, `listCommands`, etc.) return static values or empty arrays to satisfy the interface.

### ReplaySession

Implements `AdapterSession`. Loads the NDJSON fixture file on creation and drains events through the `SessionSink` in response to interactions.

**Drain logic:**

1. **`spawn(sink)`** stores the sink and drains events until `onPermission` or queue exhaustion. Covers `onInit` and any initial messages before user input.
2. **`sendMessage()`** drains the next batch until `onPermission`, `onResult`, or `onExit`.
3. **`respondToPermission()`** drains the next batch from where it paused.
4. **`interrupt()`** skips forward to the next `onResult` or `onExit`.
5. Events with a `delayMs` field are emitted after a `setTimeout` of that duration.

Methods irrelevant to replay (`setModel`, `setPermissionMode`, `sendCommand`, `getContextFiles`, `loadHistory`, `extractPlanFiles`, `extractSkillFiles`) are no-ops or return empty values.

**Queue position is the only matching logic.** The session does not inspect message content. First `sendMessage` gets the first recorded response, second gets the second, and so on. E2E tests are deterministic in their interaction order, so positional replay is sufficient.

## Fixture Format

NDJSON files in `packages/e2e/fixtures/recordings/`, one file per session. Named `{sanitized-project-path}.{session-index}.ndjson`.

Each line is a JSON object representing one `SessionSink` call:

```jsonl
{"method":"onInit","args":[{"sessionId":"abc","model":"opus"}]}
{"method":"onMessage","args":[{"role":"assistant","content":[{"type":"text","text":"Hello"}]}]}
{"method":"onPermission","args":[{"requestId":"r1","toolName":"Bash","input":{"command":"ls"}}]}
{"method":"onToolResult","args":[{"toolUseId":"t1","content":"file1.ts"}]}
{"method":"onResult","args":[{"cost":0.03,"duration":5200}],"delayMs":2000}
{"method":"onExit","args":[0]}
```

Fields:

- `method` -- the `SessionSink` method name
- `args` -- array of arguments passed to that method
- `delayMs` -- optional (defaults to 0); milliseconds to wait before emitting this event

### Multi-Session Keying

Some tests create multiple chats on the same project (e.g., `21-multi-chat.spec.ts`). The fixture filename includes a session index: `{project}.0.ndjson` for the first session, `{project}.1.ndjson` for the second.

Both the `RecordingSink` (during recording) and `MockCliAdapter` (during replay) maintain a per-project counter that increments on each `createSession` call for a given project path.

### Project Path Sanitization

The project path (e.g., `/Users/x/tmp/e2e-test-abc123`) is sanitized to a filename-safe string: replace path separators and special characters with hyphens, collapse consecutive hyphens, trim leading/trailing hyphens.

## Recording

Recording is a manual, one-time step. Run the E2E suite with `E2E_MODE=record` against the real Claude CLI. The daemon captures every `SessionSink` call to disk.

### RecordingSink

Lives in `packages/core/src/testing/recording-sink.ts`. Wraps a real `SessionSink`:

- Forwards every call to the wrapped sink (so the session behaves normally).
- Appends each call as an NDJSON line to the fixture file.
- Captures relative timestamps from session start; these become the `delayMs` field.
- Output directory is read from `E2E_RECORDINGS_DIR` (required in record mode). The E2E harness sets this to `packages/e2e/fixtures/recordings/`.

### Daemon Integration

In `packages/core/src/index.ts`, a single conditional block:

```typescript
if (process.env.E2E_MODE === 'record') {
  // Wrap the Claude adapter's createSession to inject RecordingSink
}
```

This wraps the registered Claude adapter with a proxy that intercepts `createSession()`. The proxy:

1. Calls the real `createSession()`.
2. Wraps the session's sink with `RecordingSink`.
3. Returns the wrapped session.

No other production files are modified.

### Workflow

1. Run `E2E_MODE=record pnpm --filter @qlan-ro/mainframe-e2e test` (or a subset).
2. Fixture files appear in `packages/e2e/fixtures/recordings/`.
3. Review and commit them.
4. When tests change, re-record the affected fixtures.

## E2E Test Changes

### `fixtures/app.ts`

On setup when `E2E_MODE=mock`:
- Build the mock-cli plugin (`pnpm --filter mock-cli build` or pre-built).
- Create symlink: `~/.mainframe/plugins/mock-cli` -> `packages/e2e/plugins/mock-cli/`.

On teardown:
- Remove the symlink.

### `fixtures/chat.ts`

`createTestChat()` accepts an optional `adapterId`. Defaults to `'claude'` normally, `'mock-cli'` when `E2E_MODE=mock`.

### Test Files

No changes. Tests call `sendMessage()`, `waitForAIIdle()`, `waitForPermissionCard()` as before.

## Plugin System Benefits

This plugin exercises several plugin system capabilities:

- **Adapter registration** via `ctx.adapters.register()` with the `adapters` capability.
- **Manifest validation** (cross-field: `adapters` capability requires `adapter` block).
- **Plugin loading from `~/.mainframe/plugins/`** via filesystem scan.
- **CJS module loading** via `createRequire`.
- **Plugin lifecycle** (`activate` / `onUnload`).

Any limitations or gaps discovered during implementation feed back into the plugin system roadmap.

## Edge Cases

- **Test creates multiple sessions on the same project:** handled by the per-project session index in fixture filenames.
- **Test expects delayed responses (loading states, timeouts):** use `delayMs` on individual fixture events.
- **Fixture file missing in mock mode:** `ReplaySession` throws a clear error naming the expected file path.
- **Fixture queue exhausted before test finishes:** `ReplaySession` emits `onError` with a descriptive message.
- **Recording interrupted mid-test:** partial fixture file is written; re-run recording for that test.
