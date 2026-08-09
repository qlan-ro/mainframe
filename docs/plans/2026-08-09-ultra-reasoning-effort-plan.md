# Make `ultra` a first-class reasoning-effort level (todo #302)

**Branch:** `todo/302-ultra-reasoning-effort` · **Route:** no-spec (plan written from the approved Agent Brief)

## Goal

The Rust daemon already knows `ultra`: the shared `EffortLevel` enum carries it, `effort_rank` puts it at 7
(above `Max`), serde round-trips it, and the Codex adapter passes it straight through from the app-server's
advertised per-model effort list. The TypeScript side stops at `max`, and two hardcoded string allow-lists in
the daemon stop there too. The result is a level that is advertised by the catalog but unselectable: the
composer renders an unlabelled option, the chat-row reader drops the persisted value back to absent, and the
provider-settings PUT returns 400. This change adds `ultra` to the shared TypeScript union at rank 7 and to
the UI's effort label map, deletes the two hardcoded allow-lists in favour of the enum's own serde, and pins
the whole thing with tests — with no change to the clamp algorithm, no per-provider gating in the picker, and
no change to which models advertise the level.

## Constraints and context

- **`clampEffortToSupported`'s body does not change.** Only the rank table grows. Because `ultra` sits at the
  top of the order, no existing request can downgrade differently than it does today.
- **The picker stays catalog-driven.** No adapter-specific branch anywhere in `packages/ui`.
- **`packages/ui` resolves `@qlan-ro/mainframe-types` through `dist`**, not source (`vitest.config.ts` aliases
  only `@` → `./src`). Any UI test that exercises `ultra` through `clampEffortToSupported` is wrong until
  `pnpm --filter @qlan-ro/mainframe-types build` has run. Task 5 owns that build.
- **CLAUDE.md limits:** 300 lines/file, 50/function; `data-testid` on every interactive element; tests
  required for new core logic; a changeset is required before commit.
- **Out of scope** (from the brief): rendering Codex's sub-agent delegation (#247), changing which models
  advertise `ultra`, the ultracode→`xhigh` coercion, the Claude adapter's effort mapping, and the retired Node
  daemon package.

## Verified map of the touched code

| Concern | File | Today |
|---|---|---|
| Shared union + rank | `packages/types/src/adapter.ts:248,293` | union stops at `'max'`; `EFFORT_RANK` stops at `max: 6` |
| Rust union + rank (reference, unchanged) | `packages/core-rs/crates/mainframe-types/src/adapter.rs:322,410` | `Ultra` present, `effort_rank` → 7 |
| UI label/description map | `packages/ui/src/lib/model-tuning.ts:19` | `Record<EffortLevel, …>`, 7 entries |
| Composer effort options | `packages/ui/src/features/chat/composer/config-toolbar/ModelMenuRow.tsx:85,115` | maps `effortOptions(model)`; testid `composer-model-<modelId>-effort-<level>` |
| Settings default-effort select | `packages/ui/src/features/settings/panes/providers/ProviderTuningDefaults.tsx:18,43` | testid `settings-<adapterId>-default-effort-option-<level>` |
| Chat-row effort reader | `packages/core-rs/crates/mainframe-db/src/chats.rs:75-84` | `VALID_EFFORTS: [&str; 7]` pre-check, then serde |
| Provider-settings validator | `packages/core-rs/crates/mainframe-server/src/routes/settings.rs:483-488` | hardcoded 7 levels + `""` |
| Chat tuning/effort PATCH | `packages/core-rs/crates/mainframe-server/src/routes/chats.rs:259-265` | **pure serde — already accepts `ultra`; no impl task** |

Two things in the brief do not match the code and are resolved here:

1. The brief names the composer testid `composer-effort-select-option-<effort>`. **That string does not exist
   anywhere in the repo.** The real convention is `composer-model-<modelId>-effort-<level>` (per-model
   flyout). This plan keeps the existing convention and does not invent the brief's. The settings pattern in
   the brief is correct.
2. The brief implies the chat PATCH needs no work — confirmed. `parse_effort_field` is pure serde, so the
   accept half of "PATCH `ultra` persists" is already green; only the **read-back** is red.

