# Todo #365: a second "New session" trigger while the draft initializes

Short-form plan. Triage sized this at under 150 source lines, so the plan has one implementation group that does TDD inline. The approved brief is the spec: `python3 ~/.claude/skills/todo-lane/scripts/task_context.py 'rgoM5ZldH0UeeOonms6PK' 365`. #359 (PR #714, `962e505b`) is already on this branch's base, so its bounded wait in `openNewThreadDraft` is in place and must be kept.

## Goal

Any number of New session triggers in quick succession must end on a draft scoped to the project the first trigger resolved (pill, then active session's project, then none), with the composer visible. The choose-a-project welcome must never flash in between, and discarding the draft must return to the session the user started from. This must hold whether the slot started with a boot draft or empty after a committed chat. Holding ⌘N counts as one trigger. A genuinely projectless start (no pill, no active project) keeps today's behavior.

## Changes (all under `packages/ui/src/features`)

1. **Init record carries its target.** Files: `sessions/runtime/new-thread-ready-store.ts` and `sessions/new-thread/initialize-draft.ts`.
   - Add an optional `projectId` to `DraftInitialization`, and give `beginInitialization` an optional `projectId` parameter. `initializeDraft` passes `args.projectId`.
   - `completeInitialization` and `failInitialization` keep `projectId` when they rewrite the record, as they already keep `retry`.
   - `beginReadyReplacement` and every other caller stay as they are. The new parameter is optional.
2. **Stash clear is owned by its request.** File: `sessions/new-thread/pending-draft-project.ts`.
   - `setPendingProject` returns a token (a module counter). `clearPendingProject(token)` clears only when the stored token still matches.
   - Keep the `projectId` state field, because ChatSurface selects it and tests set it directly.
3. **Target resolution sees the in-flight draft, and a same-target repeat is a no-op.** File: `sessions/new-thread/use-start-new-session.ts`.
   - In-flight target: when the active thread is the slot (`mainThreadId != null && mainThreadId === newThreadId`), use the pending stash, or else `getInitialization(newThreadId).projectId`.
   - Resolution becomes `resolveNewSessionProject(pill, activeProjectId ?? inFlightTarget)`. Precedence is unchanged.
   - No-op: if the resolved target equals the in-flight target (the pending stash, or an init record with status `'initializing'` for that project), return without resetting, recording a return target or switching. A different target runs the full sequence, so the latest trigger wins. It sets its own stash token, and the earlier `finally` can no longer clear that stash.
   - The no-target path skips `setReturnTarget` when the active thread is already the slot.
   - If the file grows, extract the in-flight lookup into a small pure helper next to it.
4. **Return target is kept when triggered from the draft.** File: `sessions/new-thread/open-new-thread-draft.ts`.
   - Call `setReturnTarget` only when the pre-switch state's `mainThreadId` is not the non-null `newThreadId`.
   - Leave `waitForSwitchedDraft` and its timeout toast untouched.
5. **⌘N auto-repeat.** Files: `shortcuts/shortcut-types.ts`, `shortcuts/registry.ts` and `shortcuts/use-shortcut-dispatcher.ts`.
   - Add an optional `ShortcutDescriptor` flag (for example `ignoreRepeat`) and set it only on `sessions.new`.
   - When an eligible, handled entry has this flag and `event.repeat` is true, the dispatcher calls `preventDefault` and returns without running the action. `preventDefault` stops a held ⌘N from reaching the browser default in browser mode.
   - Every other shortcut repeats as it does today.
6. **Changeset.** Add `.changeset/<name>.md` with a `'@qlan-ro/mainframe-ui': patch` user-facing line, in the same style as `.changeset/new-session-prefill-empty-slot.md`.

## Tests (red before green, same group)

- Stalled-fetch double trigger: a new `sessions/new-thread/__tests__/use-start-new-session.race.test.tsx`. Its mocks differ from the wiring-only `use-start-new-session.test.tsx`, so it lives in its own file.
  - Use the real `useStartNewSession`, `openNewThreadDraft`, `initializeDraft`, `resetNewThreadDraft` and stores. Mock `getProviderSettings` (`@/lib/api/settings`) with a deferred promise. Use a stateful `aui.threads` double that supports both starting states:
    - boot draft: the slot is already populated;
    - empty slot: `newThreadId` is null until a macrotask after `switchToNewThread` (#359's model).
  - Derive `useActiveIdentity().projectId` from the double: the source chat's project while `chat-7` is active, and `getDraftConfig(draft)?.projectId` while the draft is active. This reproduces the "draft reports no project mid-init" condition. Re-render between triggers.
  - Cover each of these, from both starting states:
    - Two triggers before the fetch resolves end with the draft's config and readiness scoped to the originating project.
    - With a sole pill, the draft ends scoped to the pill's project.
    - With no pill and no active project, it ends unscoped with no initialization, as today.
    - The return target is still `chat-7` after both triggers.
    - At every checkpoint between the first trigger and ready, the draft satisfies ChatSurface's `isInitializing` gate: init status `'initializing'`, or a pending project with no draft config. It never reaches the state that renders the welcome picker.
  - These must fail on the current base.
- Stash ownership: in `use-start-new-session.test.tsx` or the stash's own test, an earlier request that settles after a later `setPendingProject` leaves the later value in place. Existing lifetime tests adapt to the token API.
- Return target: `open-new-thread-draft.test.ts` gets a case where the pre-switch `mainThreadId === newThreadId` leaves `setReturnTarget` uncalled. The existing return-target cases keep passing.
- Init record: `new-thread-ready-store.test.ts` checks that `projectId` survives complete and fail.
- Repeat: `use-shortcut-dispatcher.test.tsx` checks that ⌘N with `repeat: true` does not call the `sessions.new` spy but is still default-prevented, while a non-repeat press still fires it. A repeating chord of another entry still fires.

## Risks

- **Latest-wins window.** If a different-target trigger lands while the first sequence is still inside `waitForSwitchedDraft`'s 16 ms poll, the first `initializeDraft` can start later and win. This needs a pill change inside one poll tick, so it is accepted and not guarded. Tell the reviewer.
- **The no-op covers in-flight drafts only.** A trigger on an already-ready draft still re-runs the sequence, as it does today. The draft keeps its project because the ready config resolves it and the return target is kept, and existing single-trigger tests stay unchanged. The brief lets a restart stand if every criterion holds.
- **Callers of the stash API.** `clearPendingProject` gains a required token. Its only production caller is `use-start-new-session.ts`, per grep.
- **Out of scope:** #359's wait and toast, the prefill actions, target precedence, daemon changes, and repeat behavior for other shortcuts.

## Established facts

- A second trigger's reset drops the in-flight record: `resetNewThreadDraft` → `useNewThreadReady.clearReady` deletes the `initializations` entry. The first `initializeDraft` then returns at its `initialization.attempt !== attempt` check without `setDraftConfig`. Receipts: `sessions/new-thread/reset-new-thread-draft.ts` `resetNewThreadDraft`; `sessions/runtime/new-thread-ready-store.ts` `clearReady`; `sessions/new-thread/initialize-draft.ts` `initializeDraft`.
- `initializeDraft` awaits `getProviderSettings` before `setDraftConfig`, so while the fetch is in flight the draft has no config and `useActiveIdentity().projectId` is undefined, because it reads the draft through `useActiveDraftConfig`. Receipts: `initialize-draft.ts` `initializeDraft`; `sessions/use-active-identity.ts` `useActiveIdentity`.
- The earlier trigger's `finally` clears the stash unconditionally. Receipts: `use-start-new-session.ts` `useStartNewSession`; `pending-draft-project.ts` `clearPendingProject`.
- `openNewThreadDraft` records `mainThreadId` as the return target on every call, even when that is the draft itself. Receipt: `open-new-thread-draft.ts` `openNewThreadDraft`.
- The active thread is the slot exactly when `newThreadId != null && newThreadId === mainThreadId`, the same settled condition #359 polls for. Receipt: `open-new-thread-draft.ts` `waitForSwitchedDraft`.
- ChatSurface shows "Initializing session…" rather than the welcome picker when the init status is `'initializing'`, or when it is idle with a pill or pending project, no draft config and not ready. Receipt: `sessions/new-thread/ChatSurface.tsx`, `isInitializing`.
- The dispatcher has no `event.repeat` check, and `ShortcutDescriptor` has no per-entry repeat flag. Receipts: `shortcuts/use-shortcut-dispatcher.ts` `onKeyDown`; `shortcuts/shortcut-types.ts` `ShortcutDescriptor`.

## Exit gates

- The new race tests fail before the fix and pass after it. All existing tests under `features/sessions` and `features/shortcuts` pass unchanged, apart from the stash-token adaptation. This includes #359's empty-slot single-trigger test.
- The UI package's typecheck and lint pass.
- The changeset is committed with the change.
