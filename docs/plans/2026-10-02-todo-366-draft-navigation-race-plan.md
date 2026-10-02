# Todo #366: preserve chats during first-send handoff

Fix the welcome-project-picker first-send race described in the approved Agent Brief. Base: `f60b797c0130dde91c15b673089e219120c137c3`. Keep the existing create-once coordinator, project defaults, sidebar layout, and assistant-ui version.

## Established facts

Paths below are relative to `packages/ui/src/features/sessions/` unless stated otherwise.

- `sidebar/use-draft-row.ts` → `useDraftRow` records selection in an unkeyed boolean ref. Its navigation effect calls `resetNewThreadDraft` when identities differ while configuration remains visible. The existing `sidebar/__tests__/use-draft-row.test.ts` commit case clears configuration without changing identity.
- `runtime/new-thread-coordinator.ts` → `createForLocal` owns one workflow per local ID, awaits creation/worktree/tuning, then clears configuration and readiness before deleting the workflow. Failure after chat creation retains that workflow with `promise = undefined` for retry. `isCreateInFlight` checks map membership, including those failed workflows.
- `new-thread/reset-new-thread-draft.ts` → `resetNewThreadDraft` calls `abandonCreateForLocal`. The coordinator's `archiveAbandonedWorkflow` archives ordinary chats, discards temporary chats, and prevents duplicate cleanup.
- `new-thread/WelcomeProjectPicker.tsx` → `WelcomeProjectPicker` invokes selection through the dropdown item's `onSelect`; `new-thread/use-select-draft-project.ts` → `useSelectDraftProject` resets and initializes the active slot. `packages/e2e/tests-tauri/new-session-prefill.spec.ts` explicitly uses inherited-project setup to avoid this path.
- Installed `@assistant-ui/core@0.3.12/dist/react/runtimes/RemoteThreadListThreadListRuntimeCore.js` → `initialize` applies an optimistic status update around `adapter.initialize`, then publishes remote identity. App draft configuration and native thread state have separate owners; no atomic cross-store ordering is established.

## Group G1: creation ownership and navigation cleanup

Owner: one UI implementer, including regression tests. `kind: ui`, `parallel_safe: false`, `depends_on: []`. Tests and implementation stay together because they exercise the same ordering boundary.

Owned files: `sidebar/use-draft-row.ts`, `runtime/new-thread-coordinator.ts`, `sidebar/__tests__/use-draft-row.test.ts`; add focused sibling `sidebar/__tests__/use-draft-row-creation.test.ts` and `runtime/__tests__/new-thread-creation-lifecycle.test.ts` if needed to respect file limits. Update `packages/e2e/tests-tauri/new-session-prefill.spec.ts` and add a UI patch changeset. Existing coordinator/create-once/reset/router suites are verification dependencies. Keep helpers within the same sessions directories if decomposition is necessary.

- [ ] Before changing production behavior, model a selected configured local draft, start real `createForLocal` with deferred network responses, and change main-thread identity while configuration remains observable. Hold both the create request and a post-create tuning request in separate cases. Assert no reset/archive/discard and eventual successful creation. Record the actual failure on the base revision. Use real coordinator/reset logic with API spies; a mocked lifecycle boolean alone cannot prove the failure. Exercise slot replacement and configuration-first ordering too.
- [ ] Make automatic abandonment consult coordinator-owned creation lifecycle for the tracked draft ID. Distinguish an actively pending attempt from a retained failed workflow; preserve existing `isCreateInFlight` semantics for boot routing. Expose a narrow reactive snapshot derived from the existing workflow, publishing start/settle/abandon changes, so failure reevaluates cleanup without requiring another identity change. Recheck current configuration before destructive reset to reject stale effect snapshots. Key selection history by local ID and retire it on commit/reset; a new slot must not inherit the previous slot's selection. Do not use a timeout or message count.
- [ ] Preserve explicit discard/reset authority. Verify unsent navigation, pending initial selection, failure while still selected followed by retry, failure after navigating away, explicit discard during creation, and recycled IDs. Assert ordinary abandonment archives once, temporary abandonment discards once, and an abandoned attempt cannot clear a replacement draft. A successful handoff must clear draft/return-target state without cleanup of its chat.
- [ ] Exercise both first-send callers with the existing real-runtime create-once coverage. Restore welcome-dropdown setup in the prefill E2E, remove its workaround explanation, and assert one created chat, delivery of the first prompt to it, and continued unarchived existence after the response settles.

## Verification and remaining uncertainty

Run affected UI test files individually, including coordinator, create-once, reset, and boot-router regressions; run UI typecheck and lint on changed TypeScript. Keep touched files/functions within repository limits through focused extraction, without broad cleanup. Inspect the staged diff for secrets and include the patch changeset before the implementation commit.

Use the project QA launcher for an isolated running app built from the implementation commit. From an actual unconfigured welcome screen, choose a project in the dropdown and send as soon as the composer is ready. Check the transcript plus daemon chat identity/archive state; repeat for a temporary chat and exercise deliberate unsent navigation/discard. Record tested commit, scenario evidence, and teardown. Do not substitute sidebar New or inherited-project setup.

The historical 36 ms incident has not been reproduced in this planning step. Reproduction must establish the relevant interleaving on this newer baseline before the fix; elapsed time is not an acceptance threshold. If traces implicate a different reset caller, revise the bounded ownership and diagnosis before changing it. Validation above is intent, not a report of completed tests.
