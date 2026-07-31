# Todo #290 — Feed the real adapter catalog to new-chat default-model normalization

**Branch:** `todo/290-adapter-snapshot-models` · **Worktree:** `.worktrees/todo-290-adapter-snapshot-models`
**Route:** no-spec (works from the approved Agent Brief on todo #290)

## Goal

When a chat is created without an explicit model, `LifecycleManager::create_chat_with_defaults` reads the saved
`<adapterId>.defaultModel` provider setting and validates it against the adapter's catalog via
`normalize_saved_default_model`. That helper deliberately short-circuits on an empty catalog — an empty catalog means
the probe failed, and a probe failure must not wipe a user's saved default. The catalog comes from
`ChatManagerDeps::adapter_snapshot_models`, which carries a trait default returning an empty `Vec` that the daemon's
production `DaemonChatDeps` never overrides, so the escape hatch fires on every chat creation and the saved id is
accepted unchecked. A model id the provider has retired, or one written by an older build, reaches the new chat and
then the CLI. This plan wires the production implementation to the adapter registry's materialized snapshots, removes
the trait default so the compiler rejects any future implementation that forgets it, logs the drop at `warn`, and pins
all three behaviors with a `mainframe-server` integration test that drives the real `build_chat_manager` stack.

## Findings that shape the plan (verified in this worktree at `6666a1e3`)

1. **The defect is exactly one missing override.** `ChatManagerDeps::adapter_snapshot_models`
   (`packages/core-rs/crates/mainframe-chat/src/chat_manager.rs:287-294`) returns `Vec::new()` by default.
   `grep -rn adapter_snapshot_models packages/core-rs` returns five hits and **none** is an override in
   `packages/core-rs/crates/mainframe-server/src/chat_deps.rs`. The only production impl of `ChatManagerDeps` is
   `impl ChatManagerDeps for DaemonChatDeps` (`chat_deps.rs:197`).
2. **The method is defaulted on *two* traits, not one.** `LifecycleManagerDeps::adapter_snapshot_models`
   (`lifecycle_manager.rs:79-82`) has the same empty default. The only non-test impl of `LifecycleManagerDeps` is the
   in-crate bridge `LcDeps` (`chat_manager.rs:504`), which forwards to `ChatManagerDeps` at `chat_manager.rs:616-621`.
   So the lifecycle-side default is reachable only by test fakes today — but it is the same trap, in the same call
   chain, under the same name. See D2.
3. **The call site needs no logic change.** `lifecycle_manager.rs:302-306`:
   `let models = self.deps.adapter_snapshot_models(adapter_id); effective_model = normalize_saved_default_model(Some(&m), &models);`
   With a real catalog this already behaves as designed.
4. **The registry accessor exists and is keyed by adapter id.** `AdapterRegistry::get_snapshots()`
   (`packages/core-rs/crates/mainframe-adapter-api/src/lib.rs:196-198`) clones every `AdapterInfo` out of the
   `snapshots` DashMap; each record carries `id`, `models`, and `catalog_source`. There is **no** per-id accessor.
   `DaemonChatDeps` already holds `adapters: Arc<AdapterRegistry>` and uses it in five other methods
   (`chat_deps.rs:210, 427, 531, 582, 747`), so no new field or constructor argument is needed.
5. **A dropped default yields `model = NULL`, not a substituted id.** `normalize_saved_default_model` returns `None`,
   `effective_model` stays `None`, and `mainframe_db::chats::create` binds NULL (`chats.rs:238, 249`) and returns
   `model: None` (`chats.rs:264`). The brief's phrase "falls through to the adapter's own default model" describes the
   downstream effect (the CLI and the model picker resolve their own default from a null model), not a value this code
   writes. **Assert `chat.model == None`** — asserting a substituted id would fail.
6. **`chat_background_activity.rs` is the exact template for the new test.** `packages/core-rs/crates/mainframe-server/tests/chat_background_activity.rs`
   was written for #273, the same defect class, and already builds the production manager through `build_chat_manager`
   with a `Db::spawn(:memory:)`, a `TempDir` data dir, a real project + chat row, and a `NoopQuotaSettings` stub. Its
   `harness()` is the starting point; the new test needs the same scaffolding plus a registered adapter and a saved
   provider setting.
7. **Seeding a snapshot requires an `Adapter`, and `seed_static_snapshots` is the spawn-free path.** `AdapterRegistry`'s
   `snapshots` map is private and is only written by `seed_static_snapshots()` (`lib.rs:174-194`, reads
   `adapter.get_fallback_models()`) and by `refresh_adapter`. `seed_static_snapshots()` calls **only**
   `get_fallback_models()` — no `is_installed`, no `get_version`, no CLI spawn (pinned by
   `mainframe-adapter-api/tests/registry.rs:277-288`). The `Adapter` trait's required methods are `id`, `name`,
   `capabilities`, `is_installed`, `get_version`, `list_models`, `create_session`, `kill_all`
   (`mainframe-adapter-api/src/adapter.rs:179-209`); everything else is defaulted. `create_session` returns
   `Arc<dyn AdapterSession>`, which would drag in a whole session double — the test never starts a chat, so it is
   `unreachable!()`. See D4 for why `mainframe-adapter-mock` is not used.
8. **`chats.adapter_id` has no foreign key** (`mainframe-db/src/migrations.rs:52-66`), so the "no snapshot registered"
   case can create a chat against an unregistered adapter id without tripping the DB.
9. **A stale ledger note names this todo as open.** `chat_manager.rs:2149-2151`: "New defaulted ChatManagerDeps methods
   still silently unoverridden in chat_deps.rs (filed as #289 is_transcript_present, #290 adapter_snapshot_models)".
   It must stop naming #290 once this lands.
10. **`docs/plans/` does not exist at this commit** in the worktree tree (`git ls-tree HEAD docs/` has no `plans`
    entry) even though the directory exists in the primary checkout. Task 1 creates it.

## Ambiguities resolved (carried into the report)

- **AC 1 says "`adapter_snapshot_models` has no trait default; the crate does not compile if an implementation omits
  it" without naming a trait, and the method is defaulted on two traits (finding 2).** Resolved: remove **both**
  defaults. "The crate" is `mainframe-chat`, which houses both declarations, and leaving the lifecycle-side default in
  place preserves the identical trap one layer down. Cost is two lines in two test fakes.
- **The brief's "Key interfaces" section says the lifecycle path's "logic is unchanged", while its "Decisions" section
  requires a `warn` when a stale default is dropped.** Resolved: add the `warn` at the lifecycle call site (Task 6).
  A log line is not a logic change — the same `Chat` is produced on every input — and it is the only place that knows
  both the configured id and the normalized result. `normalize_saved_default_model` stays byte-identical, as AC 5
  requires.
- **The brief's original notes describe the fix as delegating to "the adapter catalog already wired for the Node
  side".** Stale, and the brief's own "Key interfaces" section says so: `AdapterRegistry` in `mainframe-adapter-api`
  is this runtime's only catalog. No Node code is touched by this plan.

## Design decisions

- **D1 — Use the snapshot as-is, regardless of `catalog_source`.** Per the brief's decision. A `Fallback`-sourced
  catalog is the adapter's own declared model set; if it lags the CLI, a legitimate saved default is dropped and the
  chat opens on the adapter's default model — a benign outcome. The escape lever (treat `Fallback` as "cannot judge")
  is **not** built here; Task 9 records it in the PR description.
- **D2 — Remove the trait default on both `ChatManagerDeps` and `LifecycleManagerDeps`.** See the ambiguity above.
  Each declaration gets a `Required, not defaulted:` doc comment matching the house style already used for
  `tracker_list_live` / `tracker_end_all_running` (`chat_manager.rs:258-269`).
- **D3 — Delegate through `get_snapshots()` rather than adding a per-id registry accessor.** The brief pins
  `get_snapshots()` as the interface. It clones every `AdapterInfo` (finding 4), but the call happens once per chat
  creation across a handful of registered adapters. Adding `AdapterRegistry::get_snapshot(id)` would widen the change
  into `mainframe-adapter-api` for no measurable gain.
- **D4 — The integration test defines its own minimal `Adapter` double instead of reusing `MockCliAdapter`.**
  `mainframe-adapter-mock`'s adapter hard-codes a fixed three-model catalog (`adapter.rs:31-56`) and its constructor
  wants a `ReplayCache`. The test must choose model ids so that one saved default is present and another is absent;
  a ~35-line local double keyed off `get_fallback_models()` states that intent directly.
- **D5 — The test asserts on the `Chat` returned by `create_chat_with_defaults`, not on a re-read row.** That value is
  what `POST /api/chats` returns and what the `chat.created` event carries, so it is the observable surface. Task 3
  additionally re-reads through `manager.get_chat` in the stale-default case to prove nothing was persisted.

## Out of scope (from the brief; do not expand)

Changing `normalize_saved_default_model`'s contract or its empty-catalog short-circuit; changing how or when the
registry refreshes, probes, or seeds snapshots; any UI change to the model picker or provider-defaults pane; migrating
already-stored stale model ids on existing chats; the `chat_manager` module-size chore (#292).

## Sequencing risk (raise before starting implementation)

The brief's 2026-07-29 gate feedback rules that #290 ships as its own PR **after #289 lands**, because #289 edits the
same trait declaration block (`chat_manager.rs`, adjacent method) and the same `impl ChatManagerDeps for
DaemonChatDeps`. As of this commit (`6666a1e3`, `git log --grep=289`) **#289 has not landed on `origin/main`**. This
plan is written against `origin/main` as it stands and is self-contained; if #289 merges first, expect a textual
conflict in exactly two regions — the `ChatManagerDeps` method list and the `DaemonChatDeps` impl — and rebase before
opening the PR. Nothing else in this plan overlaps.

---

## Tasks

### Task 1 — Create `docs/plans/` and land this plan (done by the planning stage)

**Files:** `docs/plans/2026-07-31-todo-290-adapter-snapshot-models-plan.md` (new)
**Verify:** `git -C . log --oneline origin/main..HEAD` shows the plan commit and
`git show --stat HEAD` lists the plan file.

---

### Task 2 — RED: integration test asserting a stale saved default is dropped

**Files:** `packages/core-rs/crates/mainframe-server/tests/chat_default_model_catalog.rs` (new)

Write the test **before** any production change and observe it fail.

Scaffolding, copied in shape from `tests/chat_background_activity.rs` (finding 6):

- File-level `#![allow(clippy::unwrap_used, clippy::expect_used)]` — CI runs
  `cargo clippy --all-targets -- -D warnings` (`.github/workflows/rust-port.yml:31`).
- A module doc comment stating what the test pins: the daemon's production `ChatManagerDeps` must feed the lifecycle's
  default-model normalization the adapter registry's real catalog; a regression to the empty default fails the first
  case.
- `struct NoopQuotaSettings` implementing `mainframe_services::quota::QuotaSettingsStore` (three no-op methods),
  identical to `chat_background_activity.rs:33-43`.
- `struct CatalogAdapter { id: String, models: Vec<AdapterModel> }` implementing `mainframe_adapter_api::Adapter`
  (finding 7): `id()`/`name()` from the field, `capabilities()` → `AdapterCapabilities { plan_mode: false }`,
  `is_installed()` → `Ok(true)`, `get_version()` → `Ok(None)`, `list_models()` → `Ok(self.models.clone())`,
  `get_fallback_models()` → `Some(self.models.clone())`, `create_session()` →
  `unreachable!("the catalog test never starts a session")`, `kill_all()` → `{}`.
- `fn model(id: &str) -> AdapterModel` — the struct has 14 fields (`mainframe-types/src/adapter.rs`); mirror the
  helper in `mainframe-services/src/settings/model_default.rs:29-46`, filling `label` from the id and everything else
  `None`.
- `fn harness(saved_default: Option<&str>, chat_adapter_id: &str) -> Harness` that:
  1. builds `TempDir`, `Db::spawn(|| DatabaseManager::open(Path::new(":memory:")))`, a `broadcast::channel` (keep the
     keepalive receiver bound), a `BackgroundTaskTracker`, and the `QuotaManager`, exactly as `chat_background_activity.rs:55-64`;
  2. builds `let registry = Arc::new(AdapterRegistry::new());`, calls
     `registry.register(Arc::new(CatalogAdapter { id: "catalog-adapter".into(), models: vec![model("model-live"), model("model-also-live")] }))`,
     then `registry.seed_static_snapshots()` — **never** `allow_refresh()` / `refresh_all()`, which would spawn;
  3. creates a project row via `db.call_blocking(|d| d.projects.create(&path, None))`;
  4. when `saved_default` is `Some(v)`, writes it with
     `db.call_blocking(move |d| d.settings.set("provider", &format!("{chat_adapter_id}.defaultModel"), &v))`
     (`mainframe-db/src/settings.rs:46`) — the namespace/key must match `lifecycle_manager.rs:291-293` exactly;
  5. returns the `Arc<ChatManager>` from `build_chat_manager(db, registry, tracker, AttachmentStore::new(...),
     PushService::new(), GitFactory, broadcast, NoopLaunchStopper, NoopScopeTunnelStopper, quota,
     ResolvedPath::from_value("/usr/bin:/bin"))` (signature at `chat_deps.rs:812-827`), plus the project id and the
     `TempDir` guard.

Three `#[tokio::test]` cases, each calling
`manager.create_chat_with_defaults(&project_id, adapter_id, None, None, None, None, None).await`
(signature at `chat_manager.rs:1264-1272`):

1. `stale_saved_default_is_dropped_from_a_new_chat` — saved default `"model-retired"`, adapter `"catalog-adapter"`.
   Assert `chat.model.is_none()`, and additionally `assert_ne!(chat.model.as_deref(), Some("model-retired"))` so the
   failure message names the leaked id. Then assert `manager.get_chat(&chat.id).unwrap().model.is_none()` (D5).
   **This is the case that must fail before Task 4.**
2. `saved_default_present_in_the_catalog_survives` — saved default `"model-live"`, adapter `"catalog-adapter"`.
   Assert `chat.model.as_deref() == Some("model-live")`.
3. `an_adapter_without_a_snapshot_keeps_the_saved_default` — saved default `"model-retired"`, adapter
   `"unregistered-adapter"` (no `register` call for it; finding 8 confirms the DB accepts it). Assert
   `chat.model.as_deref() == Some("model-retired")`, with a comment naming this as the probe-failure escape hatch.

**Verify:**
`cd packages/core-rs && cargo test -p mainframe-server --test chat_default_model_catalog`
→ compiles; case 1 **FAILS** with `chat.model == Some("model-retired")`; cases 2 and 3 pass.
Record the failure output in the task's commit message or the PR body. If case 1 passes at this point, stop: the
harness is not reaching the production deps and the rest of the plan proves nothing.

---

### Task 3 — Implement `adapter_snapshot_models` on `DaemonChatDeps`

**Files:** `packages/core-rs/crates/mainframe-server/src/chat_deps.rs`

Inside `impl ChatManagerDeps for DaemonChatDeps` (starts at `:197`), add the method next to the other
registry-backed members — place it immediately after `create_session` (`:422-431`), which is the closest sibling that
reads `self.adapters`:

```rust
fn adapter_snapshot_models(&self, adapter_id: &str) -> Vec<AdapterModel> {
    self.adapters
        .get_snapshots()
        .into_iter()
        .find(|info| info.id == adapter_id)
        .map(|info| info.models)
        .unwrap_or_default()
}
```

`AdapterModel` is already imported at `chat_deps.rs:60`; no new `use` is needed. An adapter id with no registered
snapshot returns an empty vec, which is the "cannot judge" signal `normalize_saved_default_model` relies on. Do not
filter on `catalog_source` (D1).

**Verify:** `cd packages/core-rs && cargo check -p mainframe-server`.

---

### Task 4 — GREEN: remove the `ChatManagerDeps` default and satisfy the remaining impl

**Files:**
- `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

1. In `chat_manager.rs:287-294`, drop the body and make the method required, replacing the doc comment with the
   house-style rationale used by `tracker_list_live` (`:260-264`):

```rust
/// `adapters.getSnapshots().find(id)?.models ?? []` — the adapter's catalog for
/// the lifecycle default-model normalization. Required, not defaulted: an
/// implementation that silently inherited the empty default made
/// `normalize_saved_default_model`'s probe-failure short-circuit fire on every
/// chat creation, so a retired saved default leaked into new chats (#290).
fn adapter_snapshot_models(&self, adapter_id: &str) -> Vec<mainframe_types::adapter::AdapterModel>;
```

2. `chat_manager/tests.rs:65` (`impl ChatManagerDeps for StoreDeps`) now fails to compile. Add
   `fn adapter_snapshot_models(&self, _adapter_id: &str) -> Vec<AdapterModel> { Vec::new() }` to it. The file does
   **not** currently import `AdapterModel` (`grep -n AdapterModel chat_manager/tests.rs` is empty), so add
   `mainframe_types::adapter::AdapterModel` to its imports or spell the path inline. An empty catalog is correct for
   those tests — they do not
   exercise default-model normalization — and it is now an explicit choice rather than an inherited one.
3. The forwarding impl at `chat_manager.rs:616-621` (`LcDeps`) already satisfies the signature; leave it unchanged.

**Verify:**
- `cd packages/core-rs && cargo test -p mainframe-chat`
- `cd packages/core-rs && cargo test -p mainframe-server --test chat_default_model_catalog` → all three cases pass.

---

### Task 5 — Remove the `LifecycleManagerDeps` default and satisfy its test fake

**Files:** `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs`

1. At `:78-82`, make the method required, keeping the existing first doc line and adding the same
   `Required, not defaulted: … (#290)` rationale:
   `fn adapter_snapshot_models(&self, adapter_id: &str) -> Vec<AdapterModel>;`
2. `impl LifecycleManagerDeps for FakeDeps` (`:1074`) now fails to compile. Add
   `fn adapter_snapshot_models(&self, _adapter_id: &str) -> Vec<AdapterModel> { Vec::new() }`. Those tests
   (`:1193-1360`) cover archive/scope/kill ordering and never create a chat with defaults, so an empty catalog is
   correct and now explicit.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat`.

---

### Task 6 — Log a dropped stale default at `warn`

**Files:** `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs`

In `create_chat_with_defaults`, replace the two-line normalization at `:302-306` so the dropped case is observable.
No toast, no event, no user-visible notice (brief decision):

```rust
if effective_model.is_none()
    && let Some(m) = default_model
{
    let models = self.deps.adapter_snapshot_models(adapter_id);
    effective_model = normalize_saved_default_model(Some(&m), &models);
    if effective_model.is_none() {
        warn!(
            adapter_id,
            configured_model = %m,
            "saved default model is not in the adapter catalog; new chat falls back to the adapter default"
        );
    }
}
```

`lifecycle_manager.rs:14` is already `use tracing::{info, warn};` — no import change is needed. The behavior of
`normalize_saved_default_model` is untouched (AC 5).

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat && cargo test -p mainframe-services`.

---

### Task 7 — Clear the stale ledger note

**Files:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

At `:2148-2151` the PORT STATUS block reads "New defaulted ChatManagerDeps methods still silently unoverridden in
chat_deps.rs (filed as #289 is_transcript_present, #290 adapter_snapshot_models)". Rewrite it to name only
`is_transcript_present` / #289 and to state that `adapter_snapshot_models` is now required and wired in
`chat_deps.rs` (#290), matching how the block already describes `tracker_list_live` / #273. Leave the
`// todos:` counters alone — they count `TODO(port)` markers, not filed issues.

Also refresh the lifecycle PORT STATUS note at `lifecycle_manager.rs:1385-1387` if it still implies the snapshot deps
seam is unwired; its current wording ("a saved default model is normalized against the live snapshot") becomes true
with this change, so no edit is required unless the sentence reads as aspirational after Task 6.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat`; `grep -n "#290" packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`
returns only the new "now required and wired" sentence.

---

### Task 8 — Changeset

**Files:** `.changeset/<generated-name>.md` (new)

Run `pnpm changeset`. Select `@qlan-ro/mainframe-core` (the package whose version the release pipeline reads for the
Rust daemon; the existing `.changeset/adapter-model-catalog-fixes.md` is the precedent for this exact area) with a
**patch** bump. Summary, one sentence, no adjectives:

> A saved provider default model that the adapter no longer offers is dropped when a new chat is created, instead of
> being handed to the CLI as an unknown model id.

**Verify:** the file exists under `.changeset/`, names one package and a bump type, and `git status --short` shows it.

---

### Task 9 — Full verification and PR notes

**Files:** none (verification only)

Run, from `packages/core-rs`:
- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test -p mainframe-server --test chat_default_model_catalog`
- `cargo test -p mainframe-chat`
- `cargo test -p mainframe-services`
- `cargo test -p mainframe-adapter-api` (proves the registry seeding path the test leans on is untouched)

Then confirm each acceptance criterion by name:
- AC 1 — `grep -rn "fn adapter_snapshot_models" packages/core-rs/crates/mainframe-chat/src/` shows two declarations,
  neither with a body.
- AC 2/3/4 — the three cases in `chat_default_model_catalog.rs`.
- AC 5 — `git diff origin/main -- packages/core-rs/crates/mainframe-services/src/settings/model_default.rs` is empty.
- AC 6 — the changeset file.

In the PR description, record the known follow-up lever from the brief: **if a `Fallback` catalog that lags the CLI
starts dropping legitimate saved defaults, gate normalization on `catalog_source == Probed` and treat a fallback
catalog as "cannot judge" (empty).** Not built here (D1). Also note the #289 rebase risk from the sequencing section.

**Verify:** every command above exits 0.

---

## Task-to-group map

| Group | Kind | Tasks | Files |
|---|---|---|---|
| `default-model-catalog-test` | test | 2 | `packages/core-rs/crates/mainframe-server/tests/chat_default_model_catalog.rs` |
| `adapter-snapshot-models-wiring` | core | 3, 4, 5, 6, 7, 8, 9 | `chat_deps.rs`, `chat_manager.rs`, `chat_manager/tests.rs`, `lifecycle_manager.rs`, `.changeset/*` |

The two groups share no files. The wiring group depends on the test group: Task 2's red-phase failure must be observed
against the unfixed production deps, and Tasks 4 and 9 verify against the test file the first group produces.
