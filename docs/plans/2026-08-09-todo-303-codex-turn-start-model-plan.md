# Todo #303 — Codex turn-start must always carry a model

## Goal

`turn/start` payloads built by the Codex adapter omit `collaborationMode.settings.model` whenever the
chat has no model configured, and the app-server rejects the request with `-32600 Invalid request:
missing field 'model'`, so the turn never starts and the user sees a raw protocol code. The field is
required and non-nullable in the protocol, so the fix is to resolve a concrete model id at the point of
use and always serialize it: the chat's configured model first, then the model the app-server itself
reported on `thread/start`/`thread/resume`, then the provider's saved default normalized against the
probed catalog, then the catalog entry flagged as the adapter's default. When no tier yields an id the
turn fails with a logged, user-legible adapter error instead of silently dropping the collaboration mode
(which would also disable plan mode). Everything else that is correctly omitted today — the top-level
`turn/start` model override and the `thread/start`/`thread/resume` model parameter, both optional and
nullable in the schema — keeps its current behavior.

## Protocol facts, verified against the installed CLI

Regenerated on 2026-08-09 with `codex app-server generate-ts --out <tmp> --experimental` against
`codex-cli 0.144.3`. The generated types are the source of truth; every claim below is quoted from them.

| Fact | Generated type | Consequence |
|---|---|---|
| `Settings.model` is a required, non-nullable string | `Settings.ts`: `{ model: string, reasoning_effort: ReasoningEffort \| null, developer_instructions: string \| null }` | The key must always be present with a real id. Emitting `"model": null` (i.e. just deleting `skip_serializing_if`) is rejected too. |
| `reasoning_effort` / `developer_instructions` are required-but-nullable | same file | Their present-with-explicit-null serialization is already correct and must not change. |
| `ThreadStartResponse.model` is a required string | `v2/ThreadStartResponse.ts`: `{ thread: Thread, model: string, modelProvider: string, ... }` | The app-server tells us the model it resolved. This is the definitionally correct "account default". |
| `ThreadResumeResponse.model` is a required string | `v2/ThreadResumeResponse.ts` | Same, for the resume path. |
| `TurnStartParams.model` is optional and nullable | `v2/TurnStartParams.ts`: `model?: string \| null` | Keep omitting it. |
| `ThreadStartParams.model` is optional and nullable | `v2/ThreadStartParams.ts`: `model?: string \| null` | Keep omitting it. |

## Code map

All Rust, all in `packages/core-rs`. No UI work: the error path reuses the existing turn-failure surface
(`AdapterError` → `SendError` → the wire), which is how the raw `-32600` reaches the user today.

| File | Role today | Change |
|---|---|---|
| `crates/mainframe-adapter-codex/src/types.rs` (L278–289) | `CollaborationModeSettings` with `model: Option<String>` + `skip_serializing_if`, and a doc comment asserting the omission is intentional | `model: String`, no skip, corrected doc comment |
| `crates/mainframe-adapter-codex/src/types.rs` (L61–69) | `ThreadStartResult` / `ThreadResumeResult` deserialize only `thread.id` | add a lenient `model` capture |
| `crates/mainframe-adapter-codex/src/turn_config.rs` | `build_turn_config(..., model_id: Option<&str>, ...)` omits the key for `None` and `""` | takes a resolved `&str`; obsolete test replaced |
| `crates/mainframe-adapter-codex/src/turn_model.rs` | does not exist | new pure tier resolver |
| `crates/mainframe-adapter-codex/src/session_state.rs` | `CodexSessionState` — per-session notification-driven state | add `reported_model` |
| `crates/mainframe-adapter-codex/src/session.rs` (L436–500) | `send_message`: lazy thread start/resume, then `build_turn_config(..., model.as_deref(), ...)` | capture the reported model, resolve before building |
| `crates/mainframe-types/src/adapter.rs` (L73–90) | `SessionSpawnOptions` | add `default_model` (precedent: the Claude/CLIProxy-only `small_fast_model` already lives here) |
| `crates/mainframe-chat/src/lifecycle_manager.rs` (~L991) | `start_chat` builds `SessionSpawnOptions` | compute the provider/catalog default once per spawn |
| `docs/adapters/codex/CONSUMED-SURFACE.md` | rows CODEX-RPC-02, CODEX-RPC-03 | record the newly-consumed response field and the required setting |

