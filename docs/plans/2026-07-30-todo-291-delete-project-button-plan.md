# Todo #291 — Remove Project does nothing (implementation plan)

**Route:** no-spec (plan works from the approved Agent Brief)
**Branch:** `todo/291-delete-project-button` · **Worktree:** `.worktrees/todo-291-delete-project-button`

## Goal

Removing a project from the sessions sidebar must work in the Tauri shell and must tell the truth when it fails. Today both removal affordances (the hover trash button and the right-click "Remove Project" item) route through one handler that gates on `window.confirm()`, which the Tauri `WKUIDelegate` never renders — WebKit resolves it to `false`, so the handler returns before it issues a request. Independently, the daemon's `ChatManager::remove_project` swallows a failed row delete (`ChatManagerDeps::projects_remove` returns unit and only logs), and `DELETE /api/projects/:id` answers `ok_empty()` unconditionally, so a failed delete reaches the client as success and the project reappears on the next list load. This plan replaces the native dialog with the app's own `ConfirmDialog` — driven by a single app-wide confirm bridge promoted out of `features/git` so the app keeps exactly one boolean-confirm mechanism — and makes the removal path return `Result` end to end so the route can answer with the `fail` envelope and the UI can raise an error toast without dropping the row.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file, 50 lines/function; `data-testid` on every interactive element as `<surface>-<element>` kebab-case; tests required for new routes/core logic; no silent catches; changeset required.
- `packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx` is **299 lines** — the removal handler must move out, not grow in place.
- `packages/ui/CLAUDE.md`: feature-first — a feature must not import another feature's internals, so the shared confirm bridge lands in `lib/` + `components/overlays/`, not in `features/git`.
- `AppCtx.chat_manager` is `None` in both server test harnesses (`tests/support/mod.rs`, `ctx.rs::test_ctx`), so the DELETE failure branch cannot be reached over HTTP. The route's response mapping gets a small helper with inline `#[cfg(test)]` tests (the precedent is `crates/mainframe-server/src/respond.rs`).
- Rust CI has a `cargo fmt` gate — every Rust task ends with `cargo fmt`.
- `packages/core-rs` is not an npm package; the changeset bumps `@qlan-ro/mainframe-ui` only (precedent: `.changeset/automations-v2-rust-engine.md`).

## Decisions

- **D1 — Promote the git confirm bridge to one app-wide bridge instead of cloning it into `features/sessions`.** The brief says "reuse … do not introduce a second confirm mechanism". `features/git/use-git-confirm.ts` is already a generic boolean promise-bridge (`title`/`body`/`confirmLabel`/`destructive`); cloning it for sessions would make a third bridge store (git boolean + `features/sessions/runtime/archive-confirm-bridge.ts` three-way + a new one). The store moves to `packages/ui/src/lib/confirm-bridge.ts` with a per-request `testid`, the outlet to `packages/ui/src/components/overlays/ConfirmDialogHost.tsx`, and `features/git/git-confirm.ts` keeps a four-line `requestGitConfirm` wrapper that binds `testid: 'git-confirm-dialog'` so the four git call sites, their test mocks, and `packages/e2e/tests-tauri/git-branch.spec.ts` keep working unchanged in behavior. The three-way archive bridge is out of scope and stays as it is.
- **D2 — The brief's "the client optimistically drops the row" is not what the code does.** `handleRemoveProject` already `await`s `removeProject(...)` before `removeProjectFromList(...)`; the invisible failure comes purely from the daemon reporting success. The ordering is therefore preserved, not changed, and the brief's "wait for the daemon" recommendation is already satisfied.
- **D3 — The route's failure branch is tested through an in-file helper, not over HTTP.** `removal_response(Result<(), String>) -> Response` in `routes/projects.rs` with an inline `#[cfg(test)] mod tests`. Rust inline tests live in the implementation file, so this one test is written by the implementation group rather than the red-phase test group; the chat-manager failure test (the behavior change that makes the envelope possible) is red-phase and comes first.
- **D4 — A failed row delete leaves the project's live sessions already stopped.** The brief pins the ordering (stop sessions and background tasks, forget in-memory state, then delete the row), so a DB failure at the last step cannot be rolled back. The route reports the failure and the row survives; the sessions stay stopped. Accepted, not worked around.

## Out of scope (from the brief)

