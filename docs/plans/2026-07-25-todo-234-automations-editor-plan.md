# Todo #234 — Workflows: automations editor — implementation plan

**Spec:** the agent brief + approved `## Design direction` in the todo body (`/tmp/pipeline-run-2026-07-25/234.md`); the design direction was rewritten by explicit user override and is authoritative where the two disagree. Prototype artifact: branch `proto/design-gates` @ `cee842ef`, `packages/ui/src/prototypes/automations-editor/` (variant A won).
**Branch:** `todo/234-automations-editor` (worktree `.worktrees/todo-234-automations-editor`). Never touch `main`.

## Goal

Rebuild the automations editor's step panes on the app's real interaction vocabulary. The agent step becomes a compact card whose prompt field **is** the chat composer — a real autosizing textarea with the composer's `/` skills and `@` files triggers plus a new `$` variables trigger, all inserting literal text (no chips) — with model/permission/worktree as toolbar chips and one advanced disclosure. To make one trigger engine serve both the chat composer and plain automations textareas, the assistant-ui trigger machinery is lifted into an app-owned engine generic over `(text, cursor)` state (Route 1); the chat composer becomes one caller of it. The chip-based `ChipField` is deleted (its editing defect dies with it); variable references become by-name `$name` literals with rename-rewrite and save-time unresolved-reference errors; a new set-value step defines named variables; and the secondary surfaces get their settled treatments — schedule Preset | Custom time | One-off, event-trigger automation filter, truthful webhook registration. Contract changes are additive: `{type:'once', at}` schedule pattern, `WebhookTrigger.registration?`, `set_variable` step — mirrored in the Rust daemon (`packages/core-rs`), which also gains `$name` substitution at run time. (The brief's "parity across BOTH daemon implementations" predates the Node daemon's retirement in `a8d1a561`; Rust-only parity is the correct reading.)

## Decisions taken (flagged for the orchestrator's report)