Verified with `grep`: `CollaborationModeSettings` is referenced only by `types.rs` and `turn_config.rs`,
and `CollaborationMode` only by those two files. **No read path (rollout JSONL, history reconstruction,
external-session parsing) deserializes either type**, so tightening `model` to a required `String` cannot
break history parsing. The brief asked for this check; this is the answer.

## Design decisions

1. **Resolve at the point of use, never at chat creation.** The chat row's null legitimately means "no
   explicit choice", and forcing an id at creation would need every creation path backfilled while still
   leaving chats whose saved default was later retired. This follows the codebase's own precedent —
   `resolve_tuning_for_chat` resolves against the live catalog at use time.
2. **Tier 2 capture is lenient; resolution is strict.** `ThreadStartResult.model` / `ThreadResumeResult.model`
   become `#[serde(default)] Option<String>`, **not** a required `String`. A required field would make serde
   fail the whole `thread/start` deserialization against any CLI build whose response lacks it, turning a
   fallback improvement into a regression for chats that work today. Tier 3 exists precisely to cover that case.
3. **The reported model is stored in `CodexSessionState`, not in `PendingConfig.model`.** `get_process_info()`
   reports `cfg.model` as the chat's model; overwriting it with the app-server's resolved default would
   misreport a model the user never chose. `PendingConfig.model` stays optional and untouched.
4. **Tier 3 is delivered as `SessionSpawnOptions.default_model`.** The brief prescribes the tiers but not the
   seam. The session has no settings or catalog access, and the existing codex-only seam
   (`ChatLifecycleDeps::apply_codex_provider_tuning`) is still an unported no-op, so it cannot carry this.
   `start_chat` already has `settings_get` and `adapter_snapshot_models`; it computes the value once per spawn
   and hands it over. `small_fast_model` sets the precedent for an adapter-specific field on the shared spawn
   options. Non-codex adapters ignore it.
5. **The resolver lives in a new `turn_model.rs`.** `session.rs` is 807 lines and `turn_config.rs` 222 against
   a 300-line ceiling; a new module keeps both under it and makes the tier order unit-testable without a
   process.
6. **Empty strings are filtered at every tier.** The acceptance criteria call out the empty-string model
   explicitly, and the old code relied on JS falsiness (`modelId ? ... : {}`) to treat `""` as absent.
7. **No tier may fall back to a hardcoded id.** Model ids churn between CLI releases; a stale constant would
   fail later and less legibly than an explicit error.
8. **Plan path.** The dispatch names `docs/plans/`; the repo's older convention is `docs/superpowers/plans/`.
   The dispatch wins — this file is the first under `docs/plans/`.

## Constraints

- Max 300 lines per file, 50 per function (`CLAUDE.md`). `session.rs` is at 807 lines already: do not add
  net lines to it beyond the resolution call; the resolver body belongs in `turn_model.rs`.
- No silent catches. The no-model failure logs via `tracing::error!` before returning the error.
- Tests required for new core logic; do not lower coverage.
- A changeset is required. `packages/core-rs` has no npm package, so the changeset targets
  `'@qlan-ro/mainframe-ui': patch` (the release-tagged package; the `fixed` group bumps
  `@qlan-ro/mainframe-types` with it). `@qlan-ro/mainframe-core` appears in older changesets and is the
  deleted package — do not use it.
- Comments say *why*. Do not narrate the diff; the PORT STATUS note blocks are the exception and must be
  updated where they now describe removed behavior (no leftovers).

---

## Tasks

### Group 1 — red-phase integration tests (must be observed failing first)

These are written against **today's** API so they compile and fail for the right reason. They must not
reference `turn_model`, `default_model`, or any other symbol that does not exist yet.

#### T1 — Fake app-server harness that captures the `turn/start` payload

**File (new):** `packages/core-rs/crates/mainframe-adapter-codex/tests/turn_start_model.rs`

