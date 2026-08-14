# Implementation plan — project scope for the Kanban board and the Automations library

Todo #326 · route:full · branch `todo/326-automations-kanban-project`
Spec: `docs/specs/2026-08-14-todo-326-automations-kanban-project.md`

## Goal

Give the Kanban modal and the Automations library each their own project scope that lives only as
long as that open. Each modal seeds its scope on the rising edge of its open from the sidebar's
persisted project filter, falling back to the active session's project, then to the only project,
then to unscoped; names the project in its header through a picker that changes what the modal
shows; and writes nothing back — not to the sidebar filter, not to the other modal, not to disk.
Every read and write inside a modal follows its own scope, an open modal ignores background
session and filter changes, and opening either entry always produces a surface instead of today's
silent no-op. No daemon contract changes: the todos endpoints are project-keyed and the automations
list already takes a `projectId` filter.

## Established facts

Every line below was verified in this worktree while planning. Downstream implementers and
reviewers should trust these instead of re-deriving them.

1. `GET /api/automations?projectId=X` returns that project's automations **plus** every automation
   with a null `project_id`; with no param it returns **everything**, not "the unscoped set" —
   `packages/core-rs/crates/mainframe-server/src/routes/automations.rs:76-89`
   (`.filter(|a| a.project_id.as_deref().is_none_or(|p| p == pid))`, `None => list`). This is the
   receipt for spec decision 7.
2. `listInteractions()` takes no project argument, so the pending-interaction badge is inherently
   global — `packages/ui/src/lib/api/automations.ts` (`listAutomationInteractions`) and
   `packages/ui/src/features/automations/data/use-automations-store.ts:79`.
3. The sidebar filter is persisted to `localStorage` under the daemon-scoped key
   `mf:filterProjectId` and survives reload/restart — `packages/ui/src/store/session-filters.ts:17,
   32-49`. Nothing in this work may call `setFilterProjectId`.
4. `TasksModalHost` returns `null` when `useActiveIdentity()` has no `projectId` — this is the
   no-op Kanban click and the dead ⌘⇧T — `packages/ui/src/features/tasks/TasksModalHost.tsx:73`.
5. `AutomationsHost` re-scopes the store and reloads on **every** active-project change, whether or
   not the modal is open — `packages/ui/src/features/automations/AutomationsHost.tsx:41-44`.
6. `loadAll()` reads `get().activeProjectId` rather than taking a parameter, which is why one
   global field currently answers for three consumers — `use-automations-store.ts:71-97`.
7. The Automations editor saves to `store.activeProjectId` and blocks saving when it is null with
   the message "Pick an active project first." —
   `packages/ui/src/features/automations/editor/AutomationEditor.tsx:105-127`.
8. The editor's project-scoped pickers read the same field: skills/files via
   `features/automations/fields/use-automation-trigger-sources.ts:100-122`, branches via
   `features/automations/steps/agent/WorktreeMenu.tsx:38-39`.
9. `useAutomationEvents` patches runs and interactions only — it never calls `patchDefinition`, so
   no WS path can inject a foreign project's automation into a scoped list —
   `features/automations/data/use-automation-events.ts:24-41`.
10. `useAutomationToasts` renders toast copy from event fields (`event.automationName`,
    `event.title`, `event.links`) and never reads `store.definitions` —
    `features/automations/data/use-automation-toasts.ts:43-66`. A boot load that fetches
    interactions without definitions therefore does not degrade toasts.
11. `useTodosStore` holds **one** flat `todos` array plus a single module-level `_loadSeq`
    counter — `packages/ui/src/features/tasks/use-todos-store.ts:37, 58-79`.
12. A second live consumer shares that array: the session panel's `TasksCard` loads and renders it
    for the **active session's** project — `features/session-panel/TasksCard.tsx:154-169`. It
    filters by status only, never by project.
13. `useActiveIdentity()` is draft-aware: it resolves a `__LOCALID_*` draft's chosen project before
    the first send — `features/sessions/use-active-identity.ts:41-72`. Seeding rule step 2 can rely
    on it.
14. `useProjects()` fetches asynchronously and returns `[]` while loading —
    `features/sessions/use-projects.ts:37-53`. The seeding rule must tolerate an empty list at the
    instant a modal opens.
