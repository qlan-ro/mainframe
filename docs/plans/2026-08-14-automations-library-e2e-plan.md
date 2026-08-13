# Automations library — e2e coverage (todo #323)

## Goal

The Automations library ships three behaviors with no end-to-end coverage: a per-row delete that
goes through the shared confirm dialog, a project badge that names the owning project or reads
"All projects" for an unscoped automation, and a list that the daemon scopes to the selected
project plus the unscoped rows. Unit tests cover `LibraryRow` in isolation and Rust route tests
cover the query filter, so the untested seam is the wired UI against a live daemon. This plan adds
one Playwright spec — `packages/e2e/tests-tauri/automations-library.spec.ts` — that pins delete
(accepted and cancelled), the badge in both states, and cross-project scoping in both directions,
plus one REST seeding helper it needs. No product code changes.

## Scope

**In:** one new spec file, one new helper function in the existing e2e setup helper, one changeset.

**Out:** the sidebar pending-interaction dot (needs a paused-run fixture that does not exist), the
automation editor / describe / run / run-history / enable-toggle surfaces, host open-close from the
sidebar (covered in `sidebar-chrome.spec.ts`), server-side filter tests (the Rust route already has
them), and any product-code change. If a scenario turns out to be unreachable because of a product
bug, stop and report it — do not fix it here.

## Ambiguity resolutions

Read these before writing a line; two of them contradict the brief.

1. **Reopening the automations host does NOT re-fetch the library.** The brief offers "reopen the
   host or reload" as the way to force a re-fetch after seeding. Only half of that is true.
   `AutomationsHost` is mounted unconditionally in `AppShell` and its load effect depends on
   `[projectId, setActiveProjectId, loadAll]` — `open` is absent — and `LibraryList` has no mount
   fetch of its own. The only refresh triggers are **a change of active project id** and **a page
   reload**. Every scenario in this spec therefore uses the refresh recipe below; nothing waits on
   an event or on reopening the dialog.
2. **A null active project id fetches EVERYTHING.** With no active session,
   `useActiveIdentity().projectId` is undefined, the store's `activeProjectId` is `null`, and
   `listAutomations(null)` omits the query param — which the daemon reads as "return every
   automation". Every assertion in this spec must first pin the active project by making that
   project's seeded chat the active session, or the scoping tests pass — or fail — for the wrong
   reason.
3. **Pin the scope through the active session, not the project-filter row.** The library's scope
   comes from `useActiveIdentity().projectId` — the active *session's* project. The
   `sidebar-project-<id>` filter row usually moves both together, but the two can desync across a
   reload (the filter selection and the boot session auto-selection are separate mechanisms), and a
   filter row that already reads `aria-pressed="true"` would then skip a click the scope still
   needed. Select the target project's seeded chat row directly instead; it is deterministic and
   needs no assumption about what survives a reload.

## The refresh recipe

Every scenario seeds over REST and then brings the UI to a freshly fetched library for a chosen
project. Encode it once, as a local helper in the spec — `openLibraryFor(page, chatId)`, keyed by
the target project's seeded chat, not by its project id:

```
seed over REST
→ page.reload()
→ waitConnected(page)
→ click sidebar-project-all
   (clearing the filter only WIDENS the list — it never switches the active session — so both
    projects' rows are visible to click next)
→ click sessionsSidebar(page).row(chatId) for the target project's seeded chat, and wait for
   data-active="true" on it
   (activating a chat in another project changes the active project id, which re-fetches; if it
    was already active nothing changes, and that is fine — the boot fetch after the reload
    already ran with that same project id)
→ click sidebar-action-automations
→ wait for automations-library to be visible
```

Closing the host between scenarios is `automations-close`.

Row clicks in this sidebar get eaten by `SessionRow`'s HoverCard, so reuse the
park-the-pointer-then-retry idiom from `sessions-filters.spec.ts:85-108` (`selectRow`) rather than
a bare `click()`.

## Established facts

Every external/protocol/dependency behavior verified while planning, with its receipt. Trust these;
do not re-derive them.

