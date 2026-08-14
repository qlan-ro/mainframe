# Tasks panel in the session rail: order by most recent

Todo #334 · branch `todo/334-tasks-panel-recent-order` · 2026-08-14

## Goal

The session rail's Tasks panel (`TasksCard`) renders the todos-plugin backlog in the order the daemon returns it — status, then an inert `order_index`, then `created_at` ascending — so the panel shows in-progress tasks first, then open tasks, each block oldest-first. A task typed into the quick-add row at the top of the panel therefore lands at the very bottom of the list. This change keeps the status precedence (in-progress ahead of open) and reverses the within-block order to last-updated first, so a task you just created or just edited sits at the top of its block. The ordering goes into the UI's existing pure sort module (`todos-filters.ts`) as a new exported helper, not into the daemon's SQL: one endpoint feeds two surfaces, and the full Tasks board already re-sorts client-side to priority. The daemon, the list route, its SQL, and the response shape are unchanged.

## Established facts

Each line is a behavior verified while planning, with its receipt. Implementers and reviewers should trust these rather than re-deriving them.

- The list route orders by `status, order_index, created_at` — `packages/core-rs/crates/mainframe-plugins/src/todos.rs:317` (`SELECT * FROM todos WHERE project_id = ? ORDER BY status, order_index, created_at`). `status` is a TEXT column, so ascending SQLite collation yields `done` < `in_progress` < `open`; with `done` filtered out client-side the visible order is in-progress, then open.
- `order_index` is written as the literal `0` on every insert and by nothing else — `packages/core-rs/crates/mainframe-plugins/src/todos.rs:357` (`int(0)` in the insert params). It is inert; the plan does not read or write it.
- Create stamps `created_at` and `updated_at` from the same `now` — `packages/core-rs/crates/mainframe-plugins/src/todos.rs:358-359` (`text(now.clone()), text(now.clone())`). A freshly created task therefore has the newest `updated_at` in its block, so last-updated ordering covers "just created" for free.
- Timestamps are millisecond-precision ISO-8601 with a `Z` suffix — `packages/core-rs/crates/mainframe-runtime/src/time.rs:20-22` plus the assertion at `:48-54` (`must be millis-precision ISO-8601`, length 24). Two tasks created in the same second do not tie.
- `PATCH /todos/:id` always writes `updated_at`, before any field-specific set — `packages/core-rs/crates/mainframe-plugins/src/todos.rs:391` (`let mut sets = vec!["updated_at = ?".to_string()]`). Editing title, body, priority, or status refreshes the timestamp.
- The status-move route writes `updated_at` too — `packages/core-rs/crates/mainframe-plugins/src/todos.rs:518` (`UPDATE todos SET status = ?, updated_at = ? WHERE id = ?`).
- `sortTodos` already supports an `updated` key in both directions over `new Date(updated_at).getTime()` — `packages/ui/src/features/tasks/todos-filters.ts:43-44` — and returns a copy (`const copy = [...todos]`, `:32`), so callers may sort the result in place without mutating their input.
- `Array.prototype.sort` is required to be stable — ECMA-262 §23.1.3.30 (`Array.prototype.sort`), stability mandated since ES2019; see also MDN, "Array.prototype.sort — the sort is stable". A stable second pass over a recency-sorted array preserves recency inside each status block.
- `noUncheckedIndexedAccess` is on for the UI package — `packages/ui/tsconfig.json:19` (with `"strict": true` at `:15`). A `Record<...>` lookup types as `T | undefined` in arithmetic, so a rank lookup needs a `?? fallback`, exactly as `PRIORITY_RANK` does at `packages/ui/src/features/tasks/todos-filters.ts:40`.
- The store refetches after every mutation: `create` and `update` both `await get().load(port, projectId)` — `packages/ui/src/features/tasks/use-todos-store.ts:81-90` (`move` and `remove` at `:92-100` do the same). No component-level reload is needed for a new or edited task to reach the panel in the new order.
- The panel's edit modal saves through that same store action — `packages/ui/src/features/tasks/sidebar/use-task-form.ts:75` (`await update(port, todo.id, input, projectId)`), reached from `TasksCard`'s `TaskEditModal` mount at `packages/ui/src/features/session-panel/TasksCard.tsx:210-224`.
- The full Tasks board sorts independently of the panel — `packages/ui/src/features/tasks/TasksBoard.tsx:55-58` calls `sortTodos(todos.filter(...), sort)` with the store's `sort`, defaulting to `{ key: 'priority', dir: 'asc' }` (`packages/ui/src/features/tasks/use-todos-store.ts:34`). Adding a panel-only helper cannot change the board's order.
- The panel today renders `todos.filter((t) => t.status !== 'done')` verbatim with no sort — `packages/ui/src/features/session-panel/TasksCard.tsx:169` and the map at `:193-204`. Row test ids are `session-panel-task-row-${todo.number}` (`:197`), keyed by the task number, not by array index.
- The E2E suite addresses panel rows by test id only, with no order assertions — `packages/e2e/tests-tauri/tasks.spec.ts:182` and `packages/e2e/tests-tauri/session-panel.spec.ts:429-431` use `getByTestId('session-panel-tasks-*')`. No E2E spec needs updating.
- `docs/plans/` is gitignored — `.gitignore:53`. This plan is committed with `git add -f`.