## Test strategy

Red-phase asymmetry between the two sides, and it matters:

- **TypeScript red tests do not typecheck before the impl lands.** Any `'ultra'` literal in a
  `satisfies AdapterModel` fixture or a `clampEffortToSupported('ultra', …)` call is a `tsc` error until the
  union grows. Each such line carries `// @ts-expect-error until 'ultra' joins EffortLevel`. Vitest strips
  types, so the tests still *run* and fail on their assertions. Task 5 removes every suppression; an unused
  `@ts-expect-error` is itself a type error, so none can be left behind.
- **Rust red tests need no suppression.** `EffortLevel::Ultra` already compiles. Do not carry the TS
  suppression pattern into Rust.
- **A testid-presence assertion is born green and proves nothing.** `ModelMenuRow` renders
  `data-testid={…-effort-ultra}` unconditionally with `{level.label}` inside; with `EFFORT_META['ultra']`
  undefined the option renders with the testid and an *empty label* — that is the bug. Red assertions must
  check the visible text `Ultra`.
- The seven-level clamp regression table is **expected green at red phase**. It pins current behaviour so the
  rank-table edit cannot move it. Only the `ultra` cases are red.

---

## Tasks

### Group A — TypeScript red tests

#### Task 1 — Clamp regression + `ultra` ordering test in the types package

**File (new):** `packages/types/src/__tests__/effort-clamp.test.ts`

Cover `clampEffortToSupported` from `../adapter.js`:

- A regression table over the seven pre-existing levels (`none`…`max`) against at least three supported sets —
  a full set, a Claude-like `['low','medium','high','max']` (no `xhigh`), and a single-element set — with and
  without a `defaultEffort`. Assert the exact values returned today. These are green now and must stay green.
- `supported: []` → `null`, for a pre-existing level and for `ultra`.
- `ultra` requested against a set that includes it → `'ultra'`.
- `ultra` requested against `['low','medium','high','max']` with no `defaultEffort` → `'max'`. This is the
  behavioural proof that `ultra` outranks `max`: without the new rank entry the filter comparison is `NaN` and
  the result is not `'max'`.
- `ultra` requested against a Codex-like `['medium','high','xhigh']` with no `defaultEffort` → `'xhigh'`.
- `ultra` requested against `['low','high']` with `defaultEffort: 'high'` → `'high'` (supported default wins
  over the highest-below rule).

`EFFORT_RANK` stays unexported — the ordering is asserted through behaviour, not through the private table.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/effort-clamp.test.ts` —
the seven-level regression cases pass; every `ultra` case fails.

#### Task 2 — `effortOptions` / `displayEffort` red tests

**File:** `packages/ui/src/lib/__tests__/model-tuning.test.ts` (extend; do not restructure the existing cases)

- `effortOptions({ id:'gpt', label:'GPT', supportedEfforts:['high','xhigh','ultra'] })` returns an `ultra`
  entry whose `label` is `'Ultra'` and whose `description` is non-empty.
- `effortOptions` on a model without `ultra` returns no `ultra` entry (guard; green today).
- `displayEffort({ effort:'ultra' }, model)` where the model advertises `ultra` → `{ value:'ultra',
  locked:false }`.
- `displayEffort({ effort:'ultra' }, claudeLike)` where `claudeLike.supportedEfforts` is
  `['low','medium','high','max']` and there is no `defaultEffort` → `{ value:'max', locked:false }`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/model-tuning.test.ts` —
the four new assertions fail; the pre-existing ones pass.

#### Task 3 — Composer flyout red test

**File:** `packages/ui/src/features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx`
(append a `describe` inside section 10, reusing the existing `renderSelect` and `openFlyout(user, modelId)`
helpers at lines ~713-735 — do not duplicate the harness into a new file)

Add an `ULTRA_MODEL` fixture: `{ id:'gpt-5.6', label:'GPT-5.6', defaultEffort:'high',
supportedEfforts:['high','xhigh','ultra'] }` on a copy of the tunable adapter. **Leave `chat.effort` unset and
keep `defaultEffort:'high'`** so the trigger label resolves to `High` and cannot throw on the missing
`EFFORT_META` entry before the impl lands.

