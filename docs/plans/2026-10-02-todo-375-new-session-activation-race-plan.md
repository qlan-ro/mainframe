# New-session activation race (todo #375)

Approved todo #375, size M, no-spec route. Short-form plan: the expected production diff is well under 150 lines, so this is one implementation group with TDD inline.

## Goal

Opening a new session must not report "Couldn’t open a new session / The new session never became active" when the only thing that went wrong is an automatic list-router selection racing the pending New. The confirmed race: the active thread is a committed local draft (`__LOCALID_*` with a stamped `remoteId`), the user triggers New, and while `switchToNewThread()` waits for runtime attachment a list reload lets `useSessionListRouter` adopt the canonical saved session via `switchToThread(remoteId)`. That newer switch silently cancels New, and `openNewThreadDraft` times out into the toast. Fix: automatic router selections yield to a user-initiated New that is still switching. Project resolution, explicit non-project sessions, repeat-trigger guards and the bounded failure toast stay as they are. No timeout change.

The investigation could not prove that this race caused the user's installed-app failure (see todo #375 investigation notes). The fix targets the one reproduced production interleaving. Live QA in the parent lane checks that the opening path stays correct. It does not claim to reproduce the original failure.

## Files

- New `packages/ui/src/features/sessions/new-thread/new-thread-switch-pending.ts`: a small zustand store with a counter (overlapping New triggers each hold their own claim). It exposes `beginNewThreadSwitch(): () => void` (idempotent release), a selector hook for "any New switch pending", and a non-hook `isNewThreadSwitchPending()`.
- `packages/ui/src/features/sessions/new-thread/open-new-thread-draft.ts`, `openNewThreadDraft`: claim before `switchToNewThread()`, and release in a `finally` once `waitForSwitchedDraft` settles (activated or bounded failure), before `initializeDraft`. Inject the claim through `OpenNewThreadDraftDeps` or import it directly; the implementer chooses, keeping the existing unit tests' fake deps simple.
- `packages/ui/src/features/sessions/new-thread/use-start-new-session.ts`, unresolved-target direct path: claim around `aui.threads.switchToNewThread()` and release when it settles. This path has no activation wait, but the router still must not yank it.
- `packages/ui/src/features/sessions/ws/use-session-list-router.ts`, `useSessionListRouter`: subscribe to the pending flag and add it to the active-thread effect deps so a deferred action re-evaluates on release. While pending:
  - first-send adoption: still call `useLayoutStore.getState().adoptSession(mainThreadId, draftRemoteId)` (layout re-key only), but skip `threads.switchToThread(draftRemoteId)`;
  - `reconcileDraftHandoff` redirect and the archived-active fallback: skip the switch;
  - boot auto-select: consume the one-shot and skip, the same way `isCreateInFlight` does today (the user has chosen New).
  The file is at 278 lines. If the gating pushes it past about 300, move the guard into a small helper next to `reconcile-draft-handoff.ts` instead of growing the hook.
- Tests (red first, inside the group):
  - New `packages/ui/src/features/sessions/runtime/__tests__/new-thread-activation-overlap.test.tsx`: a real-runtime regression adapted from the investigation's diagnostic harness (real assistant-ui runtime, `useSessionsThreadList`, `useSessionListRouter`, `useStartNewSession`, `openNewThreadDraft`; network and `initializeDraft` mocked; runtime attachment held via a spy on the core hook manager's `startThreadRuntime`). Cases: a committed-local refresh before, during and after a pending New. "During" must fail on the baseline with the exact toast and pass after the fix: New activates, there is no toast, `initializeDraft` is called for the new draft, and the saved session is still in the list. Before/after stay green. Add a slow-attachment case (attachment held past one second) that still activates without a toast, which shows that the fix is not a timeout effect. Keep the file under about 300 lines.
  - `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`: mock the new module and add focused cases. While pending, adoption re-keys the layout but does not switch. After release it no longer adopts the now-inactive draft. Boot auto-select is consumed without switching. The archived fallback is skipped while pending.
  - `packages/ui/src/features/sessions/new-thread/__tests__/open-new-thread-draft.test.ts`: the claim is held across switch-and-wait and released on success, on bounded failure (the existing never-settles case still toasts) and before `initializeDraft` runs.
- `.changeset/<name>.md`: patch entry for `@qlan-ro/mainframe-ui` saying that New no longer fails when a just-sent session finishes saving at the same moment.

## Risks

- Deferring adoption leaves the old committed local item unselected. That is intended, because the user left it, and the sidebar shows its canonical row. Verify the active-thread effect does not re-adopt once New is active (the main thread is then the new draft without a `remoteId`).
- A genuine New failure must release the claim. Otherwise router fallbacks stay disabled. Use `finally`, and give overlapping triggers independent claims.
- Explicit user re-selection of the old session during a pending New (the investigation's "reselect-old" control) still cancels New and shows the toast. No production caller was identified, and most selection callers already skip the active id. This is out of scope and recorded for review.
- Do not mark aui's own involuntary `switchToNewThread` (archive bump). Only the two user New paths claim.

## Established facts

- assistant-ui core 0.3.12 `RemoteThreadListThreadListRuntimeCore._startSwitchToThread` / `_startSwitchToNewThread` (`dist/react/runtimes/RemoteThreadListThreadListRuntimeCore.js`) increment `_switchGeneration` before any work. `_switchToThread` returns early when `_mainThreadId === data.id`, after that increment. Both abandon a superseded switch with a plain `return`, without rejecting. A newer `switchToThread` therefore cancels a pending New, and the New promise still resolves.
- `_switchToThread` awaits `_hookManager.startThreadRuntime(id)` when a main thread exists. This is the attachment window the regression holds (investigation harness `holdSwitches`).
- `openNewThreadDraft` (`open-new-thread-draft.ts`) emits the reported toast only from `waitForSwitchedDraft` returning null after `SWITCHED_DRAFT_POLL_BOUND_MS` (1000 ms, 16 ms poll), before `initializeDraft`.
- `useSessionListRouter` (`use-session-list-router.ts`) first-send adoption branch calls `threads.switchToThread(draftRemoteId)` when the active `__LOCALID_*` item has a `remoteId` present in the list. The investigation reproduced the exact toast only when this fires during pending New (`/tmp/mainframe-investigate-375/race-test-output.log`, "committed local-session refresh during New"). Before/after orderings, a slow New attachment (1.5 s), an earlier tab switch and a metadata reload all activated.
- `useLayoutStore.adoptSession` (`store/layout.ts`) only re-keys the persisted session layout and moves `activeSessionId` if it equals `fromId`. It does not switch threads.
- The only source callers of `switchToNewThread` are `openNewThreadDraft` and `useStartNewSession`'s unresolved-target path (grep of `packages/ui/src`, excluding tests).

## Exit gates

- The new overlap regression fails on the baseline for the "during" case and passes after the fix. Existing activation, create-once, start-new-session (unit and race), open-new-thread-draft and router suites pass. Scoped UI typecheck, ESLint and Prettier are clean.
- The changeset is present. Only owned files are staged.
- The parent lane runs live QA in the app. It covers New from no project filter (inherits the active project, or the welcome picker when unresolved), an explicit non-project session, a rapid double New, and New immediately after a first send while the session saves. Parent review clears.