## Design

Add one exported helper to `packages/ui/src/features/tasks/todos-filters.ts`:

```ts
export function orderByStatusThenRecency(todos: Todo[]): Todo[]
```

Two passes, in this order:

1. `sortTodos(todos, { key: 'updated', dir: 'desc' })` — reuses the existing, already-tested `updated` key and returns a fresh array.
2. A stable in-place `.sort` on that array by a status rank (`in_progress: 0`, `open: 1`, `done: 2`), read through `?? 3` for `noUncheckedIndexedAccess`.

Stability (see Established facts) means pass 2 groups by status without disturbing the recency order inside each group. The helper is total over all three statuses so it never depends on the caller having filtered; the panel still filters `done` out itself, because the count badge and the empty state read from the same filtered array.

Deliberate choices:

- **Ties.** Two tasks with an identical `updated_at` keep their relative server order (status, `order_index`, `created_at`) through both stable passes. That is deterministic; no extra tiebreak column is introduced.
- **`order_index` is untouched.** The brief forbids repurposing it, and it is always zero anyway.
- **No daemon change.** No SQL edit, no sort query parameter, no response-shape change.
- **No new panel affordance.** No sort control, no filter, no pagination.

`TasksCard` changes on one line: `const active = todos.filter((t) => t.status !== 'done')` becomes a filter wrapped in the helper. Nothing else in the component moves.

## Files touched

| File | Change |
|------|--------|
| `packages/ui/src/features/tasks/todos-filters.ts` | Add `ACTIVE_STATUS_RANK` + `orderByStatusThenRecency`; update the module docstring |
| `packages/ui/src/features/tasks/__tests__/todos-filters.test.ts` | Add an `orderByStatusThenRecency` describe block |
| `packages/ui/src/features/session-panel/TasksCard.tsx` | Wrap the active-task filter in the helper; import it |
| `packages/ui/src/features/session-panel/__tests__/TasksCard.test.tsx` | Add a rendered-row-order case; give the shared fixtures distinct timestamps |
| `.changeset/tasks-panel-recent-order.md` | New patch changeset for `@qlan-ro/mainframe-ui` |

Not touched: the todos plugin (`packages/core-rs/crates/mainframe-plugins/src/todos.rs`), `use-todos-store.ts`, `TasksBoard.tsx`, `SortMenu.tsx`, and every E2E spec.

## Constraints from CLAUDE.md