- The library re-fetches only on an active-project-id change or a page reload — the effect's deps
  are `[projectId, setActiveProjectId, loadAll]`, with no `open`:
  `packages/ui/src/features/automations/AutomationsHost.tsx:41-44`.
- `LibraryList` has no mount-time fetch; it renders whatever the store holds — the file contains no
  `useEffect` at all: `packages/ui/src/features/automations/library/LibraryList.tsx:1-115`.
- `listAutomations(null)` omits `?projectId=` entirely: `packages/ui/src/lib/api/automations.ts:29-30`.
- The daemon returns everything when the param is absent, and the selected project's automations
  **plus** every unscoped (`project_id` null) one when it is present:
  `packages/core-rs/crates/mainframe-server/src/routes/automations.rs:76-89` (`is_none_or(|p| p == pid)`).
- The minimal accepted create body is one `notify` step with no triggers —
  `{"name":…,"scope":"global","definition":{"triggers":[],"steps":[{"id":"n1","kind":"notify","message":["done"]}]}}`:
  `packages/core-rs/crates/mainframe-server/src/routes/automations_test_support.rs:121-131`.
  The project-scoped variant is the same body with `"scope":"project"` and `"projectId": <id>`:
  `packages/core-rs/crates/mainframe-server/src/routes/automations/automations_tests.rs:37-42`.
- `AutomationCreateInput` is `deny_unknown_fields` — an extra key makes `POST /api/automations`
  return 400 `invalid automation body`:
  `packages/core-rs/crates/mainframe-automations/src/domain/automation.rs:26-36` and
  `packages/core-rs/crates/mainframe-server/src/routes/automations.rs:100-102`.
- Routes are WS4-enveloped: create returns `{ data: { id, … } }`
  (`packages/core-rs/crates/mainframe-server/src/routes/automations.rs:104`), delete returns the
  empty envelope (`…/routes/automations.rs:138`).
- The row passes `automations-delete-confirm` as the dialog testid
  (`packages/ui/src/features/automations/library/LibraryRow.tsx:93`), and the shared `ConfirmDialog`
  derives its buttons from that root as `<testid>-cancel` and `<testid>-confirm`:
  `packages/ui/src/features/shared/ConfirmDialog.tsx:90,99`.
- The badge renders the owning project's `name` from the loaded project list, the literal
  `All projects` when `projectId` is null, and falls back to the raw id for an unknown project:
  `packages/ui/src/features/automations/library/LibraryRow.tsx:57-60,146`.
- A seeded project's `name` is `path.basename(projectPath)` — so the scoped badge's expected text is
  that basename: `packages/e2e/helpers/tauri/setup.ts:35`.
- Nothing broadcasts an automation-created/deleted event. `useAutomationEvents` handles five
  `automation.*` events, none of which patch `definitions`
  (`packages/ui/src/features/automations/data/use-automation-events.ts:24-40`), and the create route
  emits nothing (`packages/core-rs/crates/mainframe-server/src/routes/automations.rs:96-106`). A
  post-boot seed is invisible until a refresh.
- Clicking `sidebar-project-<id>` filters the list **and** activates that project's most recent
  session, which is what changes the active project id; a second click on the active row is a no-op.
  Pinned by `packages/e2e/tests-tauri/sessions-filters.spec.ts:152-171` (switch) and `:174-198`
  (re-click is inert).
- Clicking `sidebar-project-all` only widens the list — it never switches the active session:
  `packages/e2e/tests-tauri/sessions-filters.spec.ts:67-68` and the assertion at `:194-198`.
- Session-row clicks need the hover-card workaround (park the pointer at 0,0, then retry the click
  until `data-active="true"`): `packages/e2e/tests-tauri/sessions-filters.spec.ts:85-108`.
- Each `launchTauriApp` starts a daemon on a fresh `mkdtemp` data dir
  (`packages/e2e/fixtures/daemon.ts:166`) and the automations DB lives inside it
  (`packages/core-rs/crates/mainframe-server/src/automations_deps/mod.rs:98`). Seeded automations die
  with the describe's daemon; only the project directories need `cleanupTauriProject`.
