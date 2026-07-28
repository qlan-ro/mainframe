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
client-side "allow once emits no rule" invariant with a test, and clears the stale references — the two port notes in
`session.rs` itself that still document the promotion, the flagged mismatch in `docs/adapters/claude/PERMISSIONS.md`,
the consumed-surface row, and the same inverted helper still living in the orphaned Node daemon.

## Findings that shape the plan (verified in this worktree)

1. **Mainframe never writes `.claude/settings.local.json`.** No crate in `packages/core-rs` opens that file
   (`grep -rn "settings.local" --include="*.rs" crates` → only a log-line fixture in `events.rs:1050`). The adapter's
   only act is serializing `updated_permissions` into the `control_response` written to the CLI's stdin
   (`session.rs:967-969`, `:998-1027`); the **CLI** applies each update and persists the ones whose destination
   supports it. The wire payload is therefore the observable surface, and the tests assert on it.
2. **The CLI encodes intent in `destination`, per suggestion kind.** `docs/adapters/claude/PERMISSIONS.md:104-113,
   132-137, 283-291` (binary-verified against 2.1.220): the shell-rule helper hard-codes `localSettings`, the
   file/directory helper defaults to `session`; `session` and `cliArg` are in-memory,
   `userSettings`/`projectSettings`/`localSettings` persist. Which helper a given prompt draws from is the CLI's call
   per command, so the destination on the wire — not the tool name — is the source of truth. The promoter's comment ("the CLI's permission_suggestions always use destination:session") is false.
3. **The damaging case is captured in a real recording.**
   `packages/e2e/fixtures/recordings/plan-approval.0.ndjson:23` — the live `respondToPermission` for the **Edit**
   prompt at `:22`, carrying
   `updatedPermissions: [{"type":"setMode","mode":"acceptEdits","destination":"session"}]`. The `setMode` update rides
   on the Edit prompt's own `suggestions`, not on plan approval: `ExitPlanMode`'s prompt (`:14`) has
   `"suggestions": []` and its response (`:15-16`) carries `executionMode` only. Today the promoter turns
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
- **D3a — The new session-level tests also stay out of `session.rs`,** in a sibling test module
  `src/session/permission_response_tests.rs` declared `#[cfg(test)] mod permission_response_tests;` after the existing
  `mod tests` block. In-repo precedent: `crates/mainframe-chat/src/permission_manager.rs:232` declares
  `mod cancel_tests;` with the body in `permission_manager/cancel_tests.rs`. Adding tests back into the file D3 is
  shrinking would defeat the point.
- **D3b — Two session-level tests, not five.** The wire tests pin what only the call site can pin: that
  `respond_to_permission` runs updates through the dispatch function at all, and the serde spellings the CLI reads
  (`"session"`, `"addRules"`, `"acceptEdits"`). Per-variant coverage belongs in `permission_updates.rs`, where it is a
  pure function call with no serialization or session fixture around it. One verbatim-forward test and one downgrade
  test cover both halves of the wiring.
- **D4 — Fix `packages/core` too** (delete the TS promoter, delete its test) rather than leaving the inverted invariant
  green in CI. It is dead code, but it is *tested* dead code that documents the wrong behavior.
- **D5 — Leave `docs/research/2026-07-25-todo-241-claude-cli-reverse-engineer.md` untouched.** It is a dated,
  point-in-time research record; the living reference docs (`PERMISSIONS.md`, `CONSUMED-SURFACE.md`) carry the current
  state.

## Constraints

- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, and `tools/verify-gate.sh` all gate
  `packages/core-rs` (`.github/workflows/rust-port.yml`). No `unwrap()`/`expect()` outside `#[cfg(test)]`.
- No silent catches; log via `tracing`.
- A changeset is mandatory before commit, and it must bump `@qlan-ro/mainframe-core` — the release pipeline reads the
  version from `packages/core/package.json` and drops any package section filed under a different version (task 8).
- Run Rust tests scoped (`-p mainframe-adapter-claude`); a cold `cargo` build in a worktree grows its own target dir.

---

## Tasks

### Task 1 — (test, red) Stand up the sibling test module and pin a session-scoped rule

**New file:** `packages/core-rs/crates/mainframe-adapter-claude/src/session/permission_response_tests.rs`
**Edit:** `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs` — two mechanical changes, no test bodies
added to the file:

1. Declare the sibling module after the existing `mod tests` block closes (`:1681`) and before the `// PORT STATUS`
   comment (`:1683`): `#[cfg(test)]` then `mod permission_response_tests;`.
2. Widen three helpers inside `mod tests` from private to `pub(super)`: `session()` (`:1262`), `spawned_with_stdin()`
   (`:1383`), `read_json()` (`:1390`). `pub(super)` on an item in `session::tests` makes it visible throughout
   `session` **and its descendants**, which includes `session::permission_response_tests`; a plain private item would
   not be, because the two test modules are siblings.

The new file opens with `use super::*;` (the `cancel_tests.rs` shape) and `use super::tests::{read_json, session,
spawned_with_stdin};`, then imports the payload types **explicitly** rather than through the glob:
`use mainframe_types::adapter::{ControlBehavior, ControlDestination, ControlResponse, ControlRule, ControlUpdate,
RuleBehavior};` and `use mainframe_types::settings::PermissionMode;`. (`ControlRule` and `RuleBehavior` are not in
`session.rs`'s import list at all, and task 4 removes `ControlDestination` from it — leaning on the glob would make
that removal cfg-dependent: unused under `cargo build`, used under `cargo test`. An explicit import shadows a glob
import, so the overlap is legal.)

Each test builds a `ControlResponse` (fields in `crates/mainframe-types/src/adapter.rs:196-212`) with
`behavior: ControlBehavior::Allow`, `updated_input: None`, and `updated_permissions: Some(vec![...])`, calls
`s.respond_to_permission(resp).await`, and reads `payload["response"]["response"]["updatedPermissions"][0]`.

- `always_allow_forwards_a_session_scoped_rule_verbatim` — `ControlUpdate::AddRules { rules: [ControlRule { tool_name:
  "Edit", rule_content: Some("/tmp/**") }], behavior: RuleBehavior::Allow, destination: ControlDestination::Session }`
  → the emitted update's `destination` is `"session"` and `type` is `"addRules"`. **Fails today** (emits
  `"localSettings"`). This is the only test that proves `respond_to_permission` routes updates through the dispatch
  function at all; per-variant behavior is task 3's.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-adapter-claude --lib