15. Shipped pattern for "chip that displays the project and changes it": `WelcomeState`'s
    `ProjectPicker` — a `DropdownMenu` trigger rendering `ProjectChip`, content of
    `ProjectAvatar` + name rows — `features/sessions/new-thread/WelcomeState.tsx:33-72`.
16. Shipped pattern for "no project yet, pick one": `ImportSessionsDialog`'s `ProjectPicker` — a
    plain `Button variant="ghost"` list of `ProjectAvatar` + name rows, filtered project sorted
    first — `features/sessions/ImportSessionsDialog.tsx:25-54`.
17. **Trap in that same file:** its re-seed effect keys on `[open, filterProjectId]`
    (`ImportSessionsDialog.tsx:75-77`), so it re-seeds when the filter changes *while open*.
    Copying it verbatim violates spec AC8 — seed on the rising edge of `open` only.

## Constraints

- Max 300 lines per file, 50 per function (root `CLAUDE.md`). `TasksBoard.tsx` is already 207
  lines; the header picker must come in as the shared `ModalProjectPicker` component, not inline
  markup.
- `data-testid` on every interactive element, `<surface>-<element>` kebab-case, keyed by project id
  or todo id — never by array index.
- Any markup or class name written in `packages/ui` goes through the `mainframe-design-system`
  skill. All new components mirror a shipped pattern (facts 15 and 16); no new visual treatments.
- Single canonical type; pure logic (the seeding rule) lives outside React so it is unit-testable.
- Every PR needs a changeset.
- Run single test files: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` — large
  multi-suite runs hit cross-file `React.act` failures.
- Typecheck with `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it includes test files).

## Design decisions taken in this plan

- **New shared feature directory `packages/ui/src/features/project-scope/`.** Both surfaces need
  the same seeding rule, the same header chip picker and the same pick-a-project list; a shared
  directory beats duplicating three files per surface. Nothing in it imports `layout/` or either
  consuming feature.
- **The todos store becomes per-project.** Fact 12 makes a flat store a correctness bug under this
  work: opening the board on project B overwrites the array the session panel is rendering for
  project A. Keying server state by project id is the smallest fix that lets both consumers hold
  different projects at once, and it makes the spec's "a scope change lands mid-load" edge
  expressible (per-project sequence guard instead of one module counter — fact 11).
- **The automations store's `loadAll` splits in two.** `loadInteractions()` feeds the always-on
  badge; `loadLibrary(projectId)` feeds the modal. The boot load calls only the first, so the badge
  keeps counting without fetching every project's definitions and their run histories.
- **`TasksModalHost`'s two load effects are dropped.** Both key on the active identity, which is no
  longer the modal's scope. The todo #225 intent (fresh data on every open) survives because
  `TasksBoard` loads on mount and Radix unmounts `DialogContent` on close — the host effect was
  already redundant for the full modal (its own comment says so) and quick-add gets an explicit
  load in its place.
- **Quick-add names its project but does not get a full picker.** The spec requires it to seed by
  the same rule, to show a surface always, and to name the project it will write to; it does not
  require in-dialog re-scoping. A `ProjectChip` in its header plus the shared pick-a-project state
  when unresolved satisfies every criterion with less surface.

## Task list

### Group A — seed-rule red tests

These are written and observed failing **before** Group B exists. The commit will not typecheck
until Group B lands; that is expected under the red-phase contract, and nobody should stub the
missing modules to make it green.

Exact signatures Group B must satisfy (pin these; the tests import them):

```ts
// features/project-scope/seed-project-scope.ts
export function seedProjectScope(input: {
  filterProjectId: string | null;
  sessionProjectId: string | null;
  projects: readonly { id: string }[];
}): string | null;

// features/project-scope/use-modal-project-scope.ts
export function useModalProjectScope(open: boolean): {
  projectId: string | null;
  setProjectId: (id: string | null) => void;
};
```

