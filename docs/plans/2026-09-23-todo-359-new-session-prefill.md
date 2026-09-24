# Todo #359 — "New session" prefill and "Run in a new session" on an empty new-thread slot

Short-form plan. The expected source diff is well under 150 lines, so this plan has one implementation group with TDD inline. The approved brief is the spec: `python3 ~/.claude/skills/todo-lane/scripts/task_context.py 'rgoM5ZldH0UeeOonms6PK' 359`.

## Goal

"New session" on selected text, the "Run in a new session" chip and the sidebar "+" must open a draft in the source chat's project with the text prefilled. This has to hold when the new-thread slot is empty, which it is right after a draft's first send commits it. The chip must keep the source chat's project and adapter when a filter pill is active. In split view, the toolbar that responds must belong to the zone that holds the selection. Nothing auto-sends.

## Changes (all under `packages/ui/src`)

1. **Wait for the switched draft** — `features/sessions/new-thread/open-new-thread-draft.ts`.
   - Once `switchToNewThread()` resolves, poll `runtimeThreads.getState()` in a small helper in this file until `newThreadId != null && mainThreadId === newThreadId`. Check immediately first, so a slot that already holds a draft still resolves on the first read. Then re-check every short interval (~16 ms), with a bound of about 1 s. Do not subscribe to assistant-ui internals.
   - On timeout, call `mfToastError` (for example "Couldn't open a new session") and return. Never return silently.
   - Add an optional `adapterId` to `OpenNewThreadDraftArgs` and pass it through `initializeDraft`. `OpenNewThreadDraftDeps.initializeDraft` gains `adapterId?`.
   - Keep `openNewThreadDraft` under 50 lines. Put the wait in its own function.
2. **Hook binding** — `features/sessions/new-thread/use-open-new-thread-draft.ts`.
   - Forward `adapterId` to `initializeDraft`.
   - `setText` targets `aui.threads.thread('main').composer().setText(text)`, the same live-composer path the chip already uses. It must not use the zone- or message-scoped `aui.composer`.
3. **Chip uses the shared sequence** — `features/chat/smart-actions/use-instruction-actions.ts`.
   - `runInNewSession` calls `useOpenNewThreadDraft()` with `{ projectId, adapterId, prefill: insertText }`. It keeps the "no source project → warn and no-op" guard.
   - Delete the duplicated reset/switch/read/init/setText sequence and the imports it no longer needs. Pill clearing, the return target and the bounded wait come from the shared sequence.
4. **Auto-config must not override an explicit initialization** — `features/sessions/new-thread/use-new-thread-auto-config.ts`.
   - The effect also bails when `useNewThreadReady.getState().getInitialization(localId).status === 'initializing'`.
   - Without this guard, a matching pill makes auto-config start a later attempt with the default adapter. The later attempt wins in `initializeDraft`, so the chip's `adapterId` is lost (acceptance criterion 5).
   - If the explicit sequence starts second, it already wins as the later attempt. With the guard, the explicit sequence wins whichever runs first.
5. **One toolbar per selection (split view)** — `features/chat/thread/ChatSelectionToolbar.tsx`, a new hook next to it (for example `use-selection-in-scope.ts`), and `features/chat/thread/ChatThread.tsx`.
   - `ChatThread` passes a ref to its own `ThreadPrimitive.Root` element into `ChatSelectionToolbar`.
   - The hook listens on the document for the same events the primitive uses (`mouseup`/`keyup` via rAF, plus `selectionchange` on collapse). It reports whether the selection's anchor lies inside that element.
   - A toolbar that doesn't own the selection keeps `SelectionToolbar.Root` mounted, so the primitive still captures the selection, but hides it with `style={{ display: 'none' }}`. The toolbar that does own it reads `useChatExtras()` for its own zone, so its project is correct.
   - Quote and New session read the selection only from the owning toolbar.

## Tests (red before green, same group)

- `features/sessions/new-thread/__tests__/open-new-thread-draft.test.ts`
  - Regression: a threads double whose `getState()` returns `newThreadId: null` right after the switch, then `{ newThreadId: '__LOCALID_x', mainThreadId: '__LOCALID_x' }` a tick later. `initializeDraft` must receive that id, and `setText` must receive the prefill.
  - Bounded wait: the id never appears (fake timers). An error toast is shown, and neither `initializeDraft` nor `setText` runs.
  - `adapterId` is forwarded.
  - Update existing doubles that return a non-null `newThreadId` with `mainThreadId: null` so they model the settled state (`mainThreadId === newThreadId`). Otherwise those tests wait out the bound.