Project rename (menu item stays disabled) · relocating a project or handling a vanished directory (todo #295) · deleting anything on disk · archiving/exporting sessions before removal · auditing native-dialog use beyond the repo-wide search criterion.

---

## Group A — daemon red-phase tests (`rust-test`)

### Task A1 — failing tests for the propagated row-delete failure

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

1. Add a knob to `StoreDeps` (next to `fail_trust_write`, same doc-comment style):
   ```rust
   /// When `Some`, `projects_remove` records the id and then fails with this message.
   fail_project_remove: Mutex<Option<String>>,
   ```
2. Change the mock impl to the new trait signature:
   ```rust
   fn projects_remove(&self, project_id: &str) -> Result<(), String> {
       self.project_removed.lock().unwrap().push(project_id.to_string());
       match self.fail_project_remove.lock().unwrap().clone() {
           Some(msg) => Err(msg),
           None => Ok(()),
       }
   }
   ```
3. In the existing `calls_kill_tasks_before_session_kill_for_each_chat`, assert the success result: `assert!(mgr.remove_project("p1").await.is_ok());`.
4. Add `remove_project_propagates_a_row_delete_failure` next to it: seed one chat in `p1` with a session (same `seed_active` shape as the existing test), set `*deps.fail_project_remove.lock().unwrap() = Some("database is locked".to_string())`, then assert `mgr.remove_project("p1").await == Err("database is locked".to_string())`, that the per-chat teardown still ran (`order` contains `kill:c1:...` before `sess.kill:c1`), and that `deps.project_removed` recorded `p1` (the delete was attempted).

**Verification:** `cd packages/core-rs && cargo test -p mainframe-chat remove_project` fails to compile against today's `-> ()` trait signature and today's `remove_project` returning unit. That compile failure **is** the red phase — record the exact error in the task's commit message. `cargo fmt` before committing.

---

## Group B — daemon implementation (`rust-impl`, depends on Group A)

### Task B1 — make the deps method and the manager path fallible

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Trait `ChatManagerDeps`: `fn projects_remove(&self, project_id: &str) -> Result<(), String>;` — keep it beside `projects_get_path`, and match the `write_workspace_trust` precedent of `String` errors on this trait.
2. `pub async fn remove_project(&self, project_id: &str) -> Result<(), String>`: the per-chat teardown loop is unchanged; the tail becomes
   ```rust
   self.deps.projects_remove(project_id)?;
   info!(project_id, "project removed");
   Ok(())
   ```
   i.e. move the existing `info!` from the top of the function to after the successful delete, so the log no longer claims a removal that failed.

**Verification:** `cd packages/core-rs && cargo check -p mainframe-chat`.

### Task B2 — return the DB error from the server's deps impl

**File:** `packages/core-rs/crates/mainframe-server/src/chat_deps.rs` (`projects_remove`, ~line 351)

```rust
fn projects_remove(&self, project_id: &str) -> Result<(), String> {
    let pid = project_id.to_string();
    self.db.call_blocking(move |d| d.projects.remove(&pid)).map_err(|err| {
        tracing::warn!(%err, project_id, "projects.remove failed");
        err.to_string()
    })
}
```
The warn stays (no silent catch); the error now also reaches the caller.

**Verification:** `cd packages/core-rs && cargo test -p mainframe-chat` — Group A's two tests pass (green phase).

### Task B3 — answer DELETE with the failure envelope

**File:** `packages/core-rs/crates/mainframe-server/src/routes/projects.rs`

1. Add the testable mapping helper above `remove`:
   ```rust
   /// `ChatManager::remove_project`'s result → the route envelope. Split out
   /// because the route harness cannot build a ChatManager to reach the Err arm.
   fn removal_response(result: Result<(), String>) -> Response {
       match result {
           Ok(()) => ok_empty(),
           Err(err) => fail(StatusCode::INTERNAL_SERVER_ERROR, err),
       }
   }
   ```
2. `remove` keeps its `chat_manager: None` guard verbatim and ends with `removal_response(cm.remove_project(&id).await)`.
3. Update the two stale comments in the file: the `remove` handler's comment ("then `ok_empty()`") and the trailing `PORT STATUS` note now describe the fallible path.
4. Add an inline `#[cfg(test)] mod tests` mirroring `respond.rs`'s shape (`axum::body::to_bytes`, a `body_json` helper):
   - `removal_response_ok_emits_the_empty_success_envelope` → `200`, `{"success": true}`.
   - `removal_response_err_emits_the_failure_envelope_with_the_message` → `500`, `{"success": false, "error": "database is locked"}` — the assertion the brief's acceptance criterion names ("failure envelope, not the empty success envelope").

**Verification:** `cd packages/core-rs && cargo test -p mainframe-server routes::projects` (the two new unit tests) and `cargo test -p mainframe-server --test routes_projects` (the existing integration tests, including `delete_is_phase4_seam_returns_500`, still pass unchanged — that test exercises the `chat_manager: None` guard, which is untouched). Then `cargo fmt` and `cargo clippy -p mainframe-server -p mainframe-chat`.

---

## Group C — UI red-phase tests (`ui-test`)

### Task C1 — confirm-bridge tests

**File (new):** `packages/ui/src/lib/__tests__/confirm-bridge.test.ts`

Cover the store contract that `use-git-confirm.ts` has today but never had a test for:
- `requestConfirm({title})` sets `pending` and returns a promise that stays unsettled.
- `resolve(true)` / `resolve(false)` settle that promise with the boolean and clear `pending`.
- A second `requestConfirm` while one is pending resolves the first with `false` and leaves only the newer request pending.
- `resolve` with nothing pending is a no-op (does not throw).
- `pending.testid` round-trips (the field `ConfirmDialogHost` reads).

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/confirm-bridge.test.ts` → fails, `@/lib/confirm-bridge` does not resolve.

### Task C2 — remove-project hook tests

**File (new):** `packages/ui/src/features/sessions/__tests__/use-remove-project.test.tsx`

Mock `@/lib/api/projects` (`removeProject`), `@/lib/toast` (`mfToast`), `@/lib/confirm-bridge` (`requestConfirm`), `@/store/session-filters`, and `../runtime/daemon-port-context` — follow the mock layout in the sibling `use-add-project.test.tsx`. Render the hook with `renderHook`, passing a `removeProjectFromList` spy. No test may stub `window.confirm`.

Branches:
1. **Confirm** — `requestConfirm` resolves `true`: `removeProject` is called with `(port, project.id)`; `removeProjectFromList(project.id)` is called; `mfToast.success` is called with `'Project removed'` and the project name as the description.
2. **Confirm clears a matching filter** — with `filterProjectId === project.id`, `setFilterProjectId(null)` is called; with a different `filterProjectId`, it is not called.
3. **Cancel** — `requestConfirm` resolves `false`: `removeProject`, `removeProjectFromList`, `setFilterProjectId` and every `mfToast` method are never called.
4. **Daemon failure** — `removeProject` rejects with `new Error('database is locked')`: `mfToast.error` is called with `'Failed to remove project'` and description `'database is locked'`; `removeProjectFromList` and `setFilterProjectId` are never called (the row stays).
5. **Dialog copy** — the `requestConfirm` argument carries the project name, `destructive: true`, and `testid: 'sessions-remove-project-dialog'`.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/__tests__/use-remove-project.test.tsx` → fails, `../use-remove-project` does not resolve.

---

## Group D — UI implementation (`ui-impl`, depends on Group C)

### Task D1 — the shared confirm bridge

**File (new):** `packages/ui/src/lib/confirm-bridge.ts`

Move `features/git/use-git-confirm.ts` verbatim (store, module-level `resolver`, displacement semantics), renaming `GitConfirmRequest` → `ConfirmRequest`, `useGitConfirm` → `useConfirmBridge`, `requestGitConfirm` → `requestConfirm`, and adding two optional fields the outlet needs: `cancelLabel?: string` and `testid?: string`. Rewrite the file docblock to describe an app-wide bridge (why a promise bridge at all: action hooks await a boolean without coupling to React rendering; one dialog at a time).

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/confirm-bridge.test.ts` passes.

### Task D2 — the single root outlet

**File (new):** `packages/ui/src/components/overlays/ConfirmDialogHost.tsx`

The `GitConfirmDialog` body, generalized: read `pending`/`resolve` from `useConfirmBridge`, render `ConfirmDialog` with `open={pending != null}`, forwarding `title`, `body`, `confirmLabel`, `cancelLabel`, `destructive`, and `testid={pending?.testid ?? 'confirm-dialog'}`.

**File (delete):** `packages/ui/src/features/git/GitConfirmDialog.tsx`

**Verification:** covered by D3's e2e-testid check and `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task D3 — repoint git at the shared bridge

1. **File (new):** `packages/ui/src/features/git/git-confirm.ts` — one export, keeping the git dialog's testid in one place:
   ```ts
   export const requestGitConfirm = (opts: Omit<ConfirmRequest, 'testid'>): Promise<boolean> =>
     requestConfirm({ ...opts, testid: 'git-confirm-dialog' });
   ```
   with a docblock saying why the wrapper exists (binds the `git-confirm-dialog` testid the git e2e specs assert).
2. **File (delete):** `packages/ui/src/features/git/use-git-confirm.ts`.
3. Update the import path (`./use-git-confirm` → `./git-confirm`) in `packages/ui/src/features/git/use-branch-actions.ts` (3 call sites, import at line 31) and `packages/ui/src/features/git/use-worktree-actions.ts` (1 call site, import at line 10). The call-site option objects do not change.
4. Update the `vi.mock` paths in `packages/ui/src/features/git/__tests__/use-branch-actions.test.ts` and `packages/ui/src/features/git/__tests__/BranchPopover.test.tsx` to the new module.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/git/__tests__/use-branch-actions.test.ts` and `... src/features/git/__tests__/BranchPopover.test.tsx` pass; `grep -rn "use-git-confirm" packages/ui/src packages/e2e` returns nothing; `grep -rn "git-confirm-dialog" packages/ui/src` returns only `git-confirm.ts`.

### Task D4 — the remove-project hook

**File (new):** `packages/ui/src/features/sessions/use-remove-project.ts`

Mirror `use-add-project.ts` (same docblock rationale for taking the list mutator as an argument — `useProjects` is per-caller `useState`, so a fresh instance here would update nothing the sidebar renders):

```ts
export function useRemoveProject(
  removeProjectFromList: (projectId: string) => void,
): (project: Project) => Promise<void>
```

Body: read `useDaemonPort()` and `useSessionFilters()`; a `useCallback` that awaits

```ts
const confirmed = await requestConfirm({
  title: `Remove "${project.name}"?`,
  body: 'Its sessions stop and the project is removed from Mainframe. Files on disk are not affected. This cannot be undone.',
  confirmLabel: 'Remove',
  destructive: true,
  testid: 'sessions-remove-project-dialog',
});
```

returns early on `false`, then keeps today's order: `await removeProject(port, project.id)` → `removeProjectFromList(project.id)` → clear the filter when it pointed at that project → `mfToast.success('Project removed', { description: project.name })`. The catch keeps the tagged `console.warn('[sessions] remove project failed', error)` and the `mfToast.error('Failed to remove project', { description })` with the daemon's message.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/__tests__/use-remove-project.test.tsx` passes (all five branches).

### Task D5 — wire the sidebar and drop the native dialog

**File:** `packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx`

Delete the `handleRemoveProject` `useCallback` (lines 183–203, the only `window.confirm` in the package) and replace it with `const handleRemoveProject = useRemoveProject(removeProjectFromList);` next to the existing `useAddProject` call. Remove the now-unused imports `mfToast` (line 27) and `removeProject` (line 52); add the `use-remove-project` import. The `ProjectFilterPillBar` prop stays `onRemoveProject={(project) => void handleRemoveProject(project)}`, so both affordances (hover trash + context menu) keep routing through the one handler.

**Verification:** `grep -rn "window\.\(confirm\|alert\|prompt\)" packages/ui/src packages/e2e/tests-tauri packages/e2e/fixtures packages/app-tauri/src-tauri/src` returns nothing (the brief's "no product-code hits" criterion). The paths are scoped to source on purpose: the shell's sources live in `packages/app-tauri/src-tauri/src`, not `packages/app-tauri/src`, and a whole-`packages/e2e` sweep matches prose in `packages/e2e/COVERAGE-GAPS.md:86` that no source fix can clear. Verified 2026-07-30: the only hit is the `SessionSidebar.tsx:185` call this task deletes. Also `wc -l packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx` is under 300; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/SessionSidebar.test.tsx` passes.

### Task D6 — mount the outlet

**File:** `packages/ui/src/app/AppShell.tsx`

Replace the `GitConfirmDialog` import (line 16) and its mount (line 194) with `ConfirmDialogHost` from `@/components/overlays/ConfirmDialogHost`, keeping it in the "Single app-wide outlets" block.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` and `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/__tests__/confirm-bridge.test.ts src/features/sessions/__tests__/use-remove-project.test.tsx`.

### Task D7 — changeset

**File (new):** `.changeset/remove-project-confirm-dialog.md` — `'@qlan-ro/mainframe-ui': patch`, one paragraph: the sidebar's Remove Project now opens the app's own confirmation dialog instead of a browser dialog the desktop webview never renders, and a failed removal on the daemon side now surfaces as an error toast with the row left in place instead of a false success.

**Verification:** the file exists and parses (`pnpm changeset status` runs without error).

---

## Group E — end-to-end spec (`e2e`, depends on Group D)

### Task E1 — drop the native-dialog handler from the removal scenario

**File:** `packages/e2e/tests-tauri/sessions-filters.spec.ts`

In `right-click Remove Project removes it after confirm, with a toast` (line 343): delete the `page.once('dialog', …)` block; after clicking `sessions-project-remove-<id>`, assert `page.getByTestId('sessions-remove-project-dialog')` is visible, then click `sessions-remove-project-dialog-confirm`. The pill-disappears and `Project removed` toast assertions are unchanged. Add the two new testids (`sessions-remove-project-dialog`, `-confirm`/`-cancel`) to the file-header testid reference block (lines 9–33).

**Verification:** `pnpm --filter @qlan-ro/mainframe-e2e exec playwright test tests-tauri/sessions-filters.spec.ts -g "Remove Project"` passes. Run at the QA stage against a built daemon; the spec edit itself is verified by `pnpm --filter @qlan-ro/mainframe-e2e exec tsc --noEmit` if a full run is not available.

---

## Task index

| # | Task | Group | Files |
|---|---|---|---|
| 1 | A1 — failing tests for the propagated row-delete failure | rust-test | `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` |
| 2 | B1 — fallible deps method + manager path | rust-impl | `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` |
| 3 | B2 — return the DB error from the server deps impl | rust-impl | `packages/core-rs/crates/mainframe-server/src/chat_deps.rs` |
| 4 | B3 — DELETE answers the failure envelope (+ inline tests) | rust-impl | `packages/core-rs/crates/mainframe-server/src/routes/projects.rs` |
| 5 | C1 — confirm-bridge tests | ui-test | `packages/ui/src/lib/__tests__/confirm-bridge.test.ts` |
| 6 | C2 — remove-project hook tests | ui-test | `packages/ui/src/features/sessions/__tests__/use-remove-project.test.tsx` |
| 7 | D1 — the shared confirm bridge | ui-impl | `packages/ui/src/lib/confirm-bridge.ts` |
| 8 | D2 — the single root outlet | ui-impl | `packages/ui/src/components/overlays/ConfirmDialogHost.tsx`, delete `packages/ui/src/features/git/GitConfirmDialog.tsx` |
| 9 | D3 — repoint git at the shared bridge | ui-impl | `packages/ui/src/features/git/git-confirm.ts` (new), delete `use-git-confirm.ts`, `use-branch-actions.ts`, `use-worktree-actions.ts`, `features/git/__tests__/use-branch-actions.test.ts`, `features/git/__tests__/BranchPopover.test.tsx` |
| 10 | D4 — the remove-project hook | ui-impl | `packages/ui/src/features/sessions/use-remove-project.ts` |
| 11 | D5 — wire the sidebar, drop the native dialog | ui-impl | `packages/ui/src/features/sessions/sidebar/SessionSidebar.tsx` |
| 12 | D6 — mount the outlet | ui-impl | `packages/ui/src/app/AppShell.tsx` |
| 13 | D7 — changeset | ui-impl | `.changeset/remove-project-confirm-dialog.md` |
| 14 | E1 — drop the native-dialog handler from the e2e scenario | e2e-spec | `packages/e2e/tests-tauri/sessions-filters.spec.ts` |

No two groups share a file. Wave order: `rust-test` and `ui-test` first (red phase), then `rust-impl` and `ui-impl`, then `e2e-spec`.

## Acceptance-criteria trace

| Brief criterion | Task(s) |
|---|---|
| Both affordances open the in-app dialog with a kebab-case testid | D4, D5, E1 |
| Confirm deletes, drops the row, clears a matching filter, success toast | C2 (1–2), D4 |
| Cancel issues no request, changes nothing | C2 (3), D4 |
| No `window.confirm`/`alert`/`prompt` anywhere in product code | D5 (grep gate) |
| Failed delete → non-2xx `fail` envelope, row stays, error toast with the daemon message | A1, B1, B2, B3, C2 (4), D4 |
| Daemon test of the failure path | A1, B3 |
| UI test of confirm and cancel without a native-dialog stub | C2 |
| Existing e2e removal scenario passes without a native dialog handler | E1 |
| Changeset | D7 |

## Risks

- **Stale session rows after removal.** The daemon deletes the project's chats; the assistant-ui thread list keeps its entries until a list reload. That is today's behavior and the e2e only asserts the pill disappears — untouched here, and not in the brief's criteria.
- **Rust red phase is a compile failure, not a test failure.** Group A's changes cannot compile until Group B lands (the trait signature moves). The wave order (A before B) is what makes this observable; both groups must land as separate commits so the red phase is visible in history.
- **The git bridge move touches a shipped surface.** Four call sites and two mock paths change. The `git-confirm-dialog` testid is preserved by the `git-confirm.ts` wrapper, so `packages/e2e/tests-tauri/git-branch.spec.ts` (5 references) needs no edit — the grep gates in D3 are what prove it.