Model the harness on `tests/list_models.rs` (`FAKE_APP_SERVER`: a `#!/bin/sh` script written to a
`tempfile::tempdir()`, `chmod 0o755`, driven over newline-delimited JSON-RPC). Extend it in two ways:

- The script **tees every line it reads from stdin to a capture file** whose path is passed in via an
  environment variable or baked into the generated script text, so the test can assert on the exact
  serialized `turn/start` params rather than on adapter-side structs.
- The script answers, in order: `initialize` (id 1), `initialized` (notification, no reply),
  `thread/start` (id 2), `turn/start` (id 3). Make the `thread/start` reply body a parameter of the
  script-generating helper so each case can include or omit `"model"`.

Add a helper that builds a spawned `CodexSession`:

```
CodexSession::new(SessionOptions { .. }, None, ResolvedPath::from_value("/usr/bin:/bin"))
```

then `session.spawn(Some(SessionSpawnOptions { model, permission_mode: None, plan_mode: Some(false),
executable_path: Some(fake_path), system_prompt: None, tuning: None, small_fast_model: None }), Some(sink))`.
Use `tests/common/mod.rs::Recorder` for the sink. Keep the spawn-options literal in **one** helper function
in this file — Group 2 adds a field to that struct and must only have to touch that one helper.

**Verification:** `cargo test -p mainframe-adapter-codex --test turn_start_model` compiles and the harness
case that asserts nothing (a smoke test that a turn reaches the fake with a configured model) passes.

#### T2 — The four failing cases

**File:** `packages/core-rs/crates/mainframe-adapter-codex/tests/turn_start_model.rs` (same file as T1)

1. `configured_model_is_sent_verbatim_in_collaboration_mode_settings` — spawn with
   `model: Some("gpt-5.5")`, `thread/start` reply reports `"model": "gpt-5.6-sol"`. Assert the captured
   `turn/start` params have `collaborationMode.settings.model == "gpt-5.5"`. **This one passes today** and
   is the regression guard for acceptance criterion 1.
2. `model_less_chat_falls_back_to_the_thread_reported_model` — spawn with `model: None`, `thread/start`
   reply reports `"model": "gpt-5.6-sol"`. Assert `collaborationMode.settings.model == "gpt-5.6-sol"`.
   **Fails today**: the key is absent.
3. `empty_model_is_treated_as_absent` — spawn with `model: Some("")`, same reply. Assert the same
   fallback id. **Fails today.**
4. `plan_mode_survives_on_a_model_less_chat` — spawn with `model: None` and `plan_mode: Some(true)`.
   Assert the captured params still have `collaborationMode.mode == "plan"` **and** a non-empty
   `collaborationMode.settings.model`. **Fails today** on the model assertion.
5. `no_resolvable_model_fails_the_send_without_starting_a_turn` — spawn with `model: None` and a
   `thread/start` reply that **omits** `model`. Assert `send_message` returns `Err`, that the error string
   names the missing model, **and that the capture file contains no `turn/start` request at all**. The
   capture-file assertion is load-bearing: today's raw `-32600 ... missing field 'model'` also contains the
   word "model", so asserting on the error text alone would pass spuriously. **Fails today** because a
   `turn/start` is sent.

Additionally assert in cases 1–4 that `collaborationMode.settings` still carries `reasoning_effort` and
`developer_instructions` as explicit `null` (acceptance criterion 7), and that the captured `turn/start`
params contain **no top-level `model` key** when the chat has none (acceptance criterion 8).

**Verification:** `cargo test -p mainframe-adapter-codex --test turn_start_model` — case 1 passes, cases
2–5 fail. Record the failure output in the PR description.

---

### Group 2 — implementation

#### T3 — `CollaborationModeSettings.model` becomes a required `String`

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/types.rs` (L278–289)

- `pub model: String;` — delete the `#[serde(skip_serializing_if = "Option::is_none")]`.
- Replace the doc comment. It currently claims the field is "optional (omitted when no model is selected,
  so Codex uses the account default)", which is the opposite of the protocol. State the fact: `model` is
  required and non-nullable in the app-server's collaboration-mode settings (`Settings.ts`, codex-cli
  0.144.3); `reasoning_effort` and `developer_instructions` are required-but-nullable and stay
  present-with-explicit-null.