- Max 300 lines per file, 50 per function. `todos-filters.ts` is 65 lines today and gains ~15; `TasksCard.tsx` is 227 and gains 2. Both stay well inside the limit.
- Pure logic lives outside React in a tested module — satisfied by putting the comparator in `todos-filters.ts`.
- `data-testid` keyed by domain id, not array index — the existing `session-panel-task-row-${todo.number}` already complies and must not change.
- A changeset is required before committing; the pre-push hook rejects a PR without one.
- Typecheck must pass: `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

## Tasks

Implementation is split into ordered groups because Task 4 imports the export Task 3 adds, and Task 6 verifies the combined output of Tasks 3 and 4. Only Tasks 1 and 2 (disjoint files, no shared output) and Task 5 (a standalone changeset) may run concurrently with anything.

### Group A — red-phase unit tests

Tasks 1 and 2. They touch disjoint files and may run concurrently. Both run before any implementation group.

These tests are written first and must be observed failing before any implementation exists.

**Task 1 — helper unit tests (red).**
File: `packages/ui/src/features/tasks/__tests__/todos-filters.test.ts`.
Import `orderByStatusThenRecency` alongside the existing imports at line 28 and add one `describe('orderByStatusThenRecency', ...)` block at the end of the file, following the file's existing `makeTodo` fixture helper. Cases:

1. In-progress tasks come before open tasks, whatever the input order.
2. Within the in-progress block, newer `updated_at` first.
3. Within the open block, newer `updated_at` first.
4. A shuffled input with distinct timestamps produces the same output as the sorted input (determinism).
5. The input array is not mutated (assert the caller's array still holds its original order afterwards).
6. `done` tasks, if present, sort last — the helper is total, even though the panel filters them.

Use distinct millisecond-precision ISO timestamps in every fixture so no case depends on tie behavior.

Verification: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/todos-filters.test.ts` fails, and the failure is "orderByStatusThenRecency is not a function" or the equivalent import error — not an assertion mismatch in an unrelated block.

**Task 2 — panel render-order test (red).**
File: `packages/ui/src/features/session-panel/__tests__/TasksCard.test.tsx`.
Give the module-level fixtures distinct timestamps (`OPEN_TODO`, `IN_PROGRESS_TODO`, `DONE_TODO` at lines 80-82 all share `2026-06-01T00:00:00.000Z` today via `makeTodo`), and add fixtures for a second open task and a second in-progress task. Then add a `describe('TasksCard — row order', ...)` block with:

1. A mixed-status fixture rendered through the existing `renderLoaded` helper, asserting the DOM order of the rows. Collect the rendered rows in document order — e.g. `screen.getAllByTestId(/^session-panel-task-row-/)` mapped to their `data-testid` — and compare against the expected array: both in-progress tasks newest-first, then both open tasks newest-first.
2. The same fixture supplied in a shuffled array order produces the identical rendered order.

Do not change the existing cases in that file beyond the fixture timestamps; the row-count, badge, done-hidden, quick-add, attachment, and modal cases must keep passing unchanged.

Verification: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-panel/__tests__/TasksCard.test.tsx` — the two new cases fail on the order assertion, every pre-existing case in the file still passes.

### Group B — ordering helper

Task 3. Runs after Group A.

**Task 3 — the ordering helper.**
File: `packages/ui/src/features/tasks/todos-filters.ts`.
Add above `extractAllLabels`:

- A module-level `const ACTIVE_STATUS_RANK: Record<TodoStatus, number> = { in_progress: 0, open: 1, done: 2 };`, importing `TodoStatus` from `@/lib/api/todos` alongside the existing type imports at line 9.
- `export function orderByStatusThenRecency(todos: Todo[]): Todo[]` implementing the two passes described under Design. Read ranks as `(ACTIVE_STATUS_RANK[a.status] ?? 3)` — required by `noUncheckedIndexedAccess`, mirroring line 40.
- One short comment stating *why* the second pass may be in-place and why it does not disturb recency (the `sortTodos` copy plus sort stability). No comment narrating what the code does.

Extend the module docstring's first paragraph to name the panel as the second consumer. Do not touch `sortTodos`, `matchesFilters`, `extractAllLabels`, or the exported types.

Verification: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/todos-filters.test.ts` is fully green, including every pre-existing `sortTodos` block.