always_allow_forwards_a_session_scoped_rule_verbatim` — fails with `localSettings != session`. Record the failure
output; do not fix it here.

### Task 2 — (test, red) Pin that a mode update is never persisted

**File:** the same new `src/session/permission_response_tests.rs`, same seam. One test:

- `set_mode_pointed_at_local_settings_is_forwarded_session_scoped` — `ControlUpdate::SetMode { mode:
  PermissionMode::AcceptEdits, destination: ControlDestination::LocalSettings }` → emitted `destination` is
  `"session"` and `mode` is `"acceptEdits"`. **Fails today** (forwarded as `localSettings`, i.e. the CLI writes an
  `acceptEdits` default mode into the user's repo). The live CLI sends this update with `destination: "session"`, on an
  **Edit** prompt's suggestions (`packages/e2e/fixtures/recordings/plan-approval.0.ndjson:22-23`); pointing it at
  `localSettings` here is what makes the
  test red today and keeps it meaningful after the fix — it is the guard, not the live path.

`PermissionMode` lives in `crates/mainframe-types/src/settings.rs:23-28` (`Default | AcceptEdits | Yolo | Plan`,
`rename_all = "camelCase"`), hence the serialized spelling `"acceptEdits"`.

**Verify:** `cargo test -p mainframe-adapter-claude --lib permission_response_tests` — both tests fail on the
destination assertion. Commit tasks 1-2 together as the red phase.

### Task 3 — (core) Add the dispatch module

**New file:** `packages/core-rs/crates/mainframe-adapter-claude/src/permission_updates.rs` (~110 lines including tests)
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

Implementation: `into_iter().map(...)` with **two nested matches**, each failing in the direction that is safe for it.

```rust
match u {
    ControlUpdate::SetMode { mode, destination } => match destination {
        // In-memory destinations (PERMISSIONS.md:104-113): nothing is persisted, so the update stands.
        ControlDestination::Session | ControlDestination::CliArg => {
            ControlUpdate::SetMode { mode, destination }
        }
        ControlDestination::UserSettings
        | ControlDestination::ProjectSettings
        | ControlDestination::LocalSettings => {
            tracing::warn!(
                ?mode, ?destination,
                "setMode update pointed at a persisting destination; forwarding it session-scoped"
            );
            ControlUpdate::SetMode { mode, destination: ControlDestination::Session }
        }
    },
    // An update kind this adapter does not special-case is forwarded verbatim — the fix's thesis.
    _ => u,
}
```

The two wildcards are deliberately asymmetric:

- **Inner match — exhaustive over `ControlDestination`, no `_`.** The enum has five variants today
  (`crates/mainframe-types/src/adapter.rs:120-126`). A wildcard here would be fail-open on exactly the axis this todo
  is about: a sixth variant added upstream would carry a `setMode` straight to a persisting destination with every test
  below still green. Listing all five makes that addition a compile error, forcing whoever adds it to classify the new
  destination as persisting or in-memory. Do not collapse the two arms into `d if is_persisting(d)`; a guard reopens
  the hole.
- **Outer match — keeps `_ => u`.** Forwarding an unrecognized update *kind* untouched is the fix itself: the update
  reaches the CLI with the destination the CLI chose. Adding a variant upstream cannot escalate scope through this
  function, so a compile error here would buy nothing.

Inline `#[cfg(test)] mod tests` (unwrap/expect allowed here) — this module owns per-variant coverage, asserting on the
returned `ControlUpdate` values:
- `non_set_mode_updates_pass_through_unchanged` — one input `Vec` holding **all five** non-`SetMode` variants at
  `crates/mainframe-types/src/adapter.rs:152-180` (`AddRules`, `ReplaceRules`, `RemoveRules`, `AddDirectories`,
  `RemoveDirectories`), each with a different destination so both the session-scoped and the persisting cases are in
  the same assertion (`Session`, `LocalSettings`, `ProjectSettings`, `Session`, `UserSettings`) →
  `assert_eq!(keep_mode_changes_session_scoped(input.clone()), input)`. `ReplaceRules` was missing from the earlier
  draft of this list. This fixture is coverage, nothing more: a `Vec` literal of struct-variant values still compiles
  when a variant is added to the enum, so it forces no future author's hand. The only compile-time guarantee in this
  module is the exhaustive destination match above;
- `set_mode_keeps_a_session_destination` — `SetMode { AcceptEdits, Session }` unchanged;
- `set_mode_is_downgraded_from_every_persisting_destination` — `SetMode { AcceptEdits, d }` for each of
  `UserSettings`, `ProjectSettings`, `LocalSettings` → `destination` becomes `Session`, `mode` preserved;
- `set_mode_keeps_a_cli_arg_destination` — `SetMode { AcceptEdits, CliArg }` unchanged (`CliArg` is in-memory per
  `PERMISSIONS.md:104-113`, so it must not trip the guard);
- `empty_input_returns_empty_output`.

**Verify:** `cargo test -p mainframe-adapter-claude --lib permission_updates` — all pass.

### Task 4 — (core) Delete the promoter and rewire the call site

**File:** `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs`

1. Delete `promote_to_local_settings` and `promote_one` with their doc comment (`:209-290`).
2. `:967-969` → `serde_json::to_value(keep_mode_changes_session_scoped(up)).unwrap_or(Value::Null)`; import
   `crate::permission_updates::keep_mode_changes_session_scoped`.
3. Drop **both `ControlDestination` and `ControlUpdate`** from the `mainframe_types::adapter` import list at `:37-38`.
   Verified in this worktree: `promote_to_local_settings`/`promote_one` (`:212-281`) are the only users of either name
   in `session.rs`, so step 1 leaves both unused, and the crate gate is
   `cargo clippy --all-targets -- -D warnings` — an unused import is a hard failure, not a warning. The removal is safe
   under `cargo test` too, because task 1's sibling test module imports the payload types explicitly rather than
   through `use super::*`. Leave the other names on those two lines (`AdapterProcess`, `AdapterProcessStatus`,
   `ControlBehavior`, `ControlResponse`, `MessageUsage`, `SessionOptions`, `SessionSpawnOptions`) in place.