- The library section is the default body of `AutomationsView` (rendered when no run/editor/describe/
  details target is set): `packages/ui/src/features/automations/AutomationsView.tsx:62-78`.
- `docs/plans/` is gitignored (`.gitignore:53`), so this plan is committed with `git add -f`.

## Tasks

### T1 — Seeding helper `createTauriAutomation`

**File:** `packages/e2e/helpers/tauri/setup.ts` (add next to `createTauriChat`; do not create a new
module — this is the REST-seeding helper file).

Add an exported async function that POSTs a minimal automation and returns its id:

- Signature: `createTauriAutomation(opts: { name: string; projectId?: string }): Promise<string>`.
- Body: the `notify_body` shape from the established facts. When `opts.projectId` is given, send
  `scope: 'project'` and `projectId`; otherwise send `scope: 'global'` and omit `projectId`
  entirely (`deny_unknown_fields` tolerates the omission, not a null).
- Throw with status + response text when `!res.ok`, mirroring `createTauriChat`.
- Read the id from `body.data.id`; throw if it is missing.
- One-line doc comment stating that the caller must force a re-fetch (reload or project switch)
  because nothing broadcasts a create.

**Verify:** `pnpm --filter @qlan-ro/mainframe-e2e exec tsc --noEmit -p tsconfig.json` passes.

### T2 — Spec skeleton, fixture, and refresh helper

**File:** `packages/e2e/tests-tauri/automations-library.spec.ts` (new).

- House-style header comment: a `§automations-library` title naming the surface, a note that every
  test runs in `E2E_MODE=mock` and never sends a message (so **no** `recordingKey`), the full testid
  reference (`sidebar-action-automations`, `automations-host`, `automations-view`,
  `automations-close`, `automations-section-library`, `automations-library`,
  `automations-library-row-<id>`, `automations-library-delete-<id>`,
  `automations-library-project-<id>`, `automations-delete-confirm`,
  `automations-delete-confirm-confirm`, `automations-delete-confirm-cancel`,
  `sidebar-project-<projectId>`), and a short paragraph restating ambiguity resolutions 1–3 —
  a future reader will otherwise "simplify" the reload away.
- One `test.describe`, one `launchTauriApp()` in `beforeAll`, `closeTauriApp` +
  `cleanupTauriProject` for both projects in `afterAll`. One describe on purpose: the browser/app
  launch cost is per-describe.
- `beforeAll` seeds project A + one chat in it, then project B + one chat in it (mirroring
  `sessions-filters.spec.ts:126-135`; `createTauriProject` reloads the page and REST-seeded chats
  survive it).
- Local helper `openLibraryFor(page, chatId)` implementing the refresh recipe verbatim — keyed by
  the target project's seeded chat id, so the active session (and therefore the library's scope) is
  pinned deterministically — and `closeLibrary(page)` clicking `automations-close` and asserting
  `automations-host` reaches count 0. Keep `chatIdA`/`chatIdB` in describe scope beside the two
  projects.
- No tests yet beyond a placeholder that opens and closes the library for project A, so the
  skeleton is provably green before behavior lands.

**Verify:** `cd packages/e2e && E2E_MODE=mock pnpm exec playwright test tests-tauri/automations-library.spec.ts`
passes (first run builds the daemon and the UI bundle; `MF_E2E_SKIP_BUILD=1` on reruns).

### T3 — Delete, confirmed (implement FIRST of the behavior tests)

**File:** `packages/e2e/tests-tauri/automations-library.spec.ts`.

This test is first on purpose: the confirm dialog is a Radix `AlertDialog` raised from inside the
modal automations `Dialog`, and that nesting is the spec's one real technical risk. Prove it here
before building on it.

- Seed a project-A-scoped automation with a name unique to this test, then `openLibraryFor(chatIdA)`.
- Assert `automations-library-row-<id>` is visible; click `automations-library-delete-<id>`.
- Assert `automations-delete-confirm` is visible and contains the automation's name.
- Click `automations-delete-confirm-confirm`; assert the dialog reaches count 0 and
  `automations-library-row-<id>` reaches count 0.
- Close the library, run `openLibraryFor(chatIdA)` again, and assert the row is still count 0 — the
  deletion survives a real re-fetch, not just the local `removeDefinition` patch.