- Opening that model's flyout shows `composer-model-gpt-5.6-effort-ultra` **with the visible text `Ultra`**.
- The existing `TUNABLE` model's flyout has no `composer-model-tunable-effort-ultra` node (guard; green today).

**Verify:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx`
— the label assertion fails (empty text), the guard passes.

#### Task 4 — Provider-settings select red test

**File:** `packages/ui/src/features/settings/panes/providers/__tests__/ProviderConfigForm.test.tsx` (extend)

Using the file's existing render helper with a model advertising `['low','high','ultra']`: open
`settings-<adapterId>-default-effort` and assert `settings-<adapterId>-default-effort-option-ultra` is present
**with the visible text `Ultra`**. Keep the existing `defaultEffort: 'high'` PUT case untouched.

**Verify:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/providers/__tests__/ProviderConfigForm.test.tsx`
— the new assertion fails on the empty label.

---

### Group B — TypeScript implementation

#### Task 5 — Add `ultra` to the shared union and rank table

**File:** `packages/types/src/adapter.ts`

- Line 248: `… | 'xhigh' | 'max' | 'ultra'`.
- Update the union's doc comment (lines 244-247) to match the Rust one: Codex `ReasoningEffort` =
  none…xhigh plus `ultra` on some models; Claude adds `max`.
- Line 293 `EFFORT_RANK`: add `ultra: 7`. Nothing else in the file changes — `clampEffortToSupported` keeps
  its body verbatim.
- Remove every `// @ts-expect-error until 'ultra' joins EffortLevel` added in tasks 1-4.

**Verify, in order:**
1. `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit`
2. `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/effort-clamp.test.ts` — all green.
3. `pnpm --filter @qlan-ro/mainframe-types build` — **required before any UI test run**; the UI imports the
   built `dist`.
4. Confirm the rank matches Rust: `packages/core-rs/crates/mainframe-types/src/adapter.rs:419` is
   `EffortLevel::Ultra => 7`.

#### Task 6 — Add the `ultra` entry to `EFFORT_META`

**File:** `packages/ui/src/lib/model-tuning.ts`

Add to the record (line 19-27), after `max`:

```ts
ultra: { label: 'Ultra', description: 'Maximum reasoning; delegates to sub-agents proactively.' },
```

`EFFORT_META` is `Record<EffortLevel, …>`, so after task 5 the compiler refuses the file without this entry.
This is the only UI code the picker needs — both the composer flyout and the settings select derive their
options from `effortOptions`, which maps this record.

