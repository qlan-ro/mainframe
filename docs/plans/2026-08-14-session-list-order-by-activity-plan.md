# Session list: order every group by recent activity (todo #331)

## Goal

The sessions sidebar's "Project" sort mode groups sessions into one section per project but never sorts a
section's contents, so each project's rows appear in whatever order the client first saw them — an order that
differs between app restarts and drifts as the app runs. Make `arrangeSessions` order every group it emits by
last-activity timestamp descending, and make every sort mode produce a *total* order so no mode can inherit the
incoming array's order for ties. The change is confined to one pure view-model module in `packages/ui` and its
unit test file: the daemon already returns the right order, and the thread-list runtime between the wire and the
sidebar destroys it by design (see Established facts), so a daemon-side change could not reach the screen.

## Scope

**Touched files (all of them):**

| File | Change |
|---|---|
| `packages/ui/src/features/sessions/view-model/__tests__/group-sessions.test.ts` | Update 1 assertion, add ordering + shuffle-invariance tests |
| `packages/ui/src/features/sessions/view-model/group-sessions.ts` | Add a total comparator; apply it in all four modes |
| `.changeset/session-list-order-by-activity.md` | New — patch bump for `@qlan-ro/mainframe-ui` |

**Not touched, deliberately:** the Rust daemon (already orders `pinned DESC, updated_at DESC`), `chats-remote-adapter.ts`,
`project-activity.ts` (section ordering is already shuffle-invariant), `archived-sessions.ts`, `SessionSidebar.tsx`,
`SessionsSection.tsx`, `SessionSortMenu.tsx`, `SESSION_SORTS`, the E2E suite (no spec asserts sidebar ordering —
`packages/e2e/tests` has no reference to `sessions-sort-*`).

**Constraints from CLAUDE.md that bind this change:**
- Max 300 lines/file, 50 lines/function. `group-sessions.ts` is 141 lines today and lands around 175 — no split needed.
- Pure logic stays in the view-model module, not in a React component or hook body. `arrangeSessions` keeps its
  `now`-injected signature so tests stay deterministic.
- `noUncheckedIndexedAccess: true` (`packages/ui/tsconfig.json:19`) — avoid raw index reads in test helpers.
- `noUnusedLocals` / `noUnusedParameters: true` (`packages/ui/tsconfig.json:16-17`) and `"include": ["src"]` (`:26`),
  which covers `__tests__`. **Every helper, constant, and function must land in the same task as its first
  consumer** — an intermediate commit that adds an unused module-scope declaration fails `typecheck` with TS6133,
  and the same rule kills any "introduce it now, wire it up next task" split on the implementation side.
- A changeset is required before commit; the pre-push hook rejects without one.
- No `@ts-ignore`, no dead code, no deferred cleanups.

## Design

### The total comparator

Add one module-private comparator to `group-sessions.ts` and route every sort through it:

```
byRecency(a, b) = (b.custom.updatedAt - a.custom.updatedAt) || compareIds(a, b)
compareIds(a, b) = a.id < b.id ? -1 : a.id > b.id ? 1 : 0
```

`compareIds` uses raw `<`/`>` (UTF-16 code-unit order), not `localeCompare`, so the result cannot vary with the
host locale. `byRecency` replaces the existing `byUpdatedDesc`, which is deleted — it has no remaining caller.

### Per-mode application

| Mode | Rest ordering | Pinned ordering |
|---|---|---|
| `recent` | `byRecency` inside each of Today / Yesterday / Earlier (unchanged key, now total) | `byRecency` (unchanged) |
| `name` | `(a.title ?? '').localeCompare(b.title ?? '') \|\| byRecency(a, b)` | `byRecency` (**was unsorted**) |
| `status` | `rankDelta \|\| byRecency(a, b)` | `byRecency` (**was unsorted**) |
| `project` | `byRecency` inside every section, known and ghost (**was unsorted**) | `byRecency` (unchanged) |

`arrangeFlat` currently pushes `pinned` straight through (`group-sessions.ts:69`), which is the same array-order
leak on the `name` and `status` modes. It takes a sorted `pinned` from the caller, or sorts internally — either
is fine, as long as the leak is gone.