**Task 1 — unit-test the seeding rule.**
Create `packages/ui/src/features/project-scope/__tests__/seed-project-scope.test.ts`. Cases:
(a) filter names a project present in `projects` → that id;
(b) filter names an id absent from `projects` → falls through to `sessionProjectId`;
(c) filter null, `sessionProjectId` set → that id;
(d) filter null, session null, exactly one project → that project's id;
(e) filter null, session null, two or more projects → `null`;
(f) filter null, session null, `projects` empty → `null`;
(g) `sessionProjectId` names an id absent from `projects` → `null` (a stale session project is no
better than a stale filter).
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/project-scope/__tests__/seed-project-scope.test.ts` — fails on the missing module.

**Task 2 — unit-test the per-open hook.**
Create `packages/ui/src/features/project-scope/__tests__/use-modal-project-scope.test.tsx`. Mock
`@/features/sessions/use-projects` and `@/features/sessions/use-active-identity`; use the real
`useSessionFilters`. Cases:
(a) rendering with `open=false` then flipping to `true` seeds from the filter;
(b) changing `filterProjectId` **while open** does not change the returned `projectId`;
(c) changing the mocked active identity while open does not change it;
(d) `setProjectId('other')` changes the returned value and leaves
`useSessionFilters.getState().filterProjectId` **and** `localStorage.getItem` for the daemon-scoped
`mf:filterProjectId` key untouched (spec AC5, AC17);
(e) closing and reopening re-seeds from the filter's current value, discarding the override
(spec AC7);
(f) opening while `useProjects()` is still returning `[]`, then having it resolve, seeds once from
the resolved list and does not re-seed again afterwards (fact 14).
Verify: same single-file vitest command — fails on the missing module.

### Group B — the shared project-scope seam

**Task 3 — the pure seeding rule.**
Create `packages/ui/src/features/project-scope/seed-project-scope.ts` with `seedProjectScope` as
signed above. No React, no store imports. Order: filter (validated against `projects`) → session
project (validated the same way) → sole project → `null`.
Verify: task 1's test file passes; `typecheck`.

**Task 4 — the per-open scope hook.**
Create `packages/ui/src/features/project-scope/use-modal-project-scope.ts`. It reads
`useSessionFilters((s) => s.filterProjectId)`, `useActiveIdentity().projectId` and
`useProjects().projects`, and holds `useState<string | null>`. Seed on the **rising edge of `open`
only**, tracked with a `useRef<boolean>` of the previous `open` (fact 17 — do not key the effect on
the filter). One extra guard: if the rising-edge seed ran while `projects` was empty, seed once
more when a non-empty list first arrives, then stop (a `useRef` "seeded" latch). Reset to `null` on
the falling edge so a reopen cannot show a stale override before its effect runs. `setProjectId`
writes local state and nothing else — no store, no localStorage. The hook returns only
`{ projectId, setProjectId }`; consumers that need the project list call `useProjects()`
themselves. Keep the file under 100 lines.
Verify: task 2's test file passes; `typecheck`.

**Task 5 — the in-header project picker.**
Create `packages/ui/src/features/project-scope/ModalProjectPicker.tsx`. Props:
`{ surface: string; projectId: string | null; projects: Project[]; onSelect: (id: string | null) => void; allowAllProjects?: boolean; disabled?: boolean }`.
Mirror fact 15: a `DropdownMenu` whose trigger renders `ProjectChip` (or a "Choose a project"
affordance when `projectId` is null, or "All projects" when `allowAllProjects` and null) plus a
`ChevronDown`, and whose content lists `ProjectAvatar` + name rows. When `allowAllProjects`, the
content leads with an "All projects" row that calls `onSelect(null)`. When `disabled`, the trigger
is a non-interactive rendering of the same chip (spec AC13). Testids: trigger
`` `${surface}-project-picker` ``, content `` `${surface}-project-picker-menu` ``, rows
`` `${surface}-project-${project.id}` `` and `` `${surface}-project-all` ``.
Verify: `typecheck`; render smoke covered by Group E.

**Task 6 — the pick-a-project state.**
Create `packages/ui/src/features/project-scope/ProjectPickList.tsx`. Props:
`{ surface: string; projects: Project[]; filterProjectId: string | null; onSelect: (id: string) => void }`.
Mirror fact 16 exactly: `Hint` (project path) wrapping a ghost `Button` per project with
`ProjectAvatar` + truncated name, filtered project sorted first, rest alphabetical. When `projects`
is empty, render the zero-projects copy instead of a list: heading "No projects yet" and the line
"Add a project to start tracking tasks here." (spec's zero-projects edge). Testids: root
`` `${surface}-project-pick` ``, rows `` `${surface}-project-${project.id}` ``, empty state
`` `${surface}-project-pick-empty` ``.
Verify: `typecheck`.

### Group C — the Kanban board

**Task 7 — red test for a per-project todos store.**
Extend `packages/ui/src/features/tasks/__tests__/use-todos-store.test.ts`. New cases:
(a) `load(port, 'A')` then `load(port, 'B')` leaves both projects' todos readable side by side;
(b) a slow `listTodos` for A resolving **after** a load for B does not clobber B's bucket, and a
slow load for B resolving after a newer load for B **is** dropped (per-project sequence guard,
replacing the single module counter of fact 11);
(c) `create/update/move/remove` refetch only the project they were given.
Update the existing `loadedProjectId` assertions in this file to the new shape in the same task.
Verify: the file fails on the new cases.

**Task 8 — key the todos store by project.**
Rewrite `packages/ui/src/features/tasks/use-todos-store.ts` to hold
`entries: Record<string, { todos: Todo[]; loading: boolean; error: string | null }>` in place of
the flat `todos`/`loading`/`error`/`loadedProjectId` fields, with a module-level
`Map<string, number>` of load sequences instead of `_loadSeq`. Keep `filters`, `sort`, `view` global
(the spec puts filters and sorting out of scope). Export
`selectProjectTodos(projectId: string | null)` returning a stable empty entry for `null` and for
unseen projects. Mutation signatures do not change.
Verify: task 7's file passes; `typecheck`.

**Task 9 — move both todos consumers onto the bucketed selector.**
Update `packages/ui/src/features/tasks/TasksBoard.tsx` and
`packages/ui/src/features/session-panel/TasksCard.tsx` to read through `selectProjectTodos` with
their own project id. Update the store-shape `setState` calls in
`packages/ui/src/features/session-panel/__tests__/TasksCard.test.tsx` and
`packages/ui/src/features/tasks/__tests__/TasksModalHost.test.tsx` so they still compile.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-panel/__tests__/TasksCard.test.tsx`;
`typecheck`.