**Verify:**
1. `pnpm --filter @qlan-ro/mainframe-ui typecheck`
2. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/model-tuning.test.ts`
3. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/config-toolbar/__tests__/ProviderModelSelect.test.tsx`
4. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/settings/panes/providers/__tests__/ProviderConfigForm.test.tsx`

All four green. Run the vitest files one at a time — large multi-suite runs in this package hit cross-file
`React.act` failures.

#### Task 7 — Changeset

**File (new):** `.changeset/<generated-name>.md` via `pnpm changeset`

A **patch** bump naming `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui` (they are a `fixed` pair in
`.changeset/config.json`, so they move together). `packages/core-rs` is a Cargo workspace outside the pnpm
workspace and takes no changeset entry. Summary line, no puffery — e.g. "Add the `ultra` reasoning-effort
level so the composer can offer and persist it."

**Verify:** the file exists under `.changeset/` and names both packages.

---

### Group C — Daemon red tests

#### Task 8 — Invert the provider-settings rejection test

**File:** `packages/core-rs/crates/mainframe-server/tests/routes_settings.rs` (the test at line ~333)

- Replace `provider_put_rejects_invalid_default_effort` with `provider_put_accepts_ultra_default_effort`:
  `PUT /api/settings/providers/claude` with `{"defaultEffort":"ultra"}` returns `200`, and
  `get_setting(&server, "provider", "claude.defaultEffort")` reads back `"ultra"` (mirror the existing
  `set_setting`/`get_setting` helpers used by the `defaultEffort: ""` clear test at line ~281).
- Add `provider_put_rejects_bogus_default_effort`: `{"defaultEffort":"turbo"}` → `400` with
  `body["success"] == false`. Rejection of genuinely invalid values must stay covered.
- Do not touch the `""` clear-sentinel test.

**Verify:** `cargo test -p mainframe-server --test routes_settings default_effort` from `packages/core-rs` —
the accept test fails with 400; the bogus-value test passes.

#### Task 9 — Chat-row effort round-trip test

**File:** `packages/core-rs/crates/mainframe-db/tests/chats.rs`

Follow the shape of `persists_automation_run_id_and_round_trips_through_get` (line ~139) — `setup()`, create a
chat, `update(id, &ChatUpdate { effort: Some(Some(…)), ..Default::default() })`, then `get`:

- `EffortLevel::Ultra` writes and reads back as `Some(EffortLevel::Ultra)` (**red**).
- A regression loop over all seven pre-existing levels: each writes and reads back as itself (green today;
  pins the parser).
- A chat with the column never set reads back `None` (green today; covers the NULL row).
- A row holding a genuinely bogus string still reads back `None` — write it with the raw `Rc<Connection>` from
  `setup_with_conn()` (`UPDATE chats SET effort = 'turbo' WHERE id = ?`), then `get`. This is what keeps
  task 11 honest: deleting the allow-list must not start surfacing garbage.

**Verify:** `cargo test -p mainframe-db --test chats effort` from `packages/core-rs` — only the `ultra` case
fails.

#### Task 10 — Route-level accept test for `PATCH /api/chats/:id/effort`

**File:** `packages/core-rs/crates/mainframe-server/src/routes/chats.rs` (the inline `mod tests`, beside
`set_effort_rejects_bad_level_400` at line ~690)

Add `set_effort_accepts_ultra_past_validation`: call `set_effort` with `{"effort":"ultra"}` against
`AppCtx::test_ctx()` and assert the response is **not** the validation failure — i.e.
`body["error"] != "effort must be a valid level or null"`. The chat does not exist in the test context, so the
handler will fail further down at `apply_and_return`; assert only that validation was cleared.

**This test is green today** — `parse_effort_field` is already pure serde. It is a pin, not a red test. State
that in the test's doc comment so nobody "fixes" a passing test.

**Verify:** `cargo test -p mainframe-server --lib set_effort` — both the existing rejection test and the new
accept test pass.

---

### Group D — Daemon implementation

#### Task 11 — Delete the chat-row effort allow-list

**File:** `packages/core-rs/crates/mainframe-db/src/chats.rs`

Delete `const VALID_EFFORTS` (line 75) and collapse `parse_effort` (lines 77-84) to the serde call it already
wraps:

```rust
fn parse_effort(value: Option<String>) -> Option<EffortLevel> {
    serde_json::from_value(Value::String(value?)).ok()
}
```

The pre-check was redundant from the start: `serde_json::from_value::<EffortLevel>` already returns `Err` for
any string outside the enum, and `.ok()` already collapses that to `None`. Deleting it is what makes the next
added level impossible to desync. Leave the "effort uses `.map(Some)` so an invalid/absent value stays absent"
comment at line 779 intact — it still describes the caller at line 749.

**Verify:** `cargo test -p mainframe-db --test chats effort` from `packages/core-rs` — all cases from task 9
green, including the bogus-string-reads-`None` case. Then `cargo check -p mainframe-db`.

#### Task 12 — Derive the provider-settings effort validation from the enum

**File:** `packages/core-rs/crates/mainframe-server/src/routes/settings.rs`

Replace the hardcoded `in_enum(&p.default_effort, &["none", …, "max", ""])` (lines 483-488) with a helper that
asks serde, so the list cannot desync from `EffortLevel` again:

```rust
/// `""` is the clear sentinel (`set_or_delete` deletes on empty); anything else
/// must deserialize as an `EffortLevel`.
fn is_effort_or_clear(value: &Option<String>) -> bool {
    match value {
        None | Some(v) if v.is_empty() => true,
        Some(v) => serde_json::from_value::<EffortLevel>(Value::String(v.clone())).is_ok(),
    }
}
```

(Write it with whatever match arms compile cleanly — the contract is: absent valid, `""` valid, otherwise
serde decides.) Import `EffortLevel` from `mainframe_types` and `serde_json::Value` as needed. Leave the other
`in_enum` calls and the `in_enum` helper itself alone — they guard genuinely local string enums.

**Verify:**
1. `cargo test -p mainframe-server --test routes_settings default_effort` from `packages/core-rs` — all green.
2. `cargo check -p mainframe-server`.
3. `cargo fmt --check` and `cargo clippy -p mainframe-server -p mainframe-db` from `packages/core-rs`.

---

## Final verification (whole change)

Run after every group has landed:

1. `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit && pnpm --filter @qlan-ro/mainframe-types build`
2. `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/__tests__/effort-clamp.test.ts`
3. `pnpm --filter @qlan-ro/mainframe-ui typecheck`
4. The three UI vitest files from task 6, one at a time.
5. From `packages/core-rs`: `cargo test -p mainframe-db --test chats`,
   `cargo test -p mainframe-server --test routes_settings`, `cargo test -p mainframe-server --lib set_effort`,
   `cargo fmt --check`.
6. A changeset exists under `.changeset/`.

No E2E run is planned for this change. Every acceptance criterion is reachable from unit and route tests, and
the repo convention is to batch E2E at the end of a series rather than per-change.

## Acceptance-criteria trace

| Criterion (brief) | Covered by |
|---|---|
| Union accepts `ultra`; rank > `max`, matching Rust | 1, 5 |
| Seven pre-existing levels clamp exactly as before | 1 |
| `ultra` against a non-supporting model → default, else highest supported | 1, 2 |
| Composer shows a labelled `ultra` option only when advertised | 3, 6 |
| Settings default-effort select offers `ultra` under the same rule | 4, 6 |
| PATCH `ultra` persists and reads back | 9, 10, 11 |
| PUT `defaultEffort: ultra` succeeds; rejection test inverted; bogus still rejected | 8, 12 |
| Existing rows (seven values, NULL) unaffected | 9, 11 |
| UI typecheck passes; types rebuilds | 5, 6 |
| Changeset | 7 |

## Decisions and flagged items

1. **Testid convention (brief correction).** The brief's `composer-effort-select-option-<effort>` does not
   exist in the repo. The real composer convention is `composer-model-<modelId>-effort-<level>` and this plan
   uses it. The settings pattern in the brief (`settings-<adapterId>-default-effort-option-<effort>`) is
   correct and unchanged.
2. **Label copy — flagged for the reviewer.** Task 6 uses the PM's approved string: `Ultra` /
   "Maximum reasoning; delegates to sub-agents proactively." It collides with the neighbouring `max` entry,
   whose label is literally **Maximum** and whose description is "Maximum reasoning depth" — a dropdown where
   the level above Maximum is described as "Maximum reasoning" reads as a mistake. Suggested alternative:
   **"Deepest reasoning; delegates to sub-agents."** One-line edit either way; left at the PM's string because
   it is an approved-brief decision, not the architect's to overturn.
3. **`EFFORT_RANK` stays unexported.** The "rank is 7 / above `max`" criterion is asserted behaviourally
   through `clampEffortToSupported`, not by exporting a private table for a test. Task 5 step 4 pins the
   numeric parity with Rust by inspection.
4. **`VALID_EFFORTS` is deleted, not extended.** It was fully redundant with the serde call it guarded, and it
   is the exact mechanism that made `ultra` half-supported. Same reasoning drives task 12's serde-derived
   validator; the `""` clear sentinel is preserved explicitly.
5. **No impl task for the chat PATCH route.** `parse_effort_field` is already pure serde (verified at
   `routes/chats.rs:259`). Task 10 pins that as a passing test rather than pretending it is red.
6. **Task 3 appends to a 924-line test file.** `ProviderModelSelect.test.tsx` already exceeds the 300-line
   limit; the alternative is duplicating its ~100-line `renderSelect`/`openFlyout` harness into a new file.
   Reusing the proven harness wins over both duplicating it and splitting the file in a bugfix PR. Splitting
   that file is genuinely separate work.
7. **Red TS tests carry `@ts-expect-error`; red Rust tests do not.** Explained under *Test strategy*; task 5
   removes every suppression and the compiler enforces that none survive.