- Leave `reasoning_effort` and `developer_instructions` untouched.

**Verification:** `cargo check -p mainframe-adapter-codex` fails only at `turn_config.rs` (fixed in T4).

#### T4 — `build_turn_config` takes a resolved model id

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/turn_config.rs`

- Signature: `model_id: Option<&str>` → `model: &str`. Delete the `filter(|m| !m.is_empty()).map(...)` line
  and its comment; the caller now owns that decision.
- Delete the test `omits_the_model_setting_when_no_model_is_selected` (L150–162) — it encodes the bug.
- Replace it with `serializes_the_model_key_for_every_turn`: build a config, `serde_json::to_value` the
  `collaboration_mode`, and assert `settings.model` is the string passed in, `settings.reasoning_effort`
  is JSON `null` when effort is `None`, and `settings.developer_instructions` is JSON `null`. This is the
  contract test the brief asks for in place of the omission test.
- Update the remaining tests' call sites to pass `&str` instead of `Some(..)`.
- Update the `PORT STATUS` note block (L214–222): the "notes: #430 — model_id is now Option<&str>; the
  `model` key is omitted for both a None id and an empty string" lines now describe removed behavior and
  must be rewritten to state that the model is a resolved, required id.

**Verification:** `cargo test -p mainframe-adapter-codex --lib turn_config`.

#### T5 — The tier resolver

**File (new):** `packages/core-rs/crates/mainframe-adapter-codex/src/turn_model.rs`
**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/lib.rs` (add `pub(crate) mod turn_model;`
alongside the other module declarations, alphabetically before `turn_config`)

```rust
pub(crate) fn resolve_turn_model(
    configured: Option<&str>,
    reported: Option<&str>,
    default_hint: Option<&str>,
) -> Result<String, AdapterError>
```

- Try each tier in order, filtering out empty and whitespace-only strings via one private
  `fn non_empty(v: Option<&str>) -> Option<&str>` helper (extracted rather than repeated three times).
- On exhaustion return `AdapterError::Message` with a message that names the missing model and tells the
  user what to do, e.g. `"Codex could not determine which model to use: this chat has no model selected,
  the Codex app-server reported none, and no default model is configured. Pick a model in the composer or
  set a Codex default in Settings."` Copy is user-facing; keep it plain and actionable, no error codes.
- Do **not** log inside the resolver — it is pure. The caller logs (T8).

Unit tests in the same file (`#[cfg(test)] mod tests`), covering the acceptance criteria for tier order:
configured wins over reported and hint; empty configured falls through to reported; absent reported falls
through to the hint; all-absent returns `Err` whose message contains "model"; whitespace-only values at
each tier are treated as absent.

**Verification:** `cargo test -p mainframe-adapter-codex --lib turn_model`.

#### T6 — Capture the app-server's reported model off the wire

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/types.rs` (L61–69)

Add to both `ThreadStartResult` and `ThreadResumeResult`:

```rust
#[serde(default)]
pub model: Option<String>,
```

One-line comment on why it is optional despite the schema marking it required: older app-server builds
omit it, and a hard requirement would fail the whole thread-start deserialization (decision 2).

**Verification:** `cargo test -p mainframe-adapter-codex` — no existing test constructs these structs, so
this is additive.

#### T7 — Session state carries the reported model

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/session_state.rs`

Add `pub reported_model: Option<String>` to `CodexSessionState` (it derives `Default`, so no other
construction site changes). Doc-comment it as the model the app-server resolved for this thread, used as
the turn-start fallback when the chat has none.

**Verification:** `cargo check -p mainframe-adapter-codex`.

#### T8 — Resolve at the point of use in `send_message`

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/session.rs` (L436–500)

- In the `thread_id.is_none()` branch, both arms already deserialize the response. Store
  `res.model` into `state.reported_model` alongside `state.thread_id` (guard with the same
  `non_empty` semantics — write `None` rather than `Some("")`).
- After the thread block, read `reported_model` out of state and `default_model` out of `PendingConfig`
  (added in T9), then:

```rust
let resolved_model = resolve_turn_model(model.as_deref(), reported.as_deref(), hint.as_deref())
    .inspect_err(|err| tracing::error!(
        module = "codex:session", session_id = %self.id, err = %err,
        "codex: cannot start turn without a model"
    ))?;