### Group C — panel wiring

Task 4. Runs after Group B: it imports `orderByStatusThenRecency`, which does not exist until Task 3 lands, and its gate runs the test file Task 2 wrote.

**Task 4 — wire the panel.**
File: `packages/ui/src/features/session-panel/TasksCard.tsx`.
Extend the existing import from `@/features/tasks/todos-filters` (line 24) to bring in `orderByStatusThenRecency`, and change line 169 to wrap the filter:

```ts
const active = orderByStatusThenRecency(todos.filter((t) => t.status !== 'done'));
```

Nothing else changes: the count badge keeps reading `active.length`, the empty state keeps reading `active.length === 0`, and the row `key`/`data-testid` stay keyed by `todo.id`/`todo.number`.

Verification: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-panel/__tests__/TasksCard.test.tsx` is fully green, new cases included.

### Group D — changeset

Task 5. No ordering constraint: it touches a file no other task reads.

**Task 5 — changeset.**
File: `.changeset/tasks-panel-recent-order.md`.
A patch bump for `@qlan-ro/mainframe-ui` with a one-line summary in the user's voice, e.g. "The session rail's Tasks panel now lists recently touched tasks first, with in-progress tasks above open ones."

Verification: the file exists with valid frontmatter (`'@qlan-ro/mainframe-ui': patch`) and the repo's other changesets parse the same way.

### Group E — verification sweep

Task 6. Runs last, after Groups B and C: it verifies their combined output, so starting it while either is still being written reports failures that mean nothing.

**Task 6 — typecheck and full-file test sweep.**
Run `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it covers test files, unlike the build) and re-run both touched test files individually. Do not run the whole UI suite in one batch — large multi-suite runs hit the known cross-file `React.act` failure.

Verification: typecheck exits 0; both single-file vitest runs are green.

## Acceptance criteria mapped to tasks

| Criterion | Covered by |
|-----------|-----------|
| In-progress tasks list before open tasks | Tasks 1, 2, 3, 4 |
| Newest-updated first within each block | Tasks 1, 2, 3, 4 |
| A quick-add task becomes the first open row without a reload | Store refetch (Established facts) + equal insert timestamps; asserted through Task 2's ordering, since a new task carries the newest `updated_at` |
| An edited task moves to the top of its block on refetch | PATCH always stamps `updated_at` (Established facts) + Task 1 case 3 |
| Completed tasks stay hidden, badge meaning unchanged | Existing `TasksCard` cases, kept passing by Tasks 2 and 4 |
| The full Tasks board is unaffected | No file the board reads is changed; `sortTodos` is untouched (Task 3) |
| Unit tests cover the helper and the rendered order | Tasks 1 and 2 |
| Row test ids stay keyed by task number | Task 4 leaves line 197 alone; Task 2 asserts on those ids |

## Out of scope

The todos plugin's list route, its SQL, its response shape, and any sort query parameter. Manual reordering and making `order_index` live. Any new panel control (sort, filter, pagination). The "Plan" section and in-transcript task cards. The Tasks board's default sort. Session list ordering (#331). Switching the panel to live WS updates.

## Risks

- **Fixture timestamps.** Every existing `TasksCard` fixture shares one timestamp today. Task 2 changes them; if a pre-existing case silently depended on the old array order, it will surface there. Run the whole file, not just the new cases.
- **Two consumers, one module.** `todos-filters.ts` is imported by both the board and the panel. Adding an export cannot change the board's behavior, but the board's tests in `todos-filters.test.ts` must stay green — Task 3's verification requires the full file, not only the new block.