4. Update the module doc at `:16-20`: it still lists `respondToPermission (incl. ExitPlanMode/AskUserQuestion
   special-casing + localSettings promotion)` among the behavior "copied verbatim from the TS source". Drop
   `+ localSettings promotion` from that clause and, in the same sentence, note that outbound permission updates keep
   their declared destination and only `setMode` is forced session-scoped (#283) — a deliberate divergence from the TS
   source, which the rest of the paragraph claims there is none of.
5. Update the port note at `:1699-1700` the same way: replace `+ promoteToLocalSettings` with the declared-destination
   statement. This is also the last occurrence of the string `promoteToLocalSettings` under `packages/core-rs`, which
   task 6 must not be left tripping over.

**Verify:**
```
cd packages/core-rs
cargo test -p mainframe-adapter-claude --lib      # tasks 1-2 now green
cargo fmt --check && cargo clippy -p mainframe-adapter-claude --all-targets -- -D warnings
tools/verify-gate.sh
```

### Task 5 — (test) Pin "allow once" against a request that has suggestions

**File:** `packages/ui/src/features/chat/gates/__tests__/build-control-response.test.ts`

Add **one** test to the `buildPermissionResponse` describe, and extend the file header comment with the invariant:

- `"kind='once' omits updatedPermissions even when the request carries suggestions (#283)"` — `entry({ suggestions:
  [SUG] })` with `kind: 'once'` → result equals the allow shape with `updatedInput` only, and
  `expect(res).not.toHaveProperty('updatedPermissions')`. The existing `once` test (`:60-70`) uses `suggestions: []`,
  so it cannot catch a builder that starts attaching them. This is the whole of AC 4's gap.

**Do not add an `always`-forwards-verbatim test — it already exists.** `:72-82` calls
`buildPermissionResponse(entry({ suggestions: [SUG] }), 'always')` and asserts `toEqual({ …, updatedPermissions:
[SUG] })`, and the `SUG` fixture at `:26-31` already carries `destination: 'session'`, so the client-never-rewrites-
the-scope invariant is pinned by an exact-equality assertion today.

No source change: `build-control-response.ts` is correct as-is (finding 4).

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/build-control-response.test.ts
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

### Task 6 — (core) Remove the same inversion from the orphaned Node daemon

**Files:**
- `packages/core/src/plugins/builtin/claude/session.ts` — three edits:
  1. Delete `promoteToLocalSettings` and its doc comment (`:100-108`).
  2. At `:444-446` assign `innerResponse.updatedPermissions = response.updatedPermissions;` directly.
  3. Drop `ControlUpdate` from the `@qlan-ro/mainframe-types` type-import list at `:13`. Verified in this worktree:
     `ControlUpdate` occurs in this file only at `:13` and `:106` (the promoter's signature), so step 1 strands the
     import. Unlike the Rust side, nothing in this task's verification catches it on its own —
     `@typescript-eslint/no-unused-vars` is `'warn'` (`eslint.config.mjs:9`), `eslint --fix` cannot remove an unused
     import, and neither `tsc --noEmit` nor `vitest run` reports one — so the dead import would ship green against the
     repo's "remove dead code" / "No leftovers" rules. The grep in the verify block below is the check that catches it.
     Leave the other names on that list in place.
- `packages/core/src/__tests__/ensure-persistent-rule.test.ts` — delete the file (all five cases assert the inverted
  behavior; the package is superseded and no equivalent behavior remains to test).

Do not port the `setMode` guard here — this daemon is not shipped (root `CLAUDE.md`: kept only for its
`package.json` version); the goal is removing a wrong invariant, not maintaining a second implementation. Note that
choice in the changeset body.

**Verify:**
```
pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit
pnpm --filter @qlan-ro/mainframe-core exec vitest run
grep -rn "promoteToLocalSettings" packages/core/   # no matches
grep -n "ControlUpdate" packages/core/src/plugins/builtin/claude/session.ts   # no matches
```

The grep is scoped to `packages/core/` on purpose: the only other occurrence in the repo is the port note at
`packages/core-rs/crates/mainframe-adapter-claude/src/session.rs:1700`, which task 4 owns. A repo-wide grep here would
fail this task through another group's work and force an ordering edge that this task does not otherwise need.

### Task 7 — (core) Update the living adapter docs

**Files:**
- `docs/adapters/claude/PERMISSIONS.md` — replace the `> **Adapter mismatch (flagged, not fixed).**` blockquote
  (`:293-299`) with a short "Fixed in #283" note: the adapter forwards each update's declared destination
  (`permission_updates::keep_mode_changes_session_scoped`), and a `setMode` update is always forwarded session-scoped.
  In the same paragraph, adjust the trailing guidance at `:290-291` ("rewrite the destination to `session` for an
  ephemeral grant") to state that Mainframe forwards suggestions verbatim, so an ephemeral grant is whatever the CLI
  scoped as `session`. Keep the finding's link to the research doc as history, but name the *new* function only — the
  replacement must not carry `promote_to_local_settings` forward, or this task fails its own verification.
- `docs/adapters/claude/CONSUMED-SURFACE.md:31` (row `CLAUDE-CTRL-04`) — three columns in one edit:
  - *Behavior*: replace "`session`→`localSettings` suggestion-destination rewrite across all six `ControlUpdate`
    variants" with "declared destination forwarded verbatim; `setMode` forced to `session` (#283)".
  - *Code pointer*: replace `{respond_to_permission, promote_to_local_settings}` with
    `src/session.rs::respond_to_permission` + `src/permission_updates.rs::keep_mode_changes_session_scoped`.
  - *Tests*: the column currently reads `none`. Tasks 1-3 create exactly the tests it should name — fill it with
    `src/session/permission_response_tests.rs` (outbound payload) +
    `src/permission_updates.rs::tests` (per-variant dispatch). Leaving `none` behind a PR that adds the coverage is
    the kind of stale row the checklist exists to prevent.

`packages/e2e/scenarios/chat-interactive-cards.md:55,64` already describes verbatim forwarding — no edit; it becomes
true end-to-end with this change.

**Verify:** `grep -rn "promote_to_local_settings" docs/adapters/ packages/` returns no matches. A repo-wide
`grep -rn "promote_to_local_settings" docs/` still returns three dated documents, all of them accepted history that
this task must **not** edit (D5): `docs/research/2026-07-25-todo-241-claude-cli-reverse-engineer.md:127` (the finding
that filed this todo), `docs/plans/2026-07-25-todo-239-changelog-watch-skill-plan.md:283`, and this plan.

### Task 8 — (core) Changeset

**File:** `.changeset/<name>.md`, written by hand (the `pnpm changeset` prompt is interactive) with exactly this
frontmatter:

```
---
'@qlan-ro/mainframe-core': patch
'@qlan-ro/mainframe-app-tauri': patch
---
```

`@qlan-ro/mainframe-core` is required, and it is the half that does the work. `.github/workflows/prepare-release.yml:29`
reads the release version from `packages/core/package.json`, and its consolidation step (`:50-99`) pulls each package's
CHANGELOG section by matching the literal header `## <that version>`, skipping any section whose header differs. The two
packages are versioned independently and have already diverged — core is `2.0.0-rc.13`, app-tauri is `2.0.0-rc.15` — and
`.changeset/config.json` links only types+core, so an app-tauri-only bump would file this entry under `## 2.0.0-rc.16`
while the consolidator looks for `## 2.0.0-rc.14`. The sentence the brief requires — that entries already written into
`.claude/settings.local.json` are not migrated — would never reach the released CHANGELOG. If it were the cycle's only
changeset, core would not move at all and `prepare-release.yml:36-37` would fail on an existing tag.

Do not "correct" this to app-tauri alone to match the neighboring Rust-daemon changesets
(`rust-tunnel-sigpipe-drain.md`, `rust-daemon-port-gaps.md`, `rust-launch-group-kill-separator.md`) — those are the
files this failure mode already swallowed. The precedent to follow is `.changeset/codex-history-unknown-item-types.md`
and `.changeset/codex-quota-boot-warmup.md`: user-visible Rust-daemon fixes filed under core. App-tauri rides along for
shipped-binary attribution; because its header will not match, the entry still surfaces exactly once, via core. This PR
also edits `packages/core` source in task 6, so the core bump is honest on its own terms.

Not an empty changeset: the behavior users see changes. The `--empty` convention in
`.changeset/automations-v2-rust-engine.md` covers Rust work that shipped behind a flag; this does not.

Body: the adapter no longer rewrites permission-update destinations; a session-scoped grant stays in the session and a
mode change is never persisted as the project default. State plainly that **entries already written into
`.claude/settings.local.json` by the old behavior are not migrated or removed** (out of scope per the brief) and that
users who see an unexpected `defaultMode` or rule there can delete it by hand.

**Verify:** `head -5 .changeset/<name>.md` shows both packages at `patch`, with `@qlan-ro/mainframe-core` present;
`git status` shows the file staged with the rest.

---

## Task groups

`parallel_safe` is a file-collision flag; `depends_on` names groups whose *output* this group reads or verifies. The
two are independent — `legacy-ts-cleanup` and `rust-core` share no files, yet the edge below is real.

**This table is the executed graph.** The group names, `kind` values, and `depends_on` edges below are the ones the
lane must run; the JSON block after it is the same graph, transcribed, and any divergence between the two is a bug in
this plan, not a scheduling choice.

| Group | Tasks | Kind | Files | `parallel_safe` | `depends_on` |
|---|---|---|---|---|---|
| `rust-tests-red` | 1, 2 | test | `crates/mainframe-adapter-claude/src/session/permission_response_tests.rs`, `crates/mainframe-adapter-claude/src/session.rs` (module decl + 3 helper visibilities) | false (shares `session.rs` with `rust-core`) | — |
| `rust-core` | 3, 4 | core | `crates/mainframe-adapter-claude/src/permission_updates.rs`, `.../src/lib.rs`, `.../src/session.rs` | false | `rust-tests-red` |
| `ui-regression-test` | 5 | test | `packages/ui/src/features/chat/gates/__tests__/build-control-response.test.ts` | true | — |
| `legacy-ts-cleanup` | 6 | core | `packages/core/src/plugins/builtin/claude/session.ts`, `packages/core/src/__tests__/ensure-persistent-rule.test.ts` | true | — |
| `docs-and-changeset` | 7, 8 | core | `docs/adapters/claude/PERMISSIONS.md`, `docs/adapters/claude/CONSUMED-SURFACE.md`, `.changeset/<name>.md` | true | `rust-core`, `legacy-ts-cleanup` |

`ui-regression-test` is `kind: test` rather than `ui`: task 5 adds one assertion to an existing unit test of a pure
builder function and changes no markup, so it needs the test-authoring lens, not the design-system one (the design gate
already ruled the UI unchanged).

```json
[
  {"name": "rust-tests-red", "tasks": [1, 2], "kind": "test", "parallel_safe": false, "depends_on": []},
  {"name": "rust-core", "tasks": [3, 4], "kind": "core", "parallel_safe": false, "depends_on": ["rust-tests-red"]},
  {"name": "ui-regression-test", "tasks": [5], "kind": "test", "parallel_safe": true, "depends_on": []},
  {"name": "legacy-ts-cleanup", "tasks": [6], "kind": "core", "parallel_safe": true, "depends_on": []},
  {"name": "docs-and-changeset", "tasks": [7, 8], "kind": "core", "parallel_safe": true,
   "depends_on": ["rust-core", "legacy-ts-cleanup"]}
]
```

Why those edges:

- `rust-core` depends on `rust-tests-red` — it turns tasks 1-2 green, and TDD requires seeing them red first.
- `legacy-ts-cleanup` depends on nothing **because its grep is scoped to `packages/core/`** (task 6). A repo-wide
  `grep -rn "promoteToLocalSettings" packages/` would match the `session.rs:1700` port note that only task 4 removes,
  so the group would fail its own verification whenever it ran before `rust-core`. Scoping the grep is preferred over
  adding the edge: it keeps the group independent and the two are genuinely unrelated pieces of work.
- `docs-and-changeset` depends on `rust-core` (task 7's verification greps for the symbol task 4 deletes, and its
  code-pointer and Tests columns name modules tasks 1-3 create) **and** on `legacy-ts-cleanup` (task 8's changeset body
  must state the "the `setMode` guard was not ported to `packages/core`" decision that task 6 produces).

## Final verification (before handing the branch on)

```
cd packages/core-rs && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test -p mainframe-adapter-claude
cd packages/core-rs && tools/verify-gate.sh
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/build-control-response.test.ts
pnpm --filter @qlan-ro/mainframe-ui typecheck
pnpm --filter @qlan-ro/mainframe-core exec tsc --noEmit && pnpm --filter @qlan-ro/mainframe-core exec vitest run
```

Acceptance-criteria map: AC 1 → tasks 2, 3; AC 2 → tasks 1, 3, 4; AC 3 → tasks 3, 4 (task 3's
`non_set_mode_updates_pass_through_unchanged` covers the `localSettings` rule that must still persist); AC 4 → task 5
plus the existing `always` test at `build-control-response.test.ts:72-82`; AC 5 → tasks 1-4; AC 6/7 → resolved as
void-by-architecture above, with the added `warn` in task 3; AC 8 → final verification block.

## Risks

- **Behavior change users will feel.** After this, "Always allow" lasts only as long as the scope the CLI attached to
  that suggestion. File-edit and directory grants arrive `session`, so they last the session; a grant whose suggestion
  declares `localSettings` — `PERMISSIONS.md:132-137` documents `shellRuleMatching.ts` hard-coding it for shell rules —
  still persists. Which suggestions a given prompt carries is the CLI's call per command, so the split is not
  "Bash persists, files don't": the destination on the wire decides. That is parity with the terminal CLI, but it is a
  visible difference from today's (buggy) stickiness, and the PR body must say so.
- **No automated test touches a real `.claude/settings.local.json`.** The tests assert the outbound payload; the file
  writes are the CLI's. That gap is closed by a **required** QA-stage deliverable, not by a note — see "Required QA
  deliverable" below. Do **not** try to close it with an automated live-CLI test: no such harness exists, `session.rs`
  records the standing decision that no unit test spawns a real `claude` (`:1705-1706`), and the E2E suite drives the
  `mock-cli` adapter.
- **Previously promoted entries stay.** Explicitly out of scope; the changeset and PR body must say so.

## Required QA deliverable

The automated tests stop at the outbound `control_response`. The only proof that the fix stops writes into a real
`.claude/settings.local.json` is this manual pass. **The lane must not close without it**, and the QA result must
record the file snapshots (or their diffs) and the logged payloads as evidence.

Do **not** replace it with an automated live-CLI test: `session.rs:1705-1706` records the standing decision that no
unit test spawns a real `claude`, and the E2E suite drives the `mock-cli` adapter.

**Setup.** Create a disposable git repo outside this worktree (`git init /tmp/mf-283-qa`, one committed file), open it
as a Mainframe project against a dev daemon (`MAINFRAME_DATA_DIR=~/.mainframe_dev DAEMON_PORT=31500`), and start a
Claude session in it. Snapshot the baseline: `cp /tmp/mf-283-qa/.claude/settings.local.json /tmp/mf-283-before.json`
(record "absent" if the file does not exist yet).

**Reading the destination off the wire.** Both cases below branch on the destination the CLI actually declared, not on
the tool name. The adapter already logs the outbound payload at `info` (`session.rs:1017-1024`, message `writing
permission response to stdin`), so the declared destination is readable per prompt:

```
grep "writing permission response to stdin" ~/.mainframe_dev/logs/server.$(date +%F).log | tail -1
```

The `payload` field carries the `updatedPermissions` array the CLI receives; each entry's `destination` is the value
that decides whether the CLI persists it.

**Case A — a persisting grant still persists.** Ask the agent to run a shell command it needs permission for (for
example `ls -la`). If the card shows **Always allow**, choose it, then read the logged payload.

- If a suggestion declares a **persisting** destination (`userSettings`, `projectSettings`, `localSettings`):
  `.claude/settings.local.json` (or the settings file that destination names) must gain the rule the card offered.
  Losing it means the fix over-corrected.
- If the CLI offered only **session-scoped** suggestions (`session`/`cliArg`), or the card showed no **Always allow**
  at all, nothing may be written — record the logged suggestion list and mark **Case A not exercised**. This is a
  legitimate outcome, not a failure: which suggestions a prompt carries is the CLI's call per command.
  `PERMISSIONS.md:132-137` documents `shellRuleMatching.ts` hard-coding `localSettings` for shell-rule suggestions, but
  no captured Bash prompt in this repo shows one — `packages/e2e/fixtures/recordings/stress-matrix.0.ndjson:17` is a
  Bash `can_use_tool` whose only suggestion is `{setMode, acceptEdits, session}`, and `PermissionGate` renders "Always
  allow" whenever `suggestions.length > 0`, so a session-only Bash card is reachable. The pass-through half of the
  guarantee is covered regardless by task 3's `non_set_mode_updates_pass_through_unchanged`.

**Case B — a `setMode` suggestion persists nothing.** This is the discriminating reproduction. Snapshot again
(`cp .../settings.local.json /tmp/mf-283-mid.json`; if the file is still absent, record "absent" and read every
"byte-identical" expectation below as "still absent"), then, in the same session, ask for a file edit and choose
**Always allow** on the Edit/Write prompt. That card is the one whose suggestions carry the CLI's `setMode acceptEdits
session` update — `packages/e2e/fixtures/recordings/plan-approval.0.ndjson:22` is the Edit `onPermission` carrying
`suggestions: [{"type":"setMode","mode":"acceptEdits","destination":"session"}]` and `:23` is its response echoing that
update as `updatedPermissions`. On `main` this is what the promoter rewrites to `localSettings`, so it is what mutates
the file today. Expected after the fix: `diff /tmp/mf-283-mid.json /tmp/mf-283-qa/.claude/settings.local.json` is empty
— the file is byte-identical — and it contains **no `defaultMode` key** at any nesting level (`grep -c defaultMode`
→ 0).

**Case B control (not the `setMode` case).** Ask for a plan and approve it. Expected: the file is still byte-identical.
Plan approval never carries `updatedPermissions` at all — `buildPlanResponse`
(`packages/ui/src/features/chat/gates/build-control-response.ts`) sets `executionMode` only, and
`plan_mode_handler.rs:32-34` applies the approved mode through a separate `set_permission_mode` control request
(`session_set_permission_mode`), a path that never reaches `keep_mode_changes_session_scoped`. In the recording,
`ExitPlanMode`'s own prompt (`:14`) has `"suggestions": []` and its response (`:15-16`) carries `executionMode:
"default"` and no `updatedPermissions`. This step proves the mode change does not leak to disk by a second route; it
does **not** exercise the code under test, so it cannot substitute for the Edit prompt above.

**Fail condition.** Any change to the file in case B, or a `defaultMode` key appearing at any point, fails QA and
routes back to the implementer. Reverse-check the baseline too: on `main` (pre-fix), the case B Edit grant *does*
mutate the file — if it does not, the QA environment is not exercising the adapter under test. (The control step is
expected to write nothing on `main` as well; only the Edit grant discriminates.)

**Cleanup.** Delete `/tmp/mf-283-qa` and the snapshots.

**On the persisting-destination downgrade branch specifically (`ControlDestination::UserSettings /
ProjectSettings / LocalSettings` inside `keep_mode_changes_session_scoped`'s `SetMode` arm).** Case B above
reproduces the CLI's actual behavior — `setMode` suggestions arrive `destination: session`
(`plan-approval.0.ndjson:23`) — which exercises the pass-through arm, not the downgrade arm. Getting a real
`claude` binary to emit a `setMode` suggestion pointed at a persisting destination is **not a required QA
step**: two independent live attempts (Write-tool `acceptEdits` suggestion, `ExitPlanMode` approval) both
produced `destination: session`, matching the fixture and `PERMISSIONS.md:104-113`'s documented behavior — the
CLI does not appear to have a code path that emits this today. Record it as **not exercised, legitimate
outcome** (same status as an un-triggered Case A), not a QA failure, and rely on the Rust suite for that arm's
correctness: `permission_updates::tests::set_mode_is_downgraded_from_every_persisting_destination` (all three
persisting variants) and `session::permission_response_tests::set_mode_pointed_at_local_settings_is_forwarded_session_scoped`
(the same case through the actual `respond_to_permission` wire path). Both pass as of this revision
(`cargo test -p mainframe-adapter-claude`, `cargo clippy -p mainframe-adapter-claude --all-targets -- -D
warnings` — clean). If the CLI is later observed emitting this destination for `setMode`, that observation is
new evidence for a follow-up QA pass, not grounds to hold this one open.