### Ghost sections (projects absent from the project list)

Known-project sections stay in `sortedProjects` order and still lead; ghost sections still trail all of them.
Within the ghost run, order by the bucket's newest `updatedAt` descending, then by `projectId` ascending
(UTF-16 order). The current "first appearance" rule is array-order-derived and cannot survive the shuffle
criterion. The module doc comment on `arrangeByProject` says "in order of first appearance" — update it.

### Decisions taken while planning

1. **Pinned is ordered by recency in every mode, not by the mode's own key.** The brief says the Pinned section
   "keeps its existing behavior (pinned sessions lifted out, sorted by the same key)", and the two modes that
   already sort it (`recent`, `project`) sort it by recency. Making name-mode Pinned alphabetical would be a
   larger, unrequested behavior change. Recency everywhere is the minimal reading that also closes the leak.
2. **Ghost sections are ordered by bucket recency, then `projectId`.** Not named in the brief, but the
   shuffle-invariance criterion covers group *order* as well as group contents, and "first appearance" is exactly
   the array-order dependence the brief forbids.
3. **`id` is the final tiebreak, beyond the brief's explicit asks.** The brief asks for "a total order"; two
   sessions can genuinely share an `updatedAt` (it is an ISO string rendered to ms), and without a final key such
   a pair falls back to array order. `SessionItem.id` is the stable thread-list mapping id, so it is a safe,
   unique last resort.
4. **The comparator stays local to `group-sessions.ts`.** The `updatedAt`-descending expression also appears in
   `archived-sessions.ts:19` — two sites, below the repo's 3+ extraction threshold. Extracting it would change
   the archived dialog's ordering (adding the id tiebreak) and its tests, which is scope creep on a bug fix.

### Out of scope (do not "fix" these in this pass)

- `arrangeFlat` emits its `A–Z` / `By status` group even when `rest` is empty. Pre-existing, unrelated to
  ordering, and shuffle-invariant either way.
