# Native E2E replay adapter

`mainframe-adapter-mock` replays the committed NDJSON fixtures in
`packages/e2e/fixtures/recordings` through the Rust `SessionSink` interface. The daemon registers
the adapter only when `E2E_MODE=mock`; production runs do not expose it.

Each fixture line records an input marker, sink output, or workspace file effect:

```json
{"dir":"in","method":"sendMessage","args":["Hello"],"delayMs":0}
{"dir":"out","method":"onInit","args":["session-id"],"delayMs":20}
{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"Hi"}],null],"delayMs":40}
```

Input markers divide turns. `ReplaySession` consumes the expected marker and emits outputs until
the next marker. Stray recorded interrupts are tolerated because the UI can issue them
nondeterministically. Consecutive identical markers are coalesced to match actions that produced
duplicate session calls while recording.

Sink events keep a short relative delay, capped at 120 ms. File effects complete before later sink
events are scheduled so assertions against real Git state observe the recorded ordering. Invalid
event payloads are logged and dropped without terminating the session.

`MockCliAdapter` reads `E2E_RECORDINGS_DIR` and `E2E_RECORDING_KEY` when a session is created.
Fixture names use `{sanitized-key}.{index}.ndjson`. Events are cached by the session id from
`onInit`, with the latest live fixture as a fallback, so history reads reconstruct messages without
advancing the fixture index. Recorded absolute paths under `mf-e2e-*` are remapped to the current
test project.

The adapter exposes a fixed three-model catalog and Claude-compatible tool categories. Its skills
and agents scanners read only the temporary project's `.claude` directory; they never inspect the
user's home directory. These endpoints are read-only for `mock-cli`.

Record mode was intentionally removed with the Node daemon. New fixtures are handwritten or
generated as NDJSON. A future recorder should tee calls at the Rust `SessionSink` boundary so the
format remains adapter-independent.