**Task 10 — per-open scope in the Kanban host.**
Rewrite `packages/ui/src/features/tasks/TasksModalHost.tsx`:
- delete the `if (!projectId) return null` early return (fact 4) and both load effects (the boot
  load and the quick-add rising-edge refetch);
- call `useModalProjectScope(open)` for the board and a **separate** `useModalProjectScope(quickOpen)`
  for quick-add, so the two never share a pick (spec decision 11);
- render `TasksBoard` when the board scope resolves, otherwise `ProjectPickList` with
  `surface="tasks-board"` inside the same `DialogContent`, choosing a project by calling the board
  scope's `setProjectId`;
- render `QuickTaskDialog` when its scope resolves, otherwise the same `ProjectPickList` with
  `surface="tasks-quick"` inside the quick-add dialog;
- if the scope's project disappears from `useProjects()` while open, fall back to the
  pick-a-project state (spec's project-removed-while-open edge) — derive this from the projects
  list at render, do not add an effect;
- keep the ⌘⇧T and `mf:open-tasks` listeners unchanged.
Keep the file under 300 lines; extract the two dialog bodies into local components in the same file
if it grows past that.
Verify: `typecheck`; manual reasoning against spec AC11.

**Task 11 — name and change the board's project.**
Update `packages/ui/src/features/tasks/TasksBoard.tsx`: add
`projects: Project[]` and `onProjectChange: (id: string) => void` props, and render
`<ModalProjectPicker surface="tasks-board" allowAllProjects={false} …/>` in the header band next to
the "Tasks" label. Wire the picker to `onProjectChange`, which the host routes into its board
scope. The existing mount-effect `load(port, projectId)` already reloads on a project change, and
task 8 guarantees the previous project's rows are not on screen (spec AC4) because the board reads
its own bucket. Reset `editTodo` to `undefined` when `projectId` changes so an open edit modal
cannot survive a re-scope.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/TasksBoard.test.tsx`;
`typecheck`.

**Task 12 — name quick-add's project and rewrite the host's tests.**
Add a `ProjectChip` naming the target project to `QuickTaskDialog`'s header
(`packages/ui/src/features/tasks/QuickTaskDialog.tsx`, testid `tasks-quick-project`) — it already
receives `projectId`; it needs `projectName` from the caller. Add a mount-time
`load(port, projectId)` there to replace the host effect this plan drops. Then rewrite
`packages/ui/src/features/tasks/__tests__/TasksModalHost.test.tsx`: its `useActiveIdentity` mock and
its boot-load assertion both describe the old design. Keep the todo #225 intent by asserting that
each open (board and quick-add) issues a `listTodos` for the scoped project.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/TasksModalHost.test.tsx`
and `… src/features/tasks/__tests__/QuickTaskDialog.test.tsx`; `typecheck`.

### Group D — the Automations library

**Task 13 — split the automations store's project answer.**
Update `packages/ui/src/features/automations/data/use-automations-store.ts`:
- rename `activeProjectId` → `scopeProjectId` and `setActiveProjectId` → `setScopeProjectId` (the
  field now means "the open modal's scope", not "the active session's project");
- replace `loadAll()` with `loadInteractions(): Promise<void>` (interactions only, feeding the
  badge) and `loadLibrary(projectId: string | null): Promise<void>` (definitions + their runs +
  catalog + credentials, taking the project **as a parameter** rather than reading state — fact 6);
- give each its own sequence guard so a slow response for the previous project never replaces the
  newly picked one (spec's mid-load edge);
- update the doc comment: the field no longer tracks the session.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/data/__tests__/use-automations-store.test.ts`;
`typecheck`.

**Task 14 — per-open scope in the Automations host.**
Update `packages/ui/src/features/automations/AutomationsHost.tsx`: delete the session-following
effect (fact 5). Instead, call `loadInteractions()` once on mount (badge from boot, spec AC14).
Take the scope from `useModalProjectScope(open)` and sync it into the store from an effect keyed on
**the hook's `projectId` while `open`** — not on the rising edge of `open` alone: that effect must
also fire for the picker's change and for the late seed of task 4's latch (fact 14 — the projects
list can still be empty at the instant the modal opens, and a rising-edge-only wiring would leave
the store on `null` while the header names the seeded project). The effect calls
`setScopeProjectId(id)` then `loadLibrary(id)`, in that order. On close, clear the store scope to
`null`. Keep `useAutomationToasts()` and `useAutomationEvents()` unconditional and ahead of any
early return.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/__tests__/AutomationsHost.test.tsx`;
`typecheck`.

**Task 15 — name and change the library's project.**
Update `packages/ui/src/features/automations/AutomationsView.tsx`: render
`<ModalProjectPicker surface="automations" allowAllProjects />` in the header band beside the
"Workflows" label, fed by the host's scope. Selecting a project (or "All projects") calls the
host's `setProjectId`, which sets `scopeProjectId` and calls `loadLibrary(id)`. Pass
`disabled={runId != null || editorTarget != null || describeOpen || detailsAutomationId != null}`
so the picker is inoperable while a sub-view is open and operable again on return (spec AC13). The
`automations-title-count` "N need you" figure stays wired to `selectPendingInteractionCount` —
global, unaffected by scope (spec's "counts that stay global").
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/__tests__/AutomationsView.test.tsx`;
`typecheck`.

**Task 16 — library list under the new loader.**
Update `packages/ui/src/features/automations/library/LibraryList.tsx`: both retry affordances call
`loadLibrary(scopeProjectId)` instead of `loadAll()`. Nothing else in the list changes — the
per-row project badge already covers the "All projects" view (spec decision 6).
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/library/__tests__/LibraryList.test.tsx`;
`typecheck`.

**Task 17 — editor and pickers follow the modal scope.**
Point the three project-scoped consumers at `scopeProjectId`:
`packages/ui/src/features/automations/editor/AutomationEditor.tsx` (fact 7 — save target and the
validation issue), `packages/ui/src/features/automations/fields/use-automation-trigger-sources.ts`
(skills and file search, fact 8) and
`packages/ui/src/features/automations/steps/agent/WorktreeMenu.tsx` (branches, fact 8). Change the
editor's blocking message from "Pick an active project first." to "Pick a project in the header to
save this automation." — the scope is now something the user can change without leaving the modal
(spec: "Creating an automation is unavailable until a single project is picked, and the editor
says so").
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/automations/editor/__tests__/AutomationEditor.test.tsx`;
`typecheck`.

**Task 18 — carry the rename through the existing automations tests.**
Mechanical `activeProjectId` → `scopeProjectId` in every `setState`/assertion across
`features/automations/**/__tests__/`, `features/automations/steps/agent/__tests__/WorktreeMenu.test.tsx`,
`features/automations/fields/__tests__/*` and
`components/trigger-engine/__tests__/trigger-popover-placement.test.tsx`, plus any `loadAll` call
sites in those files. This lands with Group D so the rename never leaves the suite red for another
agent.
Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck` clean, and each touched test file passes
under its own single-file vitest run.

### Group E — surface behavior tests and the changeset

Only **new** files here, so this group collides with nothing.

**Task 19 — Kanban scope behavior test.**
Create `packages/ui/src/features/tasks/__tests__/TasksModalHost.scope.test.tsx` against the real
`useSessionFilters`, `useModalProjectScope` and `useTodosStore` with `@/lib/api/todos` mocked.
Assert: session in A + filter on B opens the board on B and the header names B (AC1); the in-modal
picker changes the list and no A row remains (AC3, AC4); the picker leaves
`useSessionFilters.getState().filterProjectId` unchanged (AC5); changing the filter or the mocked
active identity while open leaves the header and list unchanged, and the next open shows the new
seed (AC8); close-and-reopen after an override shows the filter's project (AC7); create/move/delete
issue their calls with the scoped project id (AC9); with no session, a projectless draft and the
filter unset, clicking Kanban renders either the board or `tasks-board-project-pick` — never
nothing (AC11).
Verify: single-file vitest run passes.

**Task 20 — quick-add reachability test.**
Create `packages/ui/src/features/tasks/__tests__/QuickTaskDialog.scope.test.tsx`. Assert the ⌘⇧T
path always produces a dialog: scoped and naming its project when one resolves, and rendering
`tasks-quick-project-pick` otherwise (AC12); and that quick-add's scope is independent of an open
board's pick (spec decision 11 and its edge case).
Verify: single-file vitest run passes.

**Task 21 — Automations scope behavior test.**
Create `packages/ui/src/features/automations/__tests__/AutomationsScope.test.tsx` against the
fixture gateway. Assert: session in A + filter on B lists B's automations plus the unscoped ones
and names B (AC2, using fact 1's semantics); the picker re-scopes and reloads (AC3, AC4); it leaves
the sidebar filter untouched (AC5); after an override in the Kanban modal the Automations modal
still opens on the filter's project (AC6 — drive both hosts in one render); the picker is
inoperable while `editorTarget`/`runId`/`describeOpen`/`detailsAutomationId` is set and operable
after returning to the library (AC13); a created automation carries the scoped project id and the
editor's skills/files/branch sources are queried for it (AC10); and the sidebar's pending badge is
present after mount with the modal never opened and unchanged by a scope change (AC14).
Verify: single-file vitest run passes.

**Task 22 — testid audit and changeset.**
Grep the diff for every element added by tasks 5, 6, 11, 12 and 15 and confirm each carries a
`<surface>-<element>` testid keyed by project id where per-row (AC15). Then
`pnpm changeset` — patch bump for `@qlan-ro/mainframe-ui`, one line describing the per-open project
scope for both sidebar modals.
Verify: the changeset file exists under `.changeset/`; `pnpm --filter @qlan-ro/mainframe-ui typecheck`
and the five touched suites pass.

## Risks

- **The todos store rewrite (tasks 7-9) is the largest blast radius in this plan.** Eight files
  import `useTodosStore`; only three read its server state, but the `setState` shape appears in
  three test files. Landing tasks 7-9 as one reviewable step before anything else in Group C keeps
  the failure mode legible.
- **`TasksBoard.tsx` is at 207 lines and gains a picker plus two props.** If it crosses 300, the
  header band extracts to a sibling `TasksBoardHeader.tsx` rather than the picker growing inline.
- **Two `useModalProjectScope` instances in one host** (board and quick-add) each subscribe to
  `useProjects()`, which fetches per hook. That is two `getProjects` calls on mount. Acceptable —
  `useProjects` is already called this way across the sidebar — but worth watching if the projects
  list ever gets expensive.