```

- Pass `&resolved_model` to `build_turn_config`.
- Leave the top-level `if let Some(m) = &model { p.insert("model", ...) }` block exactly as it is — it must
  keep omitting when the chat has no model (acceptance criterion 8).
- Leave the `thread/start` / `thread/resume` `model` param blocks exactly as they are, for the same reason.
- Keep the function under the 50-line ceiling; `send_message` is already long, so extract the
  thread-start/resume block into a private `async fn ensure_thread(&self, client, model) -> Result<(),
  AdapterError>` if adding the capture pushes it over.

**Verification:** `cargo test -p mainframe-adapter-codex --test turn_start_model` — Group 1 cases 2, 3, 4
and 5 now pass (case 5 relies on T9's default hint being `None` in the test harness, which it is).

#### T9 — `default_model` on the spawn options

**Files:**
- `packages/core-rs/crates/mainframe-types/src/adapter.rs` (L73–90)
- `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs` (L1139, L1318)
- `packages/core-rs/crates/mainframe-adapter-codex/src/session.rs` (L300, plus `PendingConfig` at L79–97
  and the spawn assignment at L311–317)
- `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs` (L996)
- `packages/core-rs/crates/mainframe-adapter-codex/tests/turn_start_model.rs` (the single helper from T1)

Add to `SessionSpawnOptions`:

```rust
/// Provider/catalog default model, resolved once per spawn by the chat lifecycle.
/// Codex uses it as the last turn-start fallback when the chat has no model and the
/// app-server reported none; other adapters ignore it.
#[serde(skip_serializing_if = "Option::is_none")]
pub default_model: Option<String>,
```

Update all construction sites (six, enumerated above — `grep -rn "SessionSpawnOptions {" crates/` must
return nothing unhandled). In the Codex session, add `default_model: Option<String>` to `PendingConfig`
(default `None`) and assign it in `spawn` next to `cfg.model`.

**Verification:** `cargo check --workspace` from `packages/core-rs`; `cargo test -p mainframe-adapter-codex
--test turn_start_model` still green.

#### T10 — Compute the default hint at spawn

**File:** `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs` (~L985–1004)

Add a small private method next to `start_chat` (keeps `start_chat` under 50 lines):

```rust
fn default_model_for(&self, adapter_id: &str) -> Option<String> {
    let models = self.deps.adapter_snapshot_models(adapter_id);
    let saved = self.deps.settings_get("provider", &format!("{adapter_id}.defaultModel"));
    normalize_saved_default_model(saved.as_deref(), &models)
        .or_else(|| models.iter().find(|m| m.is_default == Some(true)).map(|m| m.id.clone()))
}
```

This is the same two-step the tuning resolver and `create_chat_with_defaults` already use — reuse
`normalize_saved_default_model` from `mainframe_services::settings` (already imported at L9), do not
reimplement. Pass the result as `default_model` in the `SessionSpawnOptions` literal.

Add a unit test in `lifecycle_manager.rs`'s existing `mod tests` using the existing fake deps: with a
saved default present in the catalog it returns that id; with a saved default absent from a non-empty
catalog it falls through to the `is_default` entry; with neither it returns `None`.

**Verification:** `cargo test -p mainframe-chat --lib lifecycle_manager`.

#### T11 — Consumed-surface notes

**File:** `docs/adapters/codex/CONSUMED-SURFACE.md`

- **CODEX-RPC-02**: extend the row to record that the *response* `model` field is now consumed
  (`ThreadStartResponse.model` / `ThreadResumeResponse.model`, required strings in codex-cli 0.144.3,
  deserialized leniently), name `src/session.rs` + `src/session_state.rs::CodexSessionState::reported_model`
  as the consumer, cite `tests/turn_start_model.rs` for coverage, and give the breakage symptom: model-less
  chats lose their fallback and fall through to the provider default.
- **CODEX-RPC-03**: state that `collaborationMode.settings.model` is **required and non-nullable** (unlike
  its two siblings), name `src/turn_model.rs::resolve_turn_model` as the resolver, and cite
  `tests/turn_start_model.rs` plus `src/turn_config.rs::serializes_the_model_key_for_every_turn`. Symptom:
  `-32600 Invalid request: missing field 'model'` and no turn.
- Set the `Verified` column to `2026-08-09 (codex-cli 0.144.3, generate-ts)` on both rows.

**Verification:** the two rows name files and tests that exist (`grep` each cited symbol).

#### T12 — Changeset

**File (new):** `.changeset/codex-turn-start-model.md`

```
---
'@qlan-ro/mainframe-ui': patch
---
```

Body: one short paragraph in plain user language — a Codex chat with no model chosen could not send a
message at all, failing with a raw protocol error; Codex turns now always name a model, falling back to
the one the Codex app-server itself resolved and then to the configured default, and say so plainly if no
model can be found.

**Verification:** `pnpm changeset status` runs clean; the pre-push hook accepts the branch.

---

### Group 3 — full verification

#### T13 — Crate-wide tests, lint, and a real-CLI turn

From `packages/core-rs`:

1. `cargo test -p mainframe-adapter-codex` — the whole crate, not just the new file.
2. `cargo test -p mainframe-chat -p mainframe-types` — the spawn-options and lifecycle changes.
3. `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --check` (the CI fmt gate is
   non-required and has let red merges through before; run it locally).
4. **Real app-server check (acceptance criterion 3).** With `codex-cli 0.144.3` on PATH, run a dev daemon
   on an isolated data dir and port (`MAINFRAME_DATA_DIR=~/.mainframe_dev DAEMON_PORT=31500` — never
   :31415, which is the production instance this session runs inside), create a Codex chat with no model,
   send one message, and confirm: the turn starts, no `-32600` appears in the daemon log, and the
   `turn/start` payload logged by the app-server carries a non-empty `collaborationMode.settings.model`.
   Repeat once with plan mode on to confirm `mode: "plan"` still travels.
5. **No-model error path end to end (acceptance criterion 5).** Against the real CLI this path cannot
   fire — `ThreadStartResponse.model` is a required string in 0.144.3, so tier 2 always resolves and the
   send succeeds. Drive it through a fake app-server instead. The resolver's own failure is covered by
   T2 case 5; this step exists to confirm the sentence reaches the composer.

   - Write a standalone `#!/bin/sh` script shaped like the T1 harness (no capture file): a
     `while IFS= read -r line` loop that dispatches on the method name and **echoes back each request's
     own id** — one script serves two processes, the catalog probe and the chat session, whose request
     sequences diverge after `initialize`, so the fixed-id sequence in `tests/list_models.rs` will not do.
     Answer `initialize`, answer `model/list` with `{"data":[],"nextCursor":null}`, and answer
     `thread/start` with a result that **omits** `model`.
   - Run this step in a daemon process that has **never** probed the real Codex binary: point
     `provider.codex.executablePath` at the script, confirm `provider.codex.defaultModel` is unset, and
     only **then** start — or restart — the isolated daemon (a second isolated data dir works too). Do not
     reuse the instance from step 4; that process cannot reach the error path, because
     `CodexAdapter.cached_models` (`crates/mainframe-adapter-codex/src/adapter.rs` L108–115) returns the
     real catalog it already probed for the life of the process and nothing invalidates it, and even a cold
     empty probe is discarded — `crates/mainframe-adapter-api/src/lib.rs` L349 passes `models: None` when
     the live probe came back empty, and `apply_refresh` (L382) then keeps the previous catalog.
   - Both settings matter. `probe_models` reads the same `executablePath` (`adapter.rs` L217–225), so the
     fake's empty `model/list` is what leaves the catalog empty and kills the `is_default` half of tier 3;
     and `normalize_saved_default_model` returns a saved default verbatim when the catalog is empty
     (`crates/mainframe-services/src/settings/model_default.rs` L16–17), so a leftover saved default would
     still satisfy tier 3.
   - Precondition to observe before sending: the Codex model picker shows an empty catalog. On a fresh
     process it will — Codex's `get_fallback_models()` (`adapter.rs` L203–205) seeds the snapshot with
     `Some(Vec::new())`, so the empty probe leaves nothing to fall back to.
   - Create a Codex chat with no model, send one message, and confirm the composer shows the T5 sentence
     rather than a protocol code, the daemon log carries the T8 `tracing::error!` line, and no
     `turn/start` request was sent.