- `features/chat/smart-actions/__tests__/instruction-actions.test.ts`: rewrite the `runInNewSession` block to mock `useOpenNewThreadDraft`. Assert it is called with the source `projectId`, `adapterId` and the instruction as `prefill`. Also assert the no-project no-op and that nothing sends. The sequence-order tests now live in the shared-sequence tests. Keep the `append` tests.
- `features/sessions/new-thread/__tests__/use-new-thread-auto-config.test.tsx`: an in-flight initialization for the active local id means auto-config starts none.
- `features/chat/thread/__tests__/ChatSelectionToolbar.test.tsx`, or the new hook's own test: a selection outside the scope element hides the toolbar, and a selection inside shows it. Existing click-behaviour tests keep passing.
- E2E, new spec `packages/e2e/tests-tauri/new-session-prefill.spec.ts` (mock adapter, `messaging` recording):
  - Open a draft through the UI and send the first message. Do not use `createTauriChat`, because that creates the chat over REST and never takes the draft-commit path.
  - Select text in the reply's `.aui-md` and click `chat-selection-new-session`.
  - Assert that the composer holds the selection and that `chat-header-project` names the source project.
  - Also covering the "+" (`sessions-new-button`) path from the same freshly committed chat is cheap and recommended.
  - Any new control needs a `data-testid` keyed by domain id. None is expected.

## Risks

- **Two toolbars in split view.** A hidden-but-mounted toolbar must not intercept clicks. `display: none` guarantees that. Keep the primitive mounted, because unmounting it would miss the `mouseup` that populates its info.
- **The new ownership check has a timing edge.** It reads the selection on the same rAF tick as the primitive. If they disagree for one frame, the toolbar can flash hidden. That is acceptable, but verify it by hand in split view.
- **The auto-config guard is intentionally narrow.** It covers `'initializing'` only. An `'error'` status must still let auto-config retry when its dependencies change.
- **#365 edits the same sequence.** Land this fix first. The out-of-scope items (a second trigger while a draft initializes, the pending-project clear, the return target pointing at the draft itself, ⌘N repeat) stay untouched.
- **File limits.** `ChatThread.tsx` is at about 260 lines. Keep its addition to a ref and a prop.

## Established facts

- After a first send commits the draft, `aui.threads.getState()` still reports `newThreadId: null` and the old `mainThreadId` when `switchToNewThread()` resolves. The new id appears one macrotask later. Receipt: the brief's reproduction (`task_context.py … 359`, "Current behavior").
- `openNewThreadDraft` reads `newThreadId` once after the switch and returns silently on `null`. Receipt: `open-new-thread-draft.ts` `openNewThreadDraft`.
- The chip duplicates the sequence and throws "No draft session was created" on `null`. It never clears a pill that doesn't match. Receipt: `use-instruction-actions.ts` `runInNewSession`.
- `initializeDraft` lets the later attempt win. An earlier attempt that was replaced returns without writing config. Receipt: `initialize-draft.ts` `initializeDraft` (the `initialization.attempt !== attempt` check). `beginInitialization` sets status `'initializing'`, and `cancelInitialization` only drops its own attempt. Receipt: `runtime/new-thread-ready-store.ts` `useNewThreadReady`.
- `useNewThreadAutoConfig` starts `initializeDraft` with the sole pill's project and the default adapter for any fresh, unconfigured, not-ready `__LOCALID_*` item. It has no in-flight check. Receipt: `use-new-thread-auto-config.ts` `useNewThreadAutoConfig`.
- Inside a message, `aui.composer` is rebound to that message's edit composer. `aui.threads.thread('main').composer()` reaches the live composer. Receipt: the comment in `use-instruction-actions.ts` `useInstructionActions`.
- `SelectionToolbarPrimitive.Root` (v0.15.13) listens on `document` for `mouseup`/`keyup` (via rAF), `selectionchange` and `scroll`. It shows for any selection inside any message, portals to `document.body` at a fixed position, and spreads the caller's `style` after its positioning. Receipt: `packages/ui/node_modules/@assistant-ui/react/dist/primitives/selectionToolbar/SelectionToolbarRoot.js` `SelectionToolbarPrimitiveRoot`.
- Each split zone renders a full `ChatThread`, which mounts its own `ChatSelectionToolbar`. The reconciler closes the split once a draft is active. Receipt: `features/chat/zones/ChatZone.tsx` (docstring and the `onNew` comment), `features/chat/thread/ChatThread.tsx` (`<ChatSelectionToolbar />` inside `ThreadPrimitive.Root`).
- `createTauriChat` creates chats over `POST /api/chats`, not through the draft's first send. Receipt: `packages/e2e/helpers/tauri/setup.ts` `createTauriChat`.
- The `messaging` mock recording replays positionally: the first prompt gets the "2 + 2" turn. A selection must sit inside `.aui-md`, because `body` is `user-select: none`. Receipt: the comments in `packages/e2e/tests-tauri/composer-advanced.spec.ts` `§composer quote + worktree mid-session warning`.
- `docs/plans/` is gitignored, so commit this plan with `git add -f`. Receipt: `.gitignore` (`docs/plans/`).

## Exit gates (for the implementation group)

- The new regression and bounded-wait unit tests fail before the fix and pass after it. The UI package's unit tests, typecheck and lint pass.
- The new e2e spec passes in the mock-adapter Tauri suite.
- `use-instruction-actions.ts` no longer calls `switchToNewThread`, `resetNewThreadDraft` or `initializeDraft` directly. Both prefill actions go through `useOpenNewThreadDraft`.
- The 300-line file and 50-line function limits hold.
- A `@qlan-ro/mainframe-ui` patch changeset describes the fix.