**Do not** reach for `click({ force: true })` or keyboard-only interaction if the confirm button is
not clickable. A forced click hides exactly the defect it would be masking. If the dialog is
genuinely unreachable, stop and report it as a product bug per the brief.

**Verify:** the single spec file passes; the test fails for the right reason if you temporarily
point the locator at a wrong id.

### T4 — Delete, cancelled

**File:** `packages/e2e/tests-tauri/automations-library.spec.ts`.

- Seed a second project-A-scoped automation with its own name; `openLibraryFor(chatIdA)`.
- Click its delete action, assert `automations-delete-confirm` is visible, click
  `automations-delete-confirm-cancel`.
- Assert the dialog reaches count 0 and `automations-library-row-<id>` is still visible.
- Close, `openLibraryFor(chatIdA)` again, assert the row is still visible — the automation was never
  deleted server-side.

**Verify:** the single spec file passes.

### T5 — Project badge, scoped and unscoped

**File:** `packages/e2e/tests-tauri/automations-library.spec.ts`.

Two tests, each seeding its own automation so neither depends on T3/T4 leftovers.

- Scoped: seed an automation with `projectId = A`; `openLibraryFor(chatIdA)`; assert
  `automations-library-project-<id>` has text equal to `path.basename(projectA.projectPath)` (the
  seeded project's name).
- Unscoped: seed an automation with no project scope; `openLibraryFor(chatIdA)`; assert
  `automations-library-project-<id>` has text `All projects`.

**Verify:** the single spec file passes.

### T6 — Cross-project scoping, both directions

**File:** `packages/e2e/tests-tauri/automations-library.spec.ts`.

- Negative: seed an automation scoped to project A; `openLibraryFor(chatIdB)`; assert
  `automations-library-row-<id>` has count 0. Guard the assertion against a false pass by also
  asserting `automations-library` is visible and that the unscoped automation's row (below) IS
  present in the same view — an empty library would otherwise satisfy the negative on its own.
- Positive: with an unscoped automation seeded, assert its row is visible from project B and, after
  `openLibraryFor(chatIdA)`, from project A too.

Both directions can share one `openLibraryFor(chatIdB)` pass; keep them as two named tests so a failure
names the direction.

**Verify:** the single spec file passes.

### T7 — Changeset

**File:** a new file under `.changeset/` (e.g. `automations-library-e2e-coverage.md`).

- `pnpm changeset`, select `@qlan-ro/mainframe-e2e`, bump `patch`. One sentence: what the new spec
  covers.

**Verify:** the file exists and names the package; the pre-push hook accepts the branch.

### T8 — Full-suite verification

- `pnpm --filter @qlan-ro/mainframe-e2e exec tsc --noEmit -p tsconfig.json`.
- `cd packages/e2e && E2E_MODE=mock MF_E2E_SKIP_BUILD=1 pnpm exec playwright test` — the whole
  `tauri` project, green, with no regression in an existing spec. The suite gates only in the
  Release workflow, so local green is the real signal.
- Optional hygiene: `pnpm --filter @qlan-ro/mainframe-e2e testids` refreshes
  `packages/e2e/UNUSED-TESTIDS.md` if the newly asserted ids are listed there. Not gated by CI.

## Risks

- **Nested Radix modals.** The confirm `AlertDialog` opens on top of the modal automations `Dialog`.
  Both portal to `<body>` and each applies its own scroll-lock, so the later layer should own
  pointer events — but this exact nesting has no existing e2e precedent (`sessions-tag-delete-confirm`
  is raised from a popover, not a modal). T3 front-loads the risk. If it fails, report a product
  bug rather than forcing the click.
- **Boot-fetch timing.** After `page.reload()` the library fetch races the project list and the
  active-session resolution. `openLibraryFor` must wait for `automations-library` to be visible and
  assert on rows with Playwright's auto-retrying `expect`, never a fixed sleep.
- **Order coupling inside the describe.** Tests share one app and run in file order. Seeding a
  distinct automation per concern keeps them independent; do not reuse one automation across the
  delete and badge tests.