**Verification:** all four commands green; the two manual checks recorded in the PR description.

---

## Risks and open points

- **Fake-app-server timing.** The `list_models.rs` script reads a fixed number of stdin lines. `turn/start`
  arrives after a `thread/start` round trip, and the adapter also sends `initialized` as a notification, so
  the read sequence must match exactly or the test hangs. Prefer a `while IFS= read -r line` loop that
  dispatches on the method name over a fixed sequence of reads, and give each `cargo test` a timeout.
- **Tier 3 is defensive, not load-bearing.** `thread/start` or `thread/resume` always runs before the first
  turn of a session, so tier 2 covers production. Tier 3 exists for an app-server build that omits the
  field. Do not delete it as dead code — it is the reason tier 2 can stay lenient. The same fact is why
  T13 step 5 drives the failure through a fake app-server: against 0.144.3 no live configuration can
  reach the error.
- **`apply_codex_provider_tuning` is still a no-op.** `ChatLifecycleDeps::apply_codex_provider_tuning`
  (`crates/mainframe-server/src/chat_deps.rs` L593) is an unported stub, so `set_codex_provider_tuning` never
  runs in production and Codex personality/summary never reach a turn. That is a separate bug, out of scope
  here, and it is why this plan does not route `default_model` through that seam.
- **Image attachments on Codex turns** remain unsupported (`session.rs` L408) and stay out of scope.