1. **Route 1 chosen** (lift the trigger machinery; composer becomes one caller). Verified against the installed `@assistant-ui/react@0.14.27` sources: the engine's coupling to the composer runtime is exactly three narrow touchpoints — text read (`useAuiState(s => s.composer.text)` in `TriggerPopover`), text write (`aui.composer().setText` in `triggerSelectionResource`), and cursor/keydown/Escape fed through `ComposerPrimitive.Input`'s plugin registry. Detection, navigation, and keyboard logic are pure over `(text, cursorPosition)`. Our adapters (`skills-trigger-adapter.ts`, `mention-adapter.ts`) and formatters are already library-decoupled. A home-grown engine is bounded (~6 small modules) and **eliminates three workarounds** the library forced on us: `dropDirectoryClosingSpace` (we control insertion), `TriggerCloseCapture` mouse-pick force-close (we re-sync cursor on insert), and the `__internal_getRuntime` stale-read hack (we own the text state). Route 2 (headless composer runtime per field) is not needed. The `@assistant-ui/react` pin stays at exactly `0.14.27`; after the composer migration the app keeps exactly one `Unstable_TriggerPopoverRoot` mount (the plugin-registry host, T10) and zero trigger declarations, shrinking the unstable-API surface.
2. **`$` namespace semantics** (the direction says "the step's in-scope variables" without defining names for unnamed outputs): naming is a two-stage contract. `variableNameFor` derives a stable base identifier per `TokenDescriptor` (set-variable → its user-chosen name; `expects`/`ask_me` keys as-is; unnamed outputs get `trigger_result` / `agent_result`-style derived names). `buildVariableNamespace` then assigns final names over the **in-scope descriptor list at the referencing step** — `scopeAt`'s output, in its order, the walk that already models if-branch leak and repeat-body isolation: the first holder keeps the base name; later derived-name collisions get `_2`, `_3` suffixes (two agent steps → `agent_result`, `agent_result_2`; lossy sanitization collisions like ask_me keys `PR list` vs `pr-list` suffix the same way), so every in-scope step stays addressable. Names are position-dependent exactly where scope is: after `[repeat[agent A], agent B]`, B is `agent_result` (A is invisible outside the body); inside the body, A is. TS (`scopeAt`) and Rust (the `domain/validate.rs::walk` semantics) use the same scope walk, so editor names and runtime resolution can never disagree — a flat full-definition sweep would name repeat-body steps that leak nowhere and silently shift suffixes. Duplicate *set-variable* names are never silently suffixed: **first occurrence wins** in the namespace, and validation errors the duplicate (T3). Accepted limitation: inserting a step can shift later suffixes; stale refs then fail save-time validation instead of silently rebinding. The picker shows which concrete step each name resolves to. The Rust runtime index (T6) is the same per-step assignment, precomputed once per run as a per-step map.
3. **Dotted digging**: ref syntax is `\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*`. A trailing bare period is never consumed (`$release_notes.` resolves the variable, period stays text — the direction's rule). Dotted suffixes use the **existing dig semantics** (`tokens/scope.rs::dig` → `substitute.rs::render`): a resolved base name with a failed dig renders empty, exactly as legacy field-dug tokens do today — so T4's conversion of `{token, field:'pr.title'}` to `$trigger_payload.pr.title` changes nothing at run time. Literal pass-through applies only to an **unresolved base name**. Validation checks only the base name (payload shapes are unknowable statically). Both cases (failed dig → empty; unknown base → literal) are pinned in `variable-substitution.json`.
4. **"Set value" bullet's chip language is stale**: the secondary-surfaces bullet still says "violet token … relabels its chips live" — pre-override residue the override explicitly retires. Resolved in the override's favor: the `⟨⟩` picker and the `$` trigger both insert literal `$name`; rename rewrites text occurrences.
5. **Contract shape for text fields**: prompt/message/params stay `ChipText` on the wire (a `["plain string"]` array is already valid — zero contract change, mobile-safe). The editor emits single-string parts; on load it upgrades legacy `{token}` parts to `$name` text via `variableNameFor`. The Rust `render()` keeps resolving legacy token parts unchanged and gains a `$name` pass over text parts, so old saved automations keep running.
6. **Webhook Register is a real (small) daemon route.** The brief said don't block on backend; the later approved direction specifies a Register button with busy state. The Rust plumbing (per-hook secret store, ingest route scanning definitions) makes registration small: persist per-hook delivery state, arm the secret, return the URL. Included as bounded Rust tasks (T7).
7. **If-condition rows and repeat item pickers keep the structural `TokenRef` model** — they are pickers, not text; the by-name model applies to text fields only. `TokenChip`/`TokenPicker` survive for those surfaces.
8. **`MoreOptions` survives for AskMe/Notify.** `steps/MoreOptions.tsx` is still the disclosure in `AskMeConfig.tsx` (12, 72) and `NotifyConfig.tsx` (12, 37); the agent pane's `AdvancedSection` replaces it only there. Converting AskMe/Notify to `AdvancedSection` is out of scope; only `steps/AgentModelPicker.tsx` is deleted (T16).
9. **Rename-rewrite covers set-variable names only** — the direction's requirement is verbatim about Set-value renames. Renaming an `ask_me` field key or an agent `expects` key does NOT rewrite `$name` refs; the stale ref surfaces as a save-time unresolved-variable error, pinned by a T22 test. Extending rewrite to those edit paths is deliberate future work, not an oversight.

## Constraints threaded through every task

- 300 lines/file, 50/function — split points are named below where a file is near the limit (`packages/types/src/automation.ts` at 245, `automation-domain/tokens.ts` at 260, `AutomationEditor.tsx` at 264).
- `data-testid` on every interactive element, `<surface>-<element>` kebab-case, keyed by domain id.
- Tailwind v4 in `packages/ui`; only real tokens (`--mf-auto-violet` exists; **no phantom `mf-*`**); integer spacing is compressed — the spec's px values use `[Npx]` arbitrary values.
- Zod is N/A (Rust daemon); Rust routes use `parse_body` + `deny_unknown_fields` structs and the `ok`/`fail` envelope from `routes/automations.rs`.
- Additive contract only: new TS fields optional; new Rust fields `Option` + `skip_serializing_if` so the 6 canonical fixtures in `packages/types/fixtures/automations/*.json` still round-trip byte-identically (`fixture_tests` in `domain/mod.rs`).
- TDD: each task writes the failing test first (sub-step **a**), then implements (**b**).
- Verification commands per task; UI suites run single-file (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`); Rust via `cargo test -p <crate> <filter>` from `packages/core-rs`.

## Suggested PR grouping

- **PR 1** — Phase A + B (TS contract + domain, Rust parity + engine substitution + webhook registration). Daemon accepts and runs everything the UI will produce.
- **PR 2** — Phase C (trigger-engine lift + composer migration, behavior-parity).
- **PR 3** — Phase D + E (TriggerTextField, ChipField deletion, agent step pane).
- **PR 4** — Phase F (schedule / event / webhook surfaces).
- **PR 5** — Phase G (set-value step UI + rename-rewrite + validation surfacing).
- **PR 6** — T17 (MiniSelect retirement + shared-primitive inventory). Mechanical, wide churn; keeping it out of PR 3 keeps that diff reviewable. Merges after PR 3 and PR 4 — T17.5's `MiniSelect`-zero grep needs T16, T18, and T19 landed.

Phases A→B and C are independent; D depends on both. Within a phase, tasks are ordered by dependency.

---

## Phase A — shared TS contract + domain (packages/types)

### T1. Contract additions: `once` schedule, `registration`, `set_variable`

**Files:** `packages/types/src/automation.ts`; tests in `packages/types/src/automation-domain/__tests__/` (new `contract-additions.test.ts`).

a. Failing test asserting: `SchedulePattern` accepts `{type:'once', at:'2026-08-01T14:00'}`; `WebhookTrigger` accepts optional `registration: {hookId: string; url: string; lastDeliveryAt: string | null}`; step union accepts `{kind:'set_variable', id, name: string, value: ChipText}` (type-level via `expectTypeOf` or runtime via a typed fixture literal).
b. Implement:
   - `SchedulePattern` (lines 122-126): add `| {type: 'once'; at: string}` — `at` is a naive-local `YYYY-MM-DDTHH:MM` string (the `datetime-local` input format; the daemon's `scheduled_for_string` carries seconds and is NOT the same format — T7 defines the dedup key).
   - `WebhookTrigger` (154-159): add `registration?: {hookId: string; url: string; lastDeliveryAt: string | null}`. Server-computed on read; the daemon ignores it on write.
   - New `SetVariableStep {kind:'set_variable'; id: string; name: string; value: ChipText}`; add to `AutomationStep` union (line 120).
   - If the file crosses 300 lines, split the step interfaces into `packages/types/src/automation-steps.ts` re-exported from `automation.ts` (keep the public import path stable).

**Verify:** `pnpm --filter @qlan-ro/mainframe-types build` and `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/automation-domain/__tests__/contract-additions.test.ts`.

### T2. Variables domain module: tokenizer, naming, namespace, rename

**Files:** new `packages/types/src/automation-domain/variables.ts` (+ export from the domain index); new test `packages/types/src/automation-domain/__tests__/variables.test.ts`.

a. Failing tests (hardcoded expectations, not recomputed):
   - `extractVariableRefs('Ship $release_notes. Now')` → `[{name:'release_notes', path:[], start:5, end:19}]` (trailing period NOT consumed).
   - `extractVariableRefs('Dig $trigger_payload.pr.title x')` → one ref, `name:'trigger_payload'`, `path:['pr','title']`.
   - `$1abc` does not match (must start with letter/underscore); `a$b` mid-word does not match (must be preceded by start/whitespace — same word-boundary rule as trigger detection).
   - `variableNameFor` per descriptor: builtin `now`→`now`; trigger output `result`→`trigger_result`, `chatId`→`trigger_chat_id`, `payload`→`trigger_payload`; agent implicit `result`→`agent_result`; agent `expects` key `pr_list`→`pr_list`; ask_me field key as-is; run_action catalog output key as-is; repeat item→`item`; set-variable→its `name`. Sanitization: lowercase, non-`[a-z0-9_]`→`_`, prepend `_` if it would start with a digit.
   - `buildVariableNamespace(descriptors)` → `Map<string, TokenDescriptor>` **plus the paired inverse `nameFor(ref)`** (ref → assigned name; exported — T4's conversion, T11's item descriptions, and T13's picker all need it, and three re-derivations would trip the 3+-duplication rule); names assigned in the input list's order (callers pass `scopeAt(...)` output, so assignment follows scope order); derived-name collisions suffix later holders (two agent steps → `agent_result`, `agent_result_2` — pinned); lossy-sanitization collisions (ask_me keys `PR list` and `pr-list`) suffix the same way; duplicate set-variable names are NOT suffixed — **first-wins** in the map (pinned), validation errors the duplicate (T3); repeat isolation pinned: for `[repeat[agent A], agent B]`, the namespace at a step after the block names B `agent_result`; inside the body, A holds it.
   - `renameVariableRefs(text, 'old', 'new')` rewrites `$old` and `$old.path` but not `$older` (boundary) nor `$old` inside a longer identifier.
   - `renameVariableInDefinition(definition, oldName, newName)` rewrites every string part of every `ChipText` field in all steps (prompt, worktree branchName, notify message, run_action params, set_variable value), including inside `if`/`repeat` blocks; returns a new definition.
b. Implement. Ref regex: `/(^|[\s])\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)/g` equivalent (implemented as a scanner so `start`/`end` are exact). Keep the file well under 300 lines; if rename traversal grows, split it into `variables-rename.ts`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/automation-domain/__tests__/variables.test.ts`.

### T3. Domain function extensions: set_variable + once + unresolved-`$name` validation

**Files:** `packages/types/src/automation-domain/tokens.ts` (`stepProduces` line 191, `stepLabel` 157, `TokenSourceKind` line 24), `token-scope.ts`, `validate.ts` (`collectTokenRefs` line 19, `validate`), `trigger-summary.ts`; existing tests `__tests__/tokens.test.ts`, `__tests__/token-scope.test.ts`, `__tests__/trigger-summary.test.ts`, plus UI-side `packages/ui/src/features/automations/domain/__tests__/validate.test.ts` (validate's test lives UI-side).

a. Failing tests:
   - `stepProduces(setVariableStep)` → `[{stepId, output:'value', label: step.name, sourceKind:'variable'}]`.
   - `stepLabel` for set_variable → `Set ${name}`.
   - `scopeAt` includes the set-variable descriptor for downstream steps only.
   - `validate`: a step whose text contains `$nope` with no in-scope name `nope` → issue in the existing `ValidationIssue` shape (`validate.ts:12-16`: `{stepId: string | null, level: 'error', msg}`) with plain-language copy in the file's voice, e.g. `"This step uses $nope, but no earlier step defines it."`; `$known.deep.path` with `known` in scope → no issue (base-name-only rule); set_variable with empty/invalid `name` (must match `^[a-z_][a-z0-9_]*$` after trim) → error; duplicate set-variable names in the same scope → error.
   - `summarizeTrigger({schedule:{type:'once', at:'2026-08-01T14:00'}})` → `"Once on 2026-08-01 at 14:00"` — deterministic, locale/TZ-free, same raw-`at` voice as the existing `Every day at ${at}` strings in `trigger-summary.ts` (which does no date formatting anywhere).
b. Implement: add `'variable'` to `TokenSourceKind`; extend the exhaustive switches; wire `extractVariableRefs` + `buildVariableNamespace` + `scopeAt` into `validate` for every `ChipText` string part. `tokens.ts` is at 260 lines — move the new set_variable branch logic into `variables.ts` helpers if it would cross 300.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/automation-domain/__tests__/tokens.test.ts src/automation-domain/__tests__/trigger-summary.test.ts` and `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/domain/__tests__/validate.test.ts`; then `pnpm --filter @qlan-ro/mainframe-types build`.

### T4. ChipText⇄text conversion helpers + shared substitution fixtures

**Files:** new `packages/types/src/automation-domain/chip-text-convert.ts` + `__tests__/chip-text-convert.test.ts`; new fixture `packages/types/fixtures/automations/variable-substitution.json` (cases: `{text, scope, expected}`) and a 7th canonical definition fixture `packages/types/fixtures/automations/release-digest.json` exercising `set_variable`, `$` refs (incl. one dotted), and a `{type:'once'}` trigger.

a. Failing tests: `chipTextToText(parts, nameFor)` — text parts pass through; `{token}` parts become `$name` via the namespace-derived `nameFor(ref)`; a field-dug ref becomes `$trigger_payload.pr.title`; with TWO agent steps, a legacy ref to the FIRST converts to `$agent_result` and to the second `$agent_result_2` (pins that conversion cannot silently rebind the earlier step — Decision 2); an unmappable ref (stale stepId) converts to plain `$` + sanitized label — no invented syntax — and is later flagged by validation as unknown (test pins this). `textToChipText(text)` → `[text]` single-part.
b. Implement helpers; author both fixtures. `variable-substitution.json` must include: failed dotted dig on a resolved base → empty; unknown base name → literal; the two-agent suffix case (Decisions 2/3). Register `release-digest.json` at all three fixture sites: `FIXTURE_NAMES` in `packages/types/src/__tests__/automation.test.ts:143`; `pub(super) const FIXTURES: [&str; 6]` at `packages/core-rs/crates/mainframe-automations/src/domain/mod.rs:57` — the array length in the type becomes 7 (done in T5); and `packages/ui/src/features/automations/fixtures/fixtures.ts` (`AUTOMATION_FIXTURES`, line 25 — this seeds the UI library list, so update the count assertions in UI tests that consume it, and update the file's header docblock: "the six canonical…" and the "Fixture 6 is the sole carrier of A1/A2/A3" note both staledate with a 7th entry). Add a TS test that runs the substitution cases through a TS reference implementation (used by Rust for parity in T6).

**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/automation-domain/__tests__/chip-text-convert.test.ts`.

---

## Phase B — Rust daemon parity (packages/core-rs)

### T5. Rust contract: `once`, `registration`, `set_variable`

**Files:** `crates/mainframe-automations/src/domain/trigger.rs` (SchedulePattern lines 32-39, WebhookTrigger 105-112), `domain/step.rs` (Step enum 14-23; `id()` 26-35, `kind_name()` 37-46, `keep_going()` 48-57; `find_step_by_id` 185-201), `domain/scope.rs` (`step_produces` 128-177, `step_refs` 182-198), `domain/validate.rs` (walk match at 120, `check_ref` 212-245); tests `domain/serde_tests.rs`, `domain/serde_trigger_tests.rs`, `domain/validate_tests.rs`, `domain/mod.rs` fixture_tests.

a. Failing tests: serde round-trip for `{"type":"once","at":"2026-08-01T14:00"}` (inner struct `deny_unknown_fields` — copy the Daily pattern); `WebhookTrigger` with and without `registration` (must round-trip; `skip_serializing_if = "Option::is_none"` so the 6 existing fixtures stay byte-identical — assert via `all_six_fixtures_round_trip_losslessly`); `set_variable` step round-trip; register the new `release-digest.json` fixture in fixture_tests (`FIXTURES` at `domain/mod.rs:57` becomes `[&str; 7]`).
b. Implement: `Once(OnceSchedule { at: String })`; `registration: Option<WebhookRegistration>` (struct `{hook_id, url, last_delivery_at: Option<String>}`, camelCase serde); `SetVariable(SetVariableStep { id, name, value: Vec<ChipPart> })` + the three exhaustive methods; `step_produces` → single output `value`; `step_refs` → refs from legacy token parts in `value`; validate walk falls into the default `scope.extend(step_produces(step))` arm plus a new name-shape check (`^[a-z_][a-z0-9_]*$`) mirroring T3.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-automations domain`.

### T6. Rust `$name` substitution + set_variable execution + unresolved-name validation

**Files:** new `crates/mainframe-automations/src/tokens/variables.rs` (naming + ref scanner + `NameIndex`, mirroring T2's rules exactly. `NameIndex` is a **per-step map** — `HashMap<StepId, HashMap<String, NameTarget>>` — built once per run from the `AutomationDefinition` by the same scope walk `domain/validate.rs::walk` models (if-branch leak, repeat-body isolation), NOT a flat `step_produces` sweep: a flat walk names repeat-body steps that are invisible after the block and silently shifts suffixes against the editor. `NameTarget` is `Ref(TokenRef)` or `CurrentItem`: the repeat item appears in no `step_produces` output and no `Scope::bindings` — it lives on `Scope::current_item` via `child_iteration` (`tokens/scope.rs:47-55`) — so inside repeat bodies the step's map carries `item` → `CurrentItem`. The index must NOT be built from `Scope::bind`: bind order — committed outputs via `engine/checkpoint.rs::build_scope` — is not scope order, and `bind` has no `Step` to name), `tokens/substitute.rs` (`render` — currently `render(parts, scope)` at line 8 — gains the current step's name map alongside `Scope`: resolve the base name via the map (`CurrentItem` reads `scope.current_item`), then dig the dotted path with the existing `dig` semantics; failed dig renders empty; only an unresolved base name stays literal), `engine/mod.rs` (`VerbContext`, lines 57-61, gains `name_index` built once per run from the definition — **public-struct churn**: `VerbContext` is `pub`, so every `VerbPorts` impl and test double sees the new field), the four `render` call sites: `engine/notify_verb.rs:57`, `engine/run_action_verb.rs:117`, `engine/agent.rs:218` and `:235`, `engine/walk.rs` (dispatch arm ~199-211: SetVariable is engine-internal — render `value` against scope, succeed with outputs `{"value": rendered}`; it is pure, so it stays OUT of the non-idempotent `matches!` at line 102), `engine/checkpoint.rs` `build_scope` (119-143 — no change expected; committed outputs flow in already), `domain/validate.rs` (unresolved-`$name` check over all ChipText text parts using the per-step namespace — save-time 400 parity with T3).

a. Failing tests:
   - `tokens/variables` unit tests pinned to the same hardcoded cases as T2 (boundary, trailing period, dotted path, `$1abc` non-match).
   - A parity test that loads `packages/types/fixtures/automations/variable-substitution.json` and asserts `render` output equals `expected` for every case (single source of truth with TS — T4).
   - Engine test (pattern of `engine/linear_tests.rs`): set_variable step binds a value; a downstream notify's `$name` ref renders it; an unresolved `$missing` stays literal in output; `$item` inside a repeat body renders the current iteration's element (pins `NameTarget::CurrentItem`); the repeat-isolation suffix case matches TS — for `[repeat[agent A], agent B]`, `$agent_result` after the block resolves B.
   - Validate test: definition with `$missing` fails `validated()` with the crate's existing `ValidationError` shape (`{step_id: Option<String>, message}`); the same definition minus the ref passes.
   - Conformance: extend `tests/conformance.rs` harness with a `release_digest.rs` scenario driving the new fixture end-to-end (fake agent, assert substituted prompt).
b. Implement. Keep `variables.rs` under 300 lines; the name-derivation match must stay in lockstep with T2 — add a comment pointing at `automation-domain/variables.ts` and the shared fixture.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-automations tokens && cargo test -p mainframe-automations engine && cargo test -p mainframe-automations --test conformance release_digest`.

### T7. Rust `once` scheduling + webhook registration backend

**Files:** `crates/mainframe-automations/src/scheduler.rs` (`compile_schedule` 31-51, `latest_occurrence_at_or_before` 85-95), `src/triggers/sweep.rs` (`sweep_trigger` 57-105), `src/triggers/webhook_ingest.rs` (record delivery time), `src/store/db.rs` (new table `automation_webhook_state (hook_id TEXT PRIMARY KEY, last_delivery_at TEXT)` + store methods), `src/service.rs` (registration read/arm APIs), `crates/mainframe-server/src/routes/automations.rs` (new route + registration embedding on GET); tests `scheduler_tests.rs`, `triggers/sweep_tests.rs`, `triggers/webhook_ingest_tests.rs`, `routes/automations/automations_tests.rs`, store tests.

a. Failing tests:
   - Scheduler: `once` bypasses croner — `latest_occurrence_at_or_before(now)` returns `at` iff `at <= now`, else `None`. Dedup key and `scheduled_for` keep the **uniform derivation** `sweep_trigger` already uses — both from `scheduled_for_string(&latest)` (`triggers/sweep.rs:85-86`), no per-pattern branch: a fixed naive-local `at` renders byte-identically on every sweep. Pin: the same `once` trigger swept twice produces exactly one run (the `uq_runs_dedup` index on `(automation_id, trigger_dedup_key)`); `OnMissed::Skip` + `at` older than `FRESH_WINDOW_MS` → skipped; `RunOnce` → still fires.
   - Ingest: a delivery upserts `automation_webhook_state.last_delivery_at`; survives restart (store test).
   - Route: `POST /api/automations/{id}/webhooks/{triggerId}/register` → 200 `{success:true, data:{hookId, url, lastDeliveryAt}}`; calls `ensure_webhook_secret` (webhook.rs 164-184); 404 for unknown automation/trigger; envelope errors via the existing `engine_error` mapping. The URL is the **local ingest endpoint** `http://127.0.0.1:<daemon-port>/api/automation-webhooks/{hookId}` (route at `crates/mainframe-server/src/routes/automation_webhook.rs:70`) — the daemon has no public tunnel; T20's copy states that honestly. `GET /api/automations/{id}` embeds `registration` on each webhook trigger that has a provisioned secret (`lastDeliveryAt` from the new table, `null` when none).
b. Implement. Registration is server-computed: strip/ignore any client-sent `registration` on create/update (recompute on read) so a stale save can't lie. Note: fires-exactly-once rests entirely on the dedup run row surviving — `store/db.rs` has no run pruning today; any future retention job must not delete the latest run of a `once` trigger or it re-arms.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-automations scheduler && cargo test -p mainframe-automations sweep && cargo test -p mainframe-automations webhook && cargo test -p mainframe-server automations`.

---

## Phase C — trigger-engine lift + composer migration (packages/ui)

### T8. Engine core: detection, navigation, selection (pure modules)

**Files:** new directory `packages/ui/src/components/trigger-engine/`: `detect.ts`, `navigation.ts`, `selection.ts`, `types.ts` (re-home the structural `TriggerAdapter` + `TriggerItem`/`DirectiveFormatter` types here — `skills-trigger-adapter.ts`'s local interface becomes an import; **zero remaining type-imports from `@assistant-ui/react` in trigger code** when Phase C completes); tests `__tests__/detect.test.ts`, `__tests__/navigation.test.ts`, `__tests__/selection.test.ts`.

a. Failing tests, pinned to the library's observed 0.14.27 semantics (they are the compatibility contract):
   - `detect`: trigger char must be word-initial (offset 0 or preceded by whitespace); query runs cursor-back-to-whitespace; returns `{query, offset}`; no match mid-word; cursor before the char → no match.
   - `navigation`: categories → items drill-down; search mode when the adapter has `search` or a query exists; back navigation resets.
   - `selection.insertDirective(text, cursor, trigger, directive)`: replaces from `trigger.offset` through cursor with `directive`, appends exactly one space unless the following text already starts with one, returns `{text, cursor}` with cursor after the space — byte-compatible with `before + directive + (after.startsWith(' ') ? after : ' ' + after)`. Directory case: directive `@dir/` with **no** appended space (the engine owns insertion, so the old post-hoc `dropDirectoryClosingSpace` strip is expressed directly — pin a test that `@dir/` insertion leaves the token open for re-detection).
b. Implement as pure functions (no React). Each module well under 300 lines.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/trigger-engine/__tests__/detect.test.ts src/components/trigger-engine/__tests__/navigation.test.ts src/components/trigger-engine/__tests__/selection.test.ts`.

### T9. Engine React layer: `useTriggerField` + popover components

**Files:** `packages/ui/src/components/trigger-engine/use-trigger-field.ts` (hook: takes `{value, onChange, triggers: Array<{char, adapter, formatter, onInserted?}>}` plus a textarea ref; owns cursor tracking (change/select/compositionEnd), keydown handling (arrows/Enter/Tab/Escape consulted before the caller's own handlers — return "handled" so callers can suppress their Enter behavior), insertion via `selection.ts` with cursor re-sync after mouse picks; **returns the combobox ARIA props for the textarea** — `aria-expanded`, `aria-haspopup="listbox"`, `aria-controls`, `aria-activedescendant` — because dropping the library popover drops `useTriggerPopoverAriaProps`'s wiring); `TriggerFieldPopover.tsx` (in-flow shell — port `PopoverShell`'s visual classes from `ComposerTriggers.tsx`, but **rebuild the row semantics**: the current `ItemRow` is `ComposerPrimitive.Unstable_TriggerPopoverItem`, which supplied `role`, the stable item `id` that `aria-activedescendant` targets, and `data-highlighted`; our component owns `role="listbox"` on the list and `role="option"` + generated stable ids + `data-highlighted` per row. Keep testid `composer-trigger-popover` configurable with that as composer default and item testid prefixes as props).

a. Failing tests `__tests__/use-trigger-field.test.tsx` (jsdom): type `/qu` → popover items filtered; Escape closes and stops matching until re-trigger (pin the library's close semantics of resetting the tracked cursor to the trigger offset); mouse pick inserts and closes; directory pick keeps token open and re-lists; ARIA — closed: `aria-expanded=false`; open: `aria-expanded=true`, `aria-controls` pointing at the listbox id, `aria-activedescendant` tracking the highlighted option id.
b. Implement. Hook stays under 50 lines/function by delegating to the pure modules.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/trigger-engine/__tests__/use-trigger-field.test.tsx`.

### T10. Composer migration onto the engine (behavior parity)

**Files:** `packages/ui/src/features/chat/composer/triggers/ComposerTriggers.tsx` (rewrite), `directive-formatter.ts` (trim: `dropDirectoryClosingSpace` deleted — engine-internal now; keep formatters), `skills-trigger-adapter.ts` / `mention-adapter.ts` (retarget type imports to `trigger-engine/types`), `Composer.tsx` (mount + input handler wiring); existing composer/trigger tests under `packages/ui/src/features/chat/composer/**/__tests__/` updated in place (same behavioral assertions, new plumbing).

a. First extend/keep the existing trigger tests as the parity gate: `/` lists skills and inserts `/skill ` literal; `@` fuzzy files + agents, `@dir/` drill-down without trailing space, filesystem `@/` browse; popover closes after mouse pick; Escape closes without cancelling composer editing; the input keeps its combobox ARIA (`aria-expanded`/`aria-controls`/`aria-activedescendant`) now that the library popover no longer supplies it (T9).
b. Implement: `ComposerTriggers` drops all `Unstable_TriggerPopover*` usage. Bridge to the composer's text state via the **plugin registry**: keep mounting `Unstable_TriggerPopoverRoot` solely as the `ComposerInputPluginProvider` host and register one plugin via `INTERNAL.useComposerInputPluginRegistryOptional()` whose `handleKeyDown`/`setCursorPosition` feed the engine (the `ComposerInputPlugin` *type* is not re-exported from `INTERNAL` — declare the two-method shape as a local structural type) — this inherits `ComposerPrimitive.Input`'s exact cursor feed and its Escape-before-cancel ordering. Text read/write via public `unstable_useComposerInput().{value,setText}`. Delete `TriggerCloseCapture`, `MentionDriver` stays (query-driven fetch), `keepDirectoryTokenOpen` and the `__internal_getRuntime` comment block die. If the plugin-registry bridge proves unreachable in tests (INTERNAL export gap), fallback documented here: element props on `ComposerPrimitive.Input` (`onKeyDown`/`onSelect`/`onChange` composed first; `preventDefault` suppresses Enter-submit) — accept it only with an added Escape-ordering test.

**Verify:** run every existing composer-trigger test file singly (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` for each file under `src/features/chat/composer` matching `*trigger*`/`Composer*`), then `pnpm --filter @qlan-ro/mainframe-ui typecheck`. Manual smoke in `pnpm tauri:dev`: `/`, `@`, `@dir/` drill-down, Escape, mouse pick.

---

## Phase D — TriggerTextField + ChipField replacement (packages/ui)

### T11. Variables adapter + automations trigger sources

**Files:** new `packages/ui/src/features/automations/fields/variables-trigger-adapter.ts` (+ test `__tests__/variables-trigger-adapter.test.ts`); new `packages/ui/src/features/automations/fields/use-automation-trigger-sources.ts` (skills via `getSkills(port, adapterId, projectPath)` — signature at `lib/api/skills.ts:7` — with `adapterId` = the agent step's configured adapter, falling back to the default adapter from `useAdapters`, and `projectPath` resolved from the automation's `projectId` via `getProjects`, the same way `use-chat-skills.tsx` does; files via `searchFiles`/`getFileTree`/`browseFilesystem` with `projectId`, no chatId — mirrors `ComposerTriggers`' cache wiring but sourced from automations context, not `useChatExtras`; note `SkillsProvider` is chat-coupled and cannot be reused).

a. Failing tests: adapter is search-first over the namespace from `buildVariableNamespace(scopeAt(...))`; items `{id: name, label: $name, description: "<source step label>"}`; empty query lists all in-scope names; formatter serializes `$name` (literal, no trailing space — engine adds it).
b. Implement; reuse `literalDirectiveFormatter('$')`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/fields/__tests__/variables-trigger-adapter.test.ts`.

### T12. `TriggerTextField` component

**Files:** new `packages/ui/src/features/automations/fields/TriggerTextField.tsx` (+ `__tests__/TriggerTextField.test.tsx`). Props: `{value: string; onChange(next: string): void; placeholder?: string; minHeight?: number; testId: string; scope: TokenDescriptor[]; triggers?: 'all' | 'variables-only'}`.

a. Failing tests: renders an autosizing `<textarea data-testid={testId}>`; typing `$` at word start opens the popover listing in-scope names; picking inserts literal `$name ` and closes; `/` and `@` fire when `triggers='all'`; Enter inserts a newline (no send — automations fields never submit); the `⟨⟩` affordance (T13) exists as a slot.
b. Implement on `useTriggerField` + `TriggerFieldPopover` (testid `<testId>-trigger-popover`). Textarea styling: composer's field classes (`font-sans text-body leading-relaxed`, `px-[14px] pt-[10px] pb-[4px]` where the card provides them — the bare field variant used inside other panes gets standard input padding), **excluding `text-transparent caret-foreground`** — those exist only for the composer's `ComposerHighlight` overlay, which this field does not have; porting them verbatim renders invisible text. Autosize: the composer's input is the library's `TextareaAutosize` (`react-textarea-autosize`, today only a transitive dep) — add it as a direct `@qlan-ro/mainframe-ui` dependency and use it here for identical behavior.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/fields/__tests__/TriggerTextField.test.tsx`.

### T13. `⟨⟩` variable picker button

**Files:** new `packages/ui/src/features/automations/fields/VariablePickerButton.tsx` (+ test). Popover (shared `popover` + `command` primitives) listing the same namespace items as the `$` adapter; picking inserts literal `$name` at the caret via the field's insert API; testid `<fieldTestId>-var-picker`; `aria-label="Insert variable"`.

a. Failing tests: button renders with testid `<fieldTestId>-var-picker` and `aria-label="Insert variable"`; opening lists the same names as the `$` adapter for the given scope; picking inserts literal `$name` at the caret (cursor position honored, not appended) and returns focus to the textarea; empty scope shows an empty state, not a broken popover.
b. Implement; the button renders in `TriggerTextField`'s affordance slot.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/fields/__tests__/VariablePickerButton.test.tsx`.

### T14. Replace `ChipField` everywhere; delete it

**Files:** `packages/ui/src/features/automations/steps/NotifyConfig.tsx` (line 25), `steps/AutoForm.tsx` (80/93/116), `steps/AgentConfig.tsx` (55, 89 — the prompt site is fully rebuilt in T16; the worktree `branchName` site uses `TriggerTextField` with `triggers='variables-only'`, because branch names take `$name` refs, e.g. `todo/$id`); delete `fields/ChipField.tsx`, `fields/SlashMenu.tsx` (dead once no caller), and their tests; update `fields/__tests__/*` and step tests that asserted `ChipText` arrays to assert plain strings.

a. First update the consumer tests to the new string model (load: `chipTextToText` upgrade of legacy `{token}` parts, pinned with a legacy-definition fixture; save: single-string `ChipText` emitted).
b. Swap the six sites. The ChipText⇄string conversion happens in exactly two places in `AutomationEditor.tsx`: the legacy `{token}` upgrade once at load inside `draftFrom()`, and the `[string]` wrap once at save — step config components receive and emit plain strings only. (Per-component mapping would re-run the upgrade every render and leave `validate()`, `renameVariableInDefinition`, and the save payload seeing a mixed model.) Delete dead files. Grep for remaining `ChipField`/`SlashMenu` imports — zero.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/steps/__tests__/NotifyConfig.test.tsx src/features/automations/steps/__tests__/AutoForm.test.tsx src/features/automations/steps/__tests__/AgentConfig.test.tsx`, then `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Phase E — agent step pane (packages/ui)

### T15. Toolbar chip menus (port from prototype)

**Files:** new `packages/ui/src/features/automations/steps/agent/` directory: `ChipButton.tsx` (the CHIP constant: `h-[20px] rounded-[11px] border-[0.5px] px-[8px]`, icon size 12, `title` + `aria-label` — no visible labels by design), `ModelMenu.tsx` (Sparkles + `ChevronDown` `text-mf-text-3`; adapters/models from `useAdapters` — replaces `steps/AgentModelPicker.tsx`'s native selects with the shared `select`/`command` popover), `PermissionMenu.tsx` (Shield; modes default/acceptEdits/yolo over the existing `EXECUTION_MODES`; chip turns `text-destructive` on yolo), `WorktreeMenu.tsx` (GitBranch, value in `font-mono text-caption`, "no worktree" when unset; popover with the isolate `Switch` + branch-name `TriggerTextField` variables-only), `AdvancedSection.tsx` (single `SlidersHorizontal` `size-3.5` toggle, `size-[26px] rounded-md`, active `bg-mf-selection text-foreground`, `aria-expanded`, `aria-label="More options"`, testid `<prefix>-advanced-toggle`; expands `border-t-[0.5px] border-border px-3 py-2.5` containing Attachments, Timeout, On-failure, and the existing `ExpectResultsBuilder`). Chip open state: `data-[state=open]:border-primary data-[state=open]:bg-mf-selection`. Port markup/classes from the prototype's `agent-shared.tsx` @ `cee842ef`. Tests per component in `steps/agent/__tests__/`.

a. Failing tests: testids `<prefix>-model`, `<prefix>-permission`, `<prefix>-worktree`, `<prefix>-advanced-toggle`; menu selections call `onChange` with the step patch; yolo shows destructive styling; open chip carries the `data-[state=open]` classes; worktree chip shows "no worktree" when unset; advanced toggle has `aria-label="More options"`, flips `aria-expanded`, and reveals fields.
b. Implement. Real data only (adapters from `useAdapters`, no prototype hardcodes).

**Verify:** each new test file singly via `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`.

### T16. Rebuild `AgentConfig` as the variant-A card

**Files:** `packages/ui/src/features/automations/steps/AgentConfig.tsx` (rewrite, composing T15 parts + `TriggerTextField`); delete `steps/AgentModelPicker.tsx` (+ its test) once unreferenced. `steps/MoreOptions.tsx` is NOT deleted — `AskMeConfig.tsx` (12, 72) and `NotifyConfig.tsx` (12, 37) still use it (Decision 8). Update `steps/__tests__/AgentConfig.test.tsx`.

a. Update `AgentConfig.test.tsx` first: card structure (`rounded-xl [border-width:0.5px] border-border bg-card shadow-sm focus-within:border-ring`); prompt textarea placeholder "What should the agent do?", `px-[14px] pt-[10px] pb-[4px]`, minHeight 56; chips row present in a toolbar row `px-2.5 pt-[4px] pb-[6px]` with spec testids (prefix = the existing `automations-step-config-<id>` convention); no Send button (pinned: none exists); `$`/`/`/`@` triggers function in the prompt (popover opens on `$`).
b. Implement; keep the file under 300 lines by leaning on `steps/agent/` parts. Grep for `AgentModelPicker` imports — zero, then delete.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/steps/__tests__/AgentConfig.test.tsx` + `pnpm --filter @qlan-ro/mainframe-ui typecheck`. Manual smoke in `pnpm tauri:dev` against a real automation.

### T17. Shared-primitive sweep: retire `MiniSelect` (own PR — PR 6)

`fields/MiniSelect.tsx` has 9 call sites in 7 files. Three disappear upstream: `steps/AgentConfig.tsx:144` (T16 rewrite), `editor/SchedulePicker.tsx:48` (T18 rewrite), `editor/TriggerRow.tsx:80` (T19 rewrites that branch — its select moves to the shared primitive there). The rest convert here, one sub-task per file, each TDD (**a**: rewrite the file's `fireEvent.change` assertions to the Radix select interaction pattern used elsewhere in the codebase; **b**: swap to the shared `select` primitive):

- **T17.1** `steps/AutoForm.tsx:67` (+ `steps/__tests__/AutoForm.test.tsx`)
- **T17.2** `editor/ConditionRow.tsx:167,183` (file is 203 lines — if the swap pushes it past 300, extract the operator/side sub-selects into `editor/condition-row-parts.tsx`) (+ its test)
- **T17.3** `steps/FormFieldRow.tsx:40,86` (+ its test)
- **T17.4** `steps/ExpectResultsBuilder.tsx:59` (+ its test)
- **T17.5** delete `fields/MiniSelect.tsx` + `fields/__tests__/MiniSelect.test.tsx`; grep `MiniSelect` — zero.
- **T17.6** shared-primitive inventory (acceptance criterion 2): grade `steps/FormFieldRow.tsx`, `steps/AttachmentsField.tsx`, `steps/CredentialConnect.tsx`, `editor/ConditionRow.tsx` against `components/ui/` — convert where a shared equivalent exists, or record a one-line justification per file in the PR description.

**Verify:** affected test files singly; typecheck; grep `MiniSelect` — zero.

---

## Phase F — secondary surfaces (packages/ui)

### T18. Schedule surface: Preset | Custom time | One-off

**Files:** new `packages/ui/src/features/automations/parts/SegmentedControl.tsx` (no shared tabs/segmented primitive exists; port the prototype's: container `h-[24px] rounded-md border bg-muted p-[2px]`, buttons `h-full rounded-[5px] px-2 text-caption`, active `bg-card shadow-sm`; generic `{options, value, onChange, testIdPrefix}`); rewrite `editor/SchedulePicker.tsx` (67 lines today): segmented `schedule-<triggerId>-mode-{preset|custom|once}`; preset = existing 8 presets via shared select; custom = frequency select (daily/weekdays/weekly+days) + `<input type="time">`; once = `<input type="datetime-local">` → `{type:'once', at}`; `onMissed` switch stays. Tests `editor/__tests__/SchedulePicker.test.tsx` updated + `parts/__tests__/SegmentedControl.test.tsx` new.

a. Failing tests: mode testids; once mode emits `{type:'once', at:'2026-08-01T14:00'}`; custom weekly emits `{type:'weekly', days, at}`; switching modes preserves what it can and never emits an invalid pattern; summary line (from `summarizeTrigger`, T3) renders for once.
b. Implement.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/editor/__tests__/SchedulePicker.test.tsx src/features/automations/parts/__tests__/SegmentedControl.test.tsx`.

### T19. Event trigger sentence: "When ⟨event⟩, only when started by ⟨automation⟩"

**Files:** `editor/TriggerRow.tsx` (event branch): event select (testid `trigger-event-name`) + automation filter select (testid `trigger-event-source`) listing the store's automations (`use-automations-store.ts`) with an Any option (`__any__` sentinel → `automationId: undefined`); both use the shared `select` primitive — this absorbs the `MiniSelect` at line 80 (T17's ledger); remove the GitHub entries from `EVENT_OPTIONS` (lines 33-39) — those are webhook presets, not events (they fabricated webhook triggers with `pending-` hookIds) — and collapse the now-parallel `EVENT_OPTIONS`/`EVENT_LABELS` (lines 41-45) into one table. Tests in `editor/__tests__/TriggerRow.test.tsx`.

a. Failing tests: selecting a source automation patches `automationId`; Any clears it; existing `automationId` round-trips into the select; GitHub entries no longer offered as events.
b. Implement (the field already exists end-to-end — TS line 141, Rust trigger.rs 92-93, router filter — UI exposure only).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/editor/__tests__/TriggerRow.test.tsx`.

### T20. Webhook surface: truthful registration cards

**Files:** `editor/TriggerRow.tsx` webhook branch (extract to `editor/WebhookTriggerCard.tsx` if TriggerRow nears 300); `data/gateway.ts` + `data/http-gateway.ts` + `lib/api/automations.ts` (new `registerWebhook(automationId, triggerId)` → `POST /api/automations/{id}/webhooks/{triggerId}/register`, T7); `editor/WhenCard.tsx` (webhook `newTrigger` keeps a client-generated `hookId` — drop the `pending-` prefix, use the id-generation used elsewhere in the editor); tests `editor/__tests__/TriggerRow.test.tsx` (or new `WebhookTriggerCard.test.tsx`) + gateway fake update in the editor test utils (`createFakeGateway`).

a. Failing tests:
   - **Delete the dishonest copy** (pinned by absence): no fabricated `https://hooks.mainframe.app/...` URL (old line 96), no unconditional "Signature verified" (99-100), no fake "No sample captured yet…" (103).
   - Unregistered (`trigger.registration` absent): dashed card (`border-dashed bg-card/60`), copy "The daemon hasn't registered this hook yet — there is no URL to call.", Register button (testid `trigger-webhook-register`) with busy state while the gateway call is in flight; on an unsaved automation the button is disabled with title "Save the automation first".
   - Registered: real URL from `registration.url` in a select-all `<code>` block + copy button (testid `trigger-webhook-copy-url`) raising `mfToast` from `@/lib/toast` (never sonner); a caption stating the reach honestly: "Local daemon URL — reachable only from this machine." (the ingest route has no public tunnel, T7); delivery line: `lastDeliveryAt` null → "No deliveries yet", else "Last delivery <relative time>".
   - Register success patches the trigger with the returned `registration` and re-renders registered.
b. Implement.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/editor/__tests__/TriggerRow.test.tsx` + typecheck.

---

## Phase G — set-value step UI + rename + validation surfacing

### T21. Register the step kind across the UI

**Files:** `editor/verb-meta.ts` (VERB_META 45-99: label "Set value", violet — `text-mf-auto-violet` family per `ActionCatalog.tsx`'s existing violet classes; ADD_STEP_GROUPS 101-104), `editor/Recipe.tsx` (`newStep()` switch 22-43: `{kind:'set_variable', id, name:'', value:['']}`; `isBlock()` untouched), `editor/StepCard.tsx` (lines 130-161 are a four-branch `{step.kind === 'x' && <XConfig …/>}` chain repeating the same props — replace it with a per-kind component map typed `{[K in LeafStep['kind']]: FC<StepConfigProps<K>>}` where `StepConfigProps<K> = {step: Extract<LeafStep, {kind: K}>; onChange: (patch: Partial<Extract<LeafStep, {kind: K}>>) => void; tokens: TokenDescriptor[]; catalog: ActionCatalog; testId: string}` — one uniform arg set, unused props accepted and ignored (AskMe ignores `tokens`/`catalog`), `step` stays narrowed through the mapped type via one generic render helper, **no `as` casts** — then register `SetValueConfig` as one line), `editor/StepSummary.tsx` (LeafStep line 23 + switch 78-89: summary `Set $name`), `fields/TokenPicker.tsx`/`TokenChip.tsx` (render `sourceKind:'variable'` violet in the structural pickers used by if/repeat); new `steps/SetValueConfig.tsx` (name `Input` testid `automations-step-config-<id>-name` + value `TriggerTextField` testid `automations-step-config-<id>-value`). Tests: `editor/__tests__/Recipe.test.tsx`, `StepSummary` tests, new `steps/__tests__/SetValueConfig.test.tsx`, `fields/__tests__/TokenChip.test.tsx`.

a. Failing tests: Add-step menu offers "Set value"; new step renders the config pane; name+value edits patch the step; summary renders; a downstream step's `$` popover and `⟨⟩` picker list the variable; TokenChip renders the `'variable'` kind.
b. Implement.

**Verify:** each listed test file singly.

### T22. Rename-rewrite wiring

**Files:** `steps/SetValueConfig.tsx` (commit semantics) + `editor/Recipe.tsx` or the definition-patch path in `AutomationEditor.tsx` (whichever owns step patching — apply `renameVariableInDefinition` from T2 in one place); test in `steps/__tests__/SetValueConfig.test.tsx` + an editor-level test in `editor/__tests__/` proving cross-step rewrite.

a. Failing tests: typing a new name does NOT rewrite per keystroke; committing (blur or Enter) rewrites every `$oldname` (and `$oldname.path`) in downstream steps' text fields exactly once; `$oldnamer` untouched; empty/invalid name refuses commit with inline error (validation message from T3's name rule); renaming an `ask_me` field key does NOT rewrite refs — the stale `$name` surfaces as a save-time unresolved error (pins Decision 9).
b. Implement: local draft state in the name input; single `renameVariableInDefinition` dispatch on commit. `AutomationEditor.tsx` is at 264 lines — if wiring pushes it over 300, extract the definition-patch helpers into `editor/definition-actions.ts`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/steps/__tests__/SetValueConfig.test.tsx <editor test file>`.

### T23. Unresolved-`$name` surfacing at save

**Files:** whatever renders `validate()` results today (`AutomationEditor.tsx` 108-115 gates Save on client validation; errors render per step) — no new plumbing expected since T3 put the check inside `validate()`.

a. Failing tests: a definition with an unresolved `$nope` shows the T3 issue text on the owning step and Save stays gated; fixing the ref clears it. Daemon 400 path: mock the gateway save rejecting with the `engine_error` envelope (`{error, errors:[{stepId,message}]}`) and assert the per-step error surfaces rather than vanishing — add the test if none pins it today.
b. Extend the rendering only if the new issue exposes a gap.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <AutomationEditor test file>`.

---

## Phase H — finish line

### T24. Changesets, full verification, hygiene sweep

- `pnpm changeset`: `@qlan-ro/mainframe-types` **minor**, `@qlan-ro/mainframe-ui` **minor**. Rust crate changes ride the app: follow the repo's existing convention for core-rs-affecting PRs (check `.changeset/` history; core-rs ships via `@qlan-ro/mainframe-app-tauri`). One changeset per PR in the suggested grouping.
- `pnpm --filter @qlan-ro/mainframe-types build` && `pnpm --filter @qlan-ro/mainframe-ui typecheck`.
- `cd packages/core-rs && cargo fmt --all -- --check && cargo test -p mainframe-automations && cargo test -p mainframe-server`.
- Hygiene grep — all must be zero: `ChipField`, `SlashMenu`, `MiniSelect`, `AgentModelPicker`, `Unstable_TriggerPopover` (outside the T10 root-mount bridge), `dropDirectoryClosingSpace`, `pending-` hookIds, `hooks.mainframe.app`. (`MoreOptions` stays — Decision 8.)
- Manual smoke (`pnpm tauri:dev`, isolated `MAINFRAME_DATA_DIR`/`DAEMON_PORT` — never against production `:31415`): author the release-digest automation end-to-end (once trigger, set value, `$` refs in an agent prompt, webhook register + copy URL), run it, verify substitution in the spawned prompt.

## Out of scope (explicit, from the spec)

Run-history views; step reordering; any new step kinds beyond set-value; a Send button on the prompt field (none — accepted); building webhook *presets* UI beyond what exists; `$name` escape syntax (report if users hit it); mobile submodule changes (contract is additive; mobile ignores unknown fields — do not bump the submodule pointer).

## Risks

- **T10 INTERNAL bridge:** re-verified against the installed 0.14.27 dist: `index.d.ts` exports `internal_d_exports as INTERNAL` including `useComposerInputPluginRegistryOptional`; `ComposerInput.js:54` consumes the registry (cursor feed + keydown-before-default); `TriggerPopoverRootContext.js:267` mounts `ComposerInputPluginProvider` inside `Unstable_TriggerPopoverRoot`. Plugin shape is exactly `{handleKeyDown(e): boolean; setCursorPosition(pos): void}`. It is unstable API; the pin protects us; the props fallback is specified inline in T10.
- **Composer behavior parity** is guarded by keeping the existing trigger tests as the gate (T10a) plus a manual smoke; any drift found there blocks PR 2.
- **TS/Rust `$`-semantics drift** is guarded by the shared `variable-substitution.json` fixture consumed by both test suites (T4/T6).
- **Fixture byte-compatibility** (`skip_serializing_if` on every new optional field) is asserted by the existing round-trip test (T5).