- Persisting the sort mode across restarts; new sort modes; running-first or unread-first ordering; the rail
  Tasks panel (#334); the daemon's chat list route; the thread-list runtime's record merge.

## Established facts

Every line below was verified in this repo or in resolved `node_modules` while planning. Paths are repo-relative
from `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-331-session-list-order-by-activity`.

- The array the sidebar consumes is built with `Object.keys(runtimeState.threadItems).map(...)` — its order is the
  record's key-insertion order, not any sort. Receipt: `node_modules/@assistant-ui/core/dist/store/runtime-clients/thread-list-runtime-client.js:46`.
- `threadItems` is that record: `get threadItems() { return this._state.value.threadData; }`, typed
  `Readonly<Record<THREAD_MAPPING_ID, RemoteThreadData>>`. Receipts:
  `node_modules/@assistant-ui/core/dist/react/runtimes/RemoteThreadListThreadListRuntimeCore.js:35-37`,
  `.../RemoteThreadListThreadListRuntimeCore.d.ts:29`.
- Each list refresh merges by spread — `threadData: { ...state.threadData, ...fresh.threadData }` — so an existing
  chat's entry is refreshed **in place** (keeping its key position) and a newly seen chat's key is **appended**.
  This is why rendered order equals "order this client first saw each session". Receipt:
  `node_modules/@assistant-ui/core/dist/react/runtimes/RemoteThreadListThreadListRuntimeCore.js:63-70` (same
  pattern for `loadMore` at `:101-115`).
- `@assistant-ui/react` is pinned at `0.15.13`. Receipt: `node_modules/@assistant-ui/react/package.json` (`version`).
- The daemon does return the right order; it is discarded downstream. Receipts:
  `packages/core-rs/crates/mainframe-db/src/chats.rs:144` (`ORDER BY pinned DESC, updated_at DESC`), `:153`
  (`... , rowid DESC`), `:201`.
- The daemon bumps `chats.updated_at` on message send and on turn results, so it reads as "last turn activity".
  Receipts: `packages/core-rs/crates/mainframe-chat/src/chat_manager/send_entry.rs:120-127` (`set_working`
  writes `updated_at: Some(now)`), `packages/core-rs/crates/mainframe-chat/src/event_handler.rs:814-822`
  (result handler writes `updated_at: Some(now.clone())`).
- `updated_at` is written only when a caller passes it — `ChatUpdate.updated_at` is an explicit `Option<String>`
  field, so config edits (pin/rename/tuning) that omit it do not bump the timestamp. Receipts:
  `packages/core-rs/crates/mainframe-db/src/chats.rs:65` (field), `:374-376` (the conditional `SET`).
- `chat.updated` triggers `threads.reload()` (coalesced), so a live send re-lists and refreshes `updatedAt` in
  place — no restart needed for a row to move. Receipts:
  `packages/ui/src/features/sessions/ws/use-session-list-router.ts:7-8,112-124`.
- The ordering key reaches the UI as epoch ms: `updatedAt: new Date(chat.updatedAt).getTime()`. Receipt:
  `packages/ui/src/features/sessions/view-model/chat-to-thread-custom.ts:72`.
- Project *section* order is already shuffle-invariant: max `updatedAt` per project descending, tiebroken by the
  project list's own index. Receipt: `packages/ui/src/features/sessions/view-model/project-activity.ts:4-19`,
  called at `packages/ui/src/features/sessions/SessionSidebar.tsx:103` and passed into `arrangeSessions` at `:112`.
- `arrangeSessions` has exactly one production caller. Receipt: `packages/ui/src/features/sessions/SessionSidebar.tsx:112`.
- `Array.prototype.sort` is stable (ES2019+), so the existing sorts do not scramble ties — they *preserve* the
  untrustworthy incoming order, which is the defect. Receipt: verified on this machine's Node v24.13.1 —
  sorting 12 equal-key records by `(x, y) => x.k - y.k` returned them in the original index order `0..11`.
- `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui` are version-locked, so a UI-only patch changeset is
  correct and the release tooling bumps both. Receipt: `.changeset/config.json` → `"fixed": [["@qlan-ro/mainframe-types", "@qlan-ro/mainframe-ui"]]`.
- `docs/plans/` is gitignored, so this plan is committed with `git add -f`. Receipt: `.gitignore:53`.
- The UI package compiles with `noUncheckedIndexedAccess: true`, so a test helper must not read array slots by
  index without a guard. Receipt: `packages/ui/tsconfig.json:19`.
- The same options block sets `noUnusedLocals`/`noUnusedParameters: true` (`:16-17`) and `"include": ["src"]` (`:26`),
  so the test file is typechecked and **any** unused top-level declaration — `const` fixtures included, not only
  functions — is a hard error. Receipt: dropping a throwaway file with one unused `const` and one unused function
  into `src/features/sessions/view-model/__tests__/` and running the repo's own `packages/ui/node_modules/.bin/tsc
  --noEmit` reported `error TS6133: 'UNUSED_CONST' is declared but its value is never read.` and the same for the
  function. This is why the task list has no "add helpers" step of its own.
- Only one pre-existing assertion orders two sessions that share the default `updatedAt` (`TODAY_1100` from the
  `item()` helper): `group-sessions.test.ts:155` (`idsOf(groups, 'Beta')` → `['b1','b2']`). Every other multi-item
  assertion uses distinct timestamps, titles, or statuses, so the new `id` tiebreak cannot silently flip them.
  Receipts: `group-sessions.test.ts:88,122,129,155,193`.
- `arrangeByProject` already sorts the Pinned group (`group-sessions.ts:94`), so project-mode Pinned ordering is a
  regression guard, not a red test. `arrangeFlat` (`:69`) does not, so name-mode and status-mode Pinned ordering
  does start red.

## Tasks

### Group: tests (red phase)

All four tasks edit **one** file:
`packages/ui/src/features/sessions/view-model/__tests__/group-sessions.test.ts`.
Run with `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/view-model/__tests__/group-sessions.test.ts`.

These tests must be written and observed **failing** before `group-sessions.ts` changes. Do not touch
`group-sessions.ts` in this group.

There is deliberately **no "add the helpers" task**. `noUnusedLocals` (see Constraints) makes an unused helper a
typecheck error, so each helper and fixture constant is introduced by the task that first uses it.

**Task 1 — Update the existing project-mode assertion that reads as array order.**
The test at `group-sessions.test.ts:147-157` ("emits one section per project…") builds `b1`/`b2` with the fixture's
default `updatedAt`, so `expect(idsOf(groups, 'Beta')).toEqual(['b1', 'b2'])` asserts nothing about ordering. Give
`b1` an *older* `updatedAt` than `b2` and assert `['b2', 'b1']`. This is the only pre-existing assertion that
orders same-timestamp sessions (see Established facts), so no other existing test needs a fixture change.

*Verification:* that test fails against today's implementation with `['b1','b2']` received; every other test in the
file still passes.

**Task 2 — Add project-mode ordering tests.**
In the `arrangeSessions mode 'project'` describe block. Introduce the timestamp constants these fixtures need in
this task (at least one pair of sessions sharing an identical `updatedAt`, for the ghost-tiebreak case):
- Sessions inside a project section are ordered newest-activity first (≥3 sessions, distinct timestamps,
  inserted in a non-recency input order).
- The unknown-project fallback section is ordered by the same rule.
- With **two** ghost projects, the ghost sections themselves are ordered by their newest session's activity,
  descending, and still trail every known-project section.
- Two ghost buckets whose newest activity is identical are ordered by `projectId` ascending.
- Pinned interaction: a pinned session is lifted out of its project section and that section still renders its
  remaining sessions in recency order.
- Regression guard (**passes today**): a multi-session Pinned group in project mode is recency-ordered.
  `arrangeByProject` already sorts Pinned at `group-sessions.ts:94`; this assertion exists so Tasks 5 and 8,
  which both rewrite that function, cannot regress it.

*Verification:* every assertion above **except** the last one fails against today's implementation; the
regression guard passes from the moment it is written. Record the observed failures.

**Task 3 — Add name-mode and status-mode tie tests.**
- `name`: two sessions with the identical title resolve by `updatedAt` descending; the overall A–Z ordering is
  unchanged for distinct titles.
- `name`: the Pinned group with ≥2 pinned sessions is ordered by `updatedAt` descending.
- `status`: two sessions with the same `displayStatus` resolve by `updatedAt` descending; the
  working → waiting → idle rank order is unchanged.
- `status`: the Pinned group with ≥2 pinned sessions is ordered by `updatedAt` descending.

*Verification:* the four new assertions fail today — `arrangeFlat` (`group-sessions.ts:69`) pushes Pinned
unsorted, and both rest sorts leave ties in incoming order.

**Task 4 — Add the shuffle-invariance property test, with its helpers.**
One `describe('arrangeSessions is independent of input order')` block. Add the helpers it consumes in this same
task — they have no other consumer, and adding them earlier would fail `typecheck` under `noUnusedLocals`:
- A `mulberry32(seed: number): () => number` PRNG (no `Math.random`, so failures reproduce).
- `seededShuffle(items: SessionItem[], seed: number): SessionItem[]` implemented as a decorate–sort–undecorate
  (`items.map((it) => ({ it, k: rand() })).sort((a, b) => a.k - b.k).map((e) => e.it)`) — no indexed swaps, which
  `noUncheckedIndexedAccess` rejects.
- A `serialize(groups)` helper returning `groups.map((g) => [g.label, g.items.map((i) => i.id)])` for whole-output
  comparison.

The test body:
- Build one fixture of ~10 sessions spanning: 2 known projects (`PROJECTS`), 2 ghost projects, ≥2 pinned
  sessions, all three `displayStatus` values, sessions in today/yesterday/earlier buckets, and **planted ties** —
  an equal-`updatedAt` pair and an equal-`title` pair.
- For each mode in `['recent', 'name', 'status', 'project']` and each seed in a fixed list (e.g. `[1, 2, 3, 7, 42]`),
  assert `serialize(arrangeSessions(seededShuffle(fixture, seed), mode, NOW, PROJECTS))` equals
  `serialize(arrangeSessions(fixture, mode, NOW, PROJECTS))`.
- Shuffle only the session array; keep `PROJECTS` fixed (its order is a separate, already-deterministic input).

*Verification:* the test fails today for at least the `project`, `name`, and `status` modes. Planted ties are what
make it meaningful — confirm by reasoning that removing the id tiebreak from the eventual implementation would
re-break it.

### Group: impl

Tasks 5–8 edit **one** file: `packages/ui/src/features/sessions/view-model/group-sessions.ts`.
Task 9 adds one new changeset file. Task 10 is the verification gate.

**Task 5 — Replace `byUpdatedDesc` with the total comparator.**
In `group-sessions.ts`, replace `byUpdatedDesc` (`:41-43`) with `byRecency` per the Design section, plus a
module-private `compareIds`, **and switch all three existing call sites in the same edit** — `arrangeRecent`
(`:60-63`, four sorts) and `arrangeByProject` (`:94`). Deleting the old function without its callers leaves the
file uncompilable, and introducing the new one without callers trips `noUnusedLocals`. One short comment on
`byRecency` explaining *why* the id tiebreak exists (the incoming array order is not a trustworthy fallback).
Leave no alias behind.

*Verification:* `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes; `grep -Rn byUpdatedDesc packages/ui/src`
is empty; the test run introduces **no new failures** — the `recent`-mode tests and the Task 2 regression guard
stay green, and the red tests from Tasks 1–4 stay red except where recency ties in already-sorted groups now
resolve.

**Task 6 — Sort the Pinned group on the flat paths.**
`arrangeFlat` (`:67-72`) pushes `pinned` as received; sort it with `byRecency`. Sort a copy; never mutate the
caller's array.

*Verification:* the two new Pinned tests from Task 3 pass.

**Task 7 — Give `name` and `status` deterministic tiebreaks.**
- `name` (`:123-126`): `(a.title ?? '').localeCompare(b.title ?? '') || byRecency(a, b)`.
- `status` (`:128-133`): `(rankA - rankB) || byRecency(a, b)`, keeping the existing `?? 3` unknown-status rank.

*Verification:* the Task 3 tests pass; the pre-existing name/status tests still pass.

**Task 8 — Order project sections' contents and the ghost run.**
In `arrangeByProject` (`:85-108`):
- Sort each known-project section's items with `byRecency` before pushing.
- Collect the leftover ghost buckets, sort their items with `byRecency`, and emit the sections ordered by each
  bucket's newest `updatedAt` descending, tiebroken by `projectId` ascending — still after every known section.
- Update the function's doc comment: it currently promises "in order of first appearance", which this task
  replaces.
Keep the function under 50 lines; extract a small `ghostSections(...)` helper if it would exceed that.

*Verification:* every project-mode test (Tasks 1, 2) and the shuffle test (Task 4) passes.

**Task 9 — Add the changeset.**
Create `.changeset/session-list-order-by-activity.md` with front matter `'@qlan-ro/mainframe-ui': patch` and a
one-paragraph, user-facing description: grouping sessions by project now lists each project's sessions
most-recently-active first, and every sort mode resolves ties the same way instead of falling back to whatever
order the app happened to receive.

*Verification:* the file exists and its YAML front matter parses (matches the shape of any existing
`.changeset/*.md`).

**Task 10 — Full verification gate.**
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/view-model/__tests__/group-sessions.test.ts` — all green.
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/view-model/__tests__/project-activity.test.ts src/features/sessions/view-model/__tests__/archived-sessions.test.ts` — unchanged neighbours still green.
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean (it includes test files).
- `wc -l packages/ui/src/features/sessions/view-model/group-sessions.ts` — under 300.
- `git diff --stat` shows exactly the three files in the Scope table.

## Acceptance criteria (from the brief, mapped to tasks)

| Criterion | Covered by |
|---|---|
| Project sections list sessions newest-activity first | Tasks 2, 8 |
| The unknown-project fallback section follows the same rule | Tasks 2, 8 |
| Section order unchanged; Pinned still leads | Tasks 2, 8 (assertions), `project-activity.ts` untouched |
| A send moves the session to the top of its section, no restart | Task 2 + the reload receipt in Established facts |
| Shuffled input yields identical output, every mode | Tasks 4, 5–8 |
| Name and status ties resolve by last activity descending | Tasks 3, 7 |
| Existing array-order assertions updated to recency | Task 1 |
| Unit tests cover buckets, fallback, pinned, shuffle invariance | Tasks 1–4 |