## T13 verification results (Group 3, 2026-08-09)

All four commands from `packages/core-rs`:

1. `cargo test -p mainframe-adapter-codex` — 100 lib unit tests + all integration files green,
   including the 5 `turn_start_model.rs` cases and `turn_config::tests::serializes_the_model_key_for_every_turn`.
2. `cargo test -p mainframe-chat -p mainframe-types` — green, including
   `lifecycle_manager::tests::default_model_for_*` (3 cases) and the 164-test `mainframe_types` suite.
3. `cargo clippy --workspace --all-targets -- -D warnings` and `cargo fmt --check` — both clean, no output.
4. **Real app-server check**, `codex-cli 0.144.3` on PATH, isolated daemon (`MAINFRAME_DATA_DIR=/tmp/mf_dev_303a`,
   `DAEMON_PORT=31502`, never :31415). Created a Codex chat with no model, sent a message over the WS API
   directly (`{"type":"message.send",...}`): the turn started and completed with a real assistant reply
   ("Hello!"), zero `-32600` occurrences in the trace log, and the app-server's own
   `thread/settings/updated` echo confirmed `collaborationMode.settings.model == "gpt-5.6-sol"` (tier 3,
   the catalog default — this account's Codex has no saved default, so tier 3 is what resolved, which is
   still full coverage of "a model is always sent"). Repeated with `PATCH .../config {"planMode":true}`:
   the same echo showed `collaborationMode.mode == "plan"` with the same non-empty model, confirming plan
   mode still travels on a model-less chat.
5. **No-model error path**, driven through a fake app-server (`while read` dispatch-by-method, per-request
   `id` echo, `model/list` → empty catalog, `thread/start` → no `model` key) on a second, never-probed
   isolated daemon (`/tmp/mf_dev_303b`, port 31503): set `provider.codex.executablePath` to the fake script,
   confirmed `provider.codex.defaultModel` unset, restarted the daemon, confirmed `GET /api/adapters` showed
   an empty Codex catalog (`catalogSource: "fallback"`, `models: []`). Created a model-less chat and sent a
   message: the WS `error` event carried the exact T5 sentence ("Codex could not determine which model to
   use: this chat has no model selected, the Codex app-server reported none, and no default model is
   configured. Pick a model in the composer or set a Codex default in Settings."), the daemon log had the
   `tracing::error!` line (`codex: cannot start turn without a model`, `module="codex:session"`), zero
   `-32600` occurrences, and the fake script's own received-methods capture recorded only
   `initialize`, `initialized`, `thread/start` — no `turn/start` was ever sent.
