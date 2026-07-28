# Todo #283 — Honor the Claude CLI's permission destinations

**Branch:** `todo/283-permission-destination-inversion` · **Worktree:** `.worktrees/todo-283-permission-destination-inversion`
**Route:** no-spec (works from the approved Agent Brief + design direction on todo #283)

## Goal

The Claude adapter rewrites every permission update the CLI hands back from `destination: "session"` to
`destination: "localSettings"` before echoing it in the `control_response`. The CLI then persists that update to
`<repo-root>/.claude/settings.local.json`, so an update the CLI scoped to the running session outlives it — most
damagingly a `setMode` update, which lands as the project's default permission mode. This plan removes the rewrite so
each update is forwarded with the destination it declares, adds one narrow invariant on top (a mode change is never
forwarded to a persisting destination, because making a mode the project default must be a deliberate act), pins the
client-side "allow once emits no rule" invariant with a test, and clears the stale references — the flagged mismatch in
`docs/adapters/claude/PERMISSIONS.md`, the consumed-surface row, and the same inverted helper still living in the
orphaned Node daemon.

## Findings that shape the plan (verified in this worktree)

1. **Mainframe never writes `.claude/settings.local.json`.** No crate in `packages/core-rs` opens that file
   (`grep -rn "settings.local" --include="*.rs" crates` → only a log-line fixture in `events.rs:1050`). The adapter's
   only act is serializing `updated_permissions` into the `control_response` written to the CLI's stdin
   (`session.rs:967-969`, `:998-1027`); the **CLI** applies each update and persists the ones whose destination
   supports it. The wire payload is therefore the observable surface, and the tests assert on it.
2. **The CLI encodes intent in `destination`, per suggestion kind.** `docs/adapters/claude/PERMISSIONS.md:104-113,
   132-137, 283-291` (binary-verified against 2.1.220): Bash/shell suggestions arrive `localSettings`, file/directory
   suggestions arrive `session`; `session` and `cliArg` are in-memory, `userSettings`/`projectSettings`/`localSettings`
   persist. The promoter's comment ("the CLI's permission_suggestions always use destination:session") is false.
3. **The damaging case is captured in a real recording.**
   `packages/e2e/fixtures/recordings/plan-approval.0.ndjson:23` — a live `respondToPermission` carrying
   `updatedPermissions: [{"type":"setMode","mode":"acceptEdits","destination":"session"}]`. Today the promoter turns
   that into `localSettings`, i.e. the CLI writes an `acceptEdits` default mode into the user's repo. This is the
   brief's headline case, and it is reproducible from the fixture.
4. **The client is already correct and must stay that way.**
   `packages/ui/src/features/chat/gates/build-control-response.ts:11-16` attaches `updatedPermissions` only for
   `kind === 'always'`, echoing `request.suggestions` untouched. Nothing in `packages/ui` constructs a `setMode`
   update. `PermissionGate.tsx` renders "Always allow" only when `suggestions.length > 0`. **No UI change** — the design
   gate ruled on 2026-07-28 that the three existing labels become literally true once the adapter stops rewriting.
5. **The same inverted helper survives in the orphaned Node daemon.**
   `packages/core/src/plugins/builtin/claude/session.ts:100-108,445` plus a test that pins the wrong behavior
   (`packages/core/src/__tests__/ensure-persistent-rule.test.ts`). That package is superseded by the Rust daemon but
   still typechecked and tested in CI (`.github/workflows/ci.yml:49,63`), so the wrong invariant is still green and
   re-portable.

## Ambiguities resolved (carried into the report)

- **AC 6 ("writing preserves keys the app does not own") and AC 7 ("a write failure logs at warn with the path and
  reason") describe a write Mainframe does not perform** (finding 1). They are satisfied structurally: after this change
  the app never asks for a persisted write it was not told to make, and the CLI owns the merge. Nothing is silently
  swallowed — the outbound payload is already logged at info (`session.rs:1017-1024`) and a dropped response logs at
  error (`:1009-1014`); this plan adds a `warn` on the one case where the adapter alters what the user's CLI receives
  (a mode update pointed at a persisting destination). **Do not add a settings-file writer to satisfy these two
  criteria** — it would invent the very coupling the bug came from.
- **AC 5 says "assert on what lands in the settings file."** Translated to "assert on the `control_response` written to
  the CLI's stdin", which is the last thing Mainframe controls, and is a real end-to-end assertion via the existing
  capturable-stdin test seam (`session.rs:1382-1393`).
- **AC 4's regression test partly exists** (`build-control-response.test.ts:60-70`) but only for a request with **no**
  suggestions, so it cannot fail if the builder started attaching them. Task 5 adds the case that can.

## Design decisions

- **D1 — Delete the promoter; do not make it conditional.** Per the brief's recommendation. A conditional promoter is a
  function whose purpose is to override a declared scope.
- **D2 — Keep one narrow, variant-driven rule: a `setMode` update is never forwarded to a persisting destination.** It
  is downgraded to `session` (the mode still applies to the running session; it just stops becoming the project
  default), and the downgrade logs at `warn`. This is required by AC 1 and by the brief's "not implicitly, ever"
  decision; the discrimination comes from the update's own variant, not a call-site heuristic. Today's CLI sends
  `setMode` with `session` (finding 3), so the guard is an invariant against an external process's future output, not a
  live rewrite path.
- **D3 — The dispatch rule lives in a new module,** `crates/mainframe-adapter-claude/src/permission_updates.rs`, not in
  `session.rs` (1706 lines, already far past the 300-line rule). The module is small, pure, and unit-testable on its
  own; `session.rs` shrinks by ~80 lines.
- **D4 — Fix `packages/core` too** (delete the TS promoter, delete its test) rather than leaving the inverted invariant
  green in CI. It is dead code, but it is *tested* dead code that documents the wrong behavior.
- **D5 — Leave `docs/research/2026-07-25-todo-241-claude-cli-reverse-engineer.md` untouched.** It is a dated,
  point-in-time research record; the living reference docs (`PERMISSIONS.md`, `CONSUMED-SURFACE.md`) carry the current
  state.

## Constraints

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `tools/verify-gate.sh` all gate
  `packages/core-rs` (`.github/workflows/rust-port.yml`). No `unwrap()`/`expect()` outside `#[cfg(test)]`.
- No silent catches; log via `tracing`.
- A changeset is mandatory before commit.
- Run Rust tests scoped (`-p mainframe-adapter-claude`); a cold `cargo` build in a worktree grows its own target dir.

---

## Tasks

### Task 1 — (test, red) Pin the outbound destination for rule updates

**File:** `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs` (inside `#[cfg(test)] mod tests`, after
`stop_background_task_writes_stop_task_control_request`)

Add a helper and two tests. Use the existing seam: `session()`, `spawned_with_stdin(&s)`, `read_json(&mut rx)`
(`:1262-1393`). Build a `ControlResponse` (fields in
`crates/mainframe-types/src/adapter.rs:196-212`) with `behavior: ControlBehavior::Allow`, `updated_input: None`, and
`updated_permissions: Some(vec![...])`, call `s.respond_to_permission(resp).await`, and read
`payload["response"]["response"]["updatedPermissions"]`.

- `always_allow_forwards_a_session_scoped_rule_verbatim` — `ControlUpdate::AddRules { rules: [ControlRule { tool_name:
  "Edit", rule_content: Some("/tmp/**") }], behavior: RuleBehavior::Allow, destination: ControlDestination::Session }`
  → the emitted update's `destination` is `"session"` and `type` is `"addRules"`. **Fails today** (emits
  `"localSettings"`).
- `always_allow_forwards_a_local_settings_rule_unchanged` — the same update with
  `destination: ControlDestination::LocalSettings` → emitted `destination` stays `"localSettings"`. **Passes today**;
  it is the guard that the fix does not over-correct (AC 3).

**Verify:** `cd packages/core-rs && cargo test -p mainframe-adapter-claude --lib always_allow` — the first test fails
with `localSettings != session`, the second passes. Record the failure output; do not fix it here.

### Task 2 — (test, red) Pin that a mode update is never persisted

**File:** same test module, same seam.

- `set_mode_update_is_forwarded_session_scoped` — `ControlUpdate::SetMode { mode: PermissionMode::AcceptEdits,
  destination: ControlDestination::Session }` (the shape captured in
  `packages/e2e/fixtures/recordings/plan-approval.0.ndjson:23`) → emitted `destination` is `"session"`, `mode` is
  `"acceptEdits"`. **Fails today.**
- `set_mode_update_pointed_at_local_settings_is_downgraded` — the same update with
  `destination: ControlDestination::LocalSettings` → emitted `destination` is `"session"`. **Fails today** (forwarded
  as `localSettings`).
- `always_allow_forwards_add_directories_verbatim` — `ControlUpdate::AddDirectories { directories: ["/tmp/x"],
  destination: ControlDestination::Session }` → emitted `destination` is `"session"`. **Fails today.**

`PermissionMode` lives in `crates/mainframe-types/src/settings.rs:23-28` (`Default | AcceptEdits | Yolo | Plan`,
`rename_all = "camelCase"`), so the test module needs `use mainframe_types::settings::PermissionMode;` and the
assertions use the serialized spelling `"acceptEdits"`.

**Verify:** `cargo test -p mainframe-adapter-claude --lib set_mode_update` and `... --lib add_directories` — all three
fail on the destination assertion. Commit tasks 1-2 together as the red phase.

### Task 3 — (core) Add the dispatch module

**New file:** `packages/core-rs/crates/mainframe-adapter-claude/src/permission_updates.rs` (~90 lines including tests)
**Edit:** `packages/core-rs/crates/mainframe-adapter-claude/src/lib.rs` — add `pub mod permission_updates;` in
alphabetical order (between `messages` and `plan_mode_handler`).

```rust
//! Outbound permission updates: forward each update to the destination it
//! declares. The CLI encodes the user's intent there (PERMISSIONS.md) — Bash
//! suggestions arrive `localSettings`, file/directory suggestions arrive
//! `session` — and it is the CLI, not Mainframe, that persists them.

use mainframe_types::adapter::{ControlDestination, ControlUpdate};   // same paths session.rs:36-39 uses

/// A mode change never becomes the project default implicitly (#283): making a
/// permission mode persistent is a deliberate act in settings, not a side effect
/// of answering one prompt. Every other update keeps its declared destination.
pub fn keep_mode_changes_session_scoped(updates: Vec<ControlUpdate>) -> Vec<ControlUpdate> { ... }
```

Implementation: `into_iter().map(...)`; match only `ControlUpdate::SetMode { mode, destination }` where `destination`
is one of `UserSettings | ProjectSettings | LocalSettings`, emit `SetMode { mode, destination:
ControlDestination::Session }` and
`tracing::warn!(?mode, ?destination, "setMode update pointed at a persisting destination; forwarding it session-scoped")`;
every other arm returns the update unchanged (`_ => u`, so a new variant is forwarded verbatim by default).

Inline `#[cfg(test)] mod tests` (unwrap/expect allowed here) — one test per behavior, asserting on the returned
`ControlUpdate` values:
- session-scoped `AddRules` unchanged;
- `localSettings` `AddRules` unchanged;
- `SetMode { Session }` unchanged;
- `SetMode { LocalSettings }` → `Session`, mode preserved;
- `SetMode { ProjectSettings }` → `Session`;
- `AddDirectories`/`RemoveDirectories`/`RemoveRules` with any destination unchanged;
- empty input → empty output.

**Verify:** `cargo test -p mainframe-adapter-claude --lib permission_updates` — all pass.

### Task 4 — (core) Delete the promoter and rewire the call site

**File:** `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs`

1. Delete `promote_to_local_settings` and `promote_one` with their doc comment (`:209-290`).
2. `:967-969` → `serde_json::to_value(keep_mode_changes_session_scoped(up)).unwrap_or(Value::Null)`; import
   `crate::permission_updates::keep_mode_changes_session_scoped`.
3. Drop `ControlDestination` from the `mainframe_types::adapter` import list at `:37` if it is now unused (compiler
   will say).
4. Update the port note at `:1699-1700`: replace `+ promoteToLocalSettings` with a line stating that outbound
   permission updates keep their declared destination and only `setMode` is forced session-scoped (#283).

**Verify:**
```
cd packages/core-rs
cargo test -p mainframe-adapter-claude --lib      # tasks 1-2 now green
cargo fmt --check && cargo clippy -p mainframe-adapter-claude --all-targets -- -D warnings
tools/verify-gate.sh
```

### Task 5 — (test) Pin "allow once" against a request that has suggestions

**File:** `packages/ui/src/features/chat/gates/__tests__/build-control-response.test.ts`

Add to the `buildPermissionResponse` describe, and extend the file header comment with the invariant:

- `"kind='once' omits updatedPermissions even when the request carries suggestions (#283)"` — `entry({ suggestions:
  [SUG] })` with `kind: 'once'` → result equals the deny/allow shape with `updatedInput` only, and
  `expect(res).not.toHaveProperty('updatedPermissions')`. The existing `once` test uses `suggestions: []`, so it cannot
  catch a builder that starts attaching them.
- `"kind='always' forwards suggestions verbatim, destination included"` — `entry({ suggestions: [SUG] })` where `SUG`
  has `destination: 'session'` → `res.updatedPermissions` is `[SUG]` and
  `res.updatedPermissions?.[0]` still carries `destination: 'session'`. Pins that the client never rewrites the scope
  either.

No source change: `build-control-response.ts` is correct as-is (finding 4).

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/build-control-response.test.ts
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

### Task 6 — (core) Remove the same inversion from the orphaned Node daemon

**Files:**
- `packages/core/src/plugins/builtin/claude/session.ts` — delete `promoteToLocalSettings` and its doc comment
  (`:100-108`); at `:444-446` assign `innerResponse.updatedPermissions = response.updatedPermissions;` directly.
- `packages/core/src/__tests__/ensure-persistent-rule.test.ts` — delete the file (all five cases assert the inverted
  behavior; the package is superseded and no equivalent behavior remains to test).

Do not port the `setMode` guard here — this daemon is not shipped (root `CLAUDE.md`: kept only for its
`package.json` version); the goal is removing a wrong invariant, not maintaining a second implementation. Note that
choice in the changeset body.

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit
pnpm --filter @qlan-ro/mainframe-core exec vitest run
grep -rn "promoteToLocalSettings" packages/   # no matches
```

### Task 7 — (core) Update the living adapter docs

**Files:**
- `docs/adapters/claude/PERMISSIONS.md` — replace the `> **Adapter mismatch (flagged, not fixed).**` blockquote
  (`:293-299`) with a short "Fixed in #283" note: the adapter forwards each update's declared destination
  (`permission_updates::keep_mode_changes_session_scoped`), and a `setMode` update is always forwarded session-scoped.
  In the same paragraph, adjust the trailing guidance at `:290-291` ("rewrite the destination to `session` for an
  ephemeral grant") to state that Mainframe forwards suggestions verbatim, so an ephemeral grant is whatever the CLI
  scoped as `session`. Keep the finding's link to the research doc as history.
- `docs/adapters/claude/CONSUMED-SURFACE.md:31` (row `CLAUDE-CTRL-04`) — replace
  "`session`→`localSettings` suggestion-destination rewrite across all six `ControlUpdate` variants" with
  "declared destination forwarded verbatim; `setMode` forced to `session` (#283)", and update the code pointer from
  `{respond_to_permission, promote_to_local_settings}` to
  `src/session.rs::respond_to_permission` + `src/permission_updates.rs`.

`packages/e2e/scenarios/chat-interactive-cards.md:55,64` already describes verbatim forwarding — no edit; it becomes
true end-to-end with this change.

**Verify:** `grep -rn "promote_to_local_settings" docs/ packages/` returns only the dated research doc (D5).

### Task 8 — (core) Changeset

**File:** `.changeset/<name>.md` via `pnpm changeset` — **patch** on `@qlan-ro/mainframe-app-tauri`, the package that
ships the Rust daemon this fix lives in. (Not an empty changeset: the behavior users see changes. The `--empty`
convention in `.changeset/automations-v2-rust-engine.md` applies to Rust work that shipped behind a flag; this does
not.) Body: the adapter no
longer rewrites permission-update destinations; a session-scoped grant stays in the session and a mode change is never
persisted as the project default. State plainly that **entries already written into `.claude/settings.local.json` by
the old behavior are not migrated or removed** (out of scope per the brief) and that users who see an unexpected
`defaultMode` or rule there can delete it by hand.

**Verify:** `ls .changeset/*.md` shows the new file; `git status` shows it staged with the rest.

---

## Final verification (before handing the branch on)

```
cd packages/core-rs && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test -p mainframe-adapter-claude
cd packages/core-rs && tools/verify-gate.sh
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/build-control-response.test.ts
pnpm --filter @qlan-ro/mainframe-ui typecheck
pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit && pnpm --filter @qlan-ro/mainframe-core exec vitest run
```

Acceptance-criteria map: AC 1 → tasks 2, 3; AC 2 → tasks 1, 3, 4; AC 3 → tasks 1, 4; AC 4 → task 5; AC 5 → tasks 1-4;
AC 6/7 → resolved as void-by-architecture above, with the added `warn` in task 3; AC 8 → final verification block.

## Risks

- **Behavior change users will feel.** After this, "Always allow" on a file edit or a directory grant lasts for the
  session only, because that is the scope the CLI attaches to those suggestions; Bash grants still persist. That is
  parity with the terminal CLI (`PERMISSIONS.md:132-137`), but it is a visible difference from today's (buggy)
  stickiness, and the PR body must say so.
- **No live-CLI verification in this lane.** The tests assert the outbound payload, not the CLI's resulting file writes.
  A manual QA pass — answer "Always allow" on a Bash prompt and confirm the rule appears in
  `.claude/settings.local.json`, then answer one on an Edit prompt and confirm nothing is written — is worth doing at
  the QA stage.
- **Previously promoted entries stay.** Explicitly out of scope; the changeset and PR body must say so.
