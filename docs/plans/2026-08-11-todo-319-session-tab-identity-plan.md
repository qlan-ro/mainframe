# Session tabs: one tab per session across the local→remote handoff (todo #319)

## Goal

Starting a session leaves a second, dead tab behind. Pressing "+" makes a client-minted
`__LOCALID_*` thread active, and the membership seam in `useSessionTabsSync` opens a tab for it. On
first send the daemon chat is created, the `chat.created` reload adds a SECOND thread-list entry
keyed by the new remote id, and the session-list router hands the active thread over to it — so the
seam opens a second tab while nothing removes the first. The strip ends up with two pills for one
session: the real one, and a placeholder-titled ghost that bounces straight back when clicked. This
change teaches the tab strip that a session's pre-send and post-create identities are ONE member:
`tabs-model.ts` gains a pure `canonicalTabId` + `reconcileTabIds` pass that collapses the local id
onto its remote-keyed entry **in the slot the draft tab already held**, the store's prune operation
becomes a resolver-based `reconcile`, and `SessionTabs` compares against the canonical active id so
no pill can be dead. Persistence, the payload shape, the no-id-flip contract, the router's first-send
handoff, and the sidebar are untouched.

## Verified facts this plan rests on

Read before planning; cite these instead of re-deriving them. assistant-ui pin: `react@0.15.13` /
`core@0.3.12` (exact, per `packages/ui/CLAUDE.md`).

- **Two entries for one session is real, and permanent for the run.**
  `core/dist/runtimes/remote-thread-list/remote-thread-state.js`: `createThreadMappingId(id)` is the
  identity function, and `classifyThreads` keys `threadData` by the *remote* id. `adapter.initialize`
  (first send) writes `threadIdMap[remoteId] = <localMappingId>` onto the SAME local entry
  (`RemoteThreadListThreadListRuntimeCore.js`, `initialize`), then the next `list()` merges
  `threadIdMap: {...state.threadIdMap, ...fresh.threadIdMap}` and
  `threadData: {...state.threadData, ...fresh.threadData}` (`getLoadThreadsPromise`). The fresh
  remote-keyed mapping wins, a new `threadData['chat-x']` appears, and the local entry survives in
  `threadData` untouched. Nothing but a delete removes it.
- **`threads.threadItems` exposes BOTH.** `store/runtime-clients/thread-list-runtime-client.js` builds
  the array from `Object.keys(runtimeState.threadItems)` — i.e. every `threadData` entry, not the
  `threadIds` bucket. Insertion order puts the local entry first, so the ghost sorts ahead of its own
  session.
- **The orphan is shaped exactly as the brief says.** After the handoff the local entry is
  `{ id: '__LOCALID_x', status: 'regular', remoteId: 'chat-x', title: undefined, custom: undefined }`
  (`updateStatusReducer` flipped `new` → `regular`; `custom` only ever arrives under the remote-keyed
  entry). The canonical entry carries `title`, `custom`, and `id === remoteId`.
- **`switchToThread` accepts either id.** `_switchToThread` resolves through `getThreadData`, which
  reads `threadIdMap`; both the local id and the remote id are keys. Canonicalising a tab to the
  remote id therefore never breaks activation.
- **The bounce-back is the router doing its job.** `use-session-list-router.ts:156-166`: an active
  thread with no session metadata is treated as a stranded draft, and the remote item is adopted —
  guarded by `items.some((t) => t.id === draftRemoteId)`, i.e. exactly the condition under which the
  orphan exists. The fix is to stop exposing the orphan, not to touch this branch (brief: out of
  scope).
- **Nothing outside `features/session-tabs/` imports `useSessionTabsStore` or `validTabIds`**
  (grepped across `packages/ui/src`). The open-set API and the prune rule can change shape freely.
- **`s.threads.mainThreadId` is typed `string`** in `core/dist/store/scopes/threads.d.ts` (the hook's
  existing `if (mainThreadId)` guard is a runtime belt, not a type requirement), and it is assignable
  to the model's `activeId: string | null` parameters as they stand.
- **#312 (`docs/plans/2026-08-11-session-tabs-reload-hydration-plan.md`) has already landed in this
  branch's base** — `canRestoreTabs`, `list-load-state.ts` and `use-session-tabs-sync.test.tsx` are
  present. The "whichever lands second rebases" obligation is discharged; this plan builds on that
  code and keeps its tests green.

## Files touched

| File | Change |
|---|---|
| `packages/ui/src/features/session-tabs/tabs-model.ts` | add `canonicalTabId` + `reconcileTabIds`; make `validTabIds` module-private |
| `packages/ui/src/features/session-tabs/store.ts` | replace `pruneTo(valid)` with `reconcile(resolve)`; update the docblock |
| `packages/ui/src/features/session-tabs/use-session-tabs-sync.ts` | prune effect → reconcile effect (ungated); docblock |
| `packages/ui/src/features/session-tabs/SessionTabs.tsx` | compare/act on the canonical active id |
| `packages/ui/src/features/session-tabs/__tests__/tabs-model.test.ts` | `canonicalTabId` + `reconcileTabIds` describes; fold the `validTabIds` cases in |
| `packages/ui/src/features/session-tabs/__tests__/store.test.ts` | `pruneTo` describe → `reconcile` describe |
| `packages/ui/src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx` | add a handoff describe (ghost collapse, order, N sessions, persistence) |
| `.changeset/<generated>.md` | patch bump for `@qlan-ro/mainframe-ui` |

Constraints from `CLAUDE.md` / `packages/ui/CLAUDE.md`: max 300 lines per file (`tabs-model.ts` goes
102 → ~140, every other file stays well under), max 50 lines per function, no `@ts-ignore`, comments
state *why*, `data-testid` keyed by domain id (unchanged — pills stay keyed by tab id), pure logic
lives in the model rather than in React, changeset required, and single-file vitest runs only
(`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`) — never the full suite.

## Design

One rule, expressed once:

```ts
canonicalTabId(id, items)   // '__LOCALID_x' → 'chat-x' ONLY when a 'chat-x' entry also exists
reconcileTabIds(tabIds, items, activeId)
  // map every open id through canonicalTabId, keep the FIRST occurrence (in-place swap),
  // then drop what the (now private) validTabIds rule rejects
```

`reconcileTabIds` subsumes the old prune: the sync hook's third effect calls
`reconcile((ids) => reconcileTabIds(ids, items, mainThreadId))` and the store applies that resolver
to its CURRENT `tabIds` inside `set`.

Why first-wins dedupe is the whole fix: at the handoff the seam has appended the canonical id at the
end, so the set reads `['chat-a', '__LOCALID_x', 'chat-x']`. Mapping gives
`['chat-a', 'chat-x', 'chat-x']`; keeping the first occurrence yields `['chat-a', 'chat-x']` — the
session stays in the draft tab's slot. "Remove the orphan and keep the appended tab" would move it to
the end, which the user reads as a second bug (PM decision in the brief).

## Decisions taken while planning

1. **Canonicalise only when the remote-keyed entry exists.** `remoteId != null` alone is not an
   orphan: between the first send and the `chat.created` reload (and forever, after a failed list
   load) the local entry is the session's ONLY entry, and rewriting the tab to an id with no entry
   would give the pill no title, no project colour, and — via `toTabEntry` — the literal label "New
   Session". The existing #312 case that ends on `['chat-a', 'chat-b', '__LOCALID_1']` pins exactly
   that state and must stay green.
2. **The store operation takes a resolver, not a precomputed array.** `reconcileTabIds` needs `items`
   and the active id, which only React has — but an array computed in the effect body is computed
   from the render's `tabIds`, which is stale whenever `hydrate()` ran earlier in the same effect
   flush (zustand `setState` is synchronous, React re-renders only after the flush). Writing that
   stale array back would silently wipe a just-restored tab set. Passing
   `(ids) => reconcileTabIds(ids, items, mainThreadId)` and applying it inside `set` reads the live
   state, so no ordering assumption is needed. Do not "simplify" this to `reconcileTo(array)`.
3. **The reconcile effect is NOT gated on `hydrated` (the prune effect was).** With the resolver, the
   only reason for the gate is gone; pre-hydration the set holds nothing but ids the membership seam
   added for an active thread, all valid by construction, so an early pass is a no-op. Keeping the
   gate would cost a visible double-pill frame on a session-less install (where hydration first
   latches in the same commit that lands the canonical entry) and would leave the ghost forever after
   a failed list load. All five existing sync tests stay green (checked case by case).
4. **The membership seam (`ensureTab`) is left exactly as it is.** Canonicalising there too looks
   tidy but requires `items` in that effect's dependency array, and then any thread-list tick between
   closing the ACTIVE tab and the resulting `switchToThread` landing would re-open the tab the user
   just closed. Reconciliation collapses the transient duplicate in the same effect flush, before
   paint, so nothing is gained by touching the seam.
5. **`validTabIds` becomes module-private.** After this change its only caller is `reconcileTabIds`,
   and nothing outside the feature imports it (grepped). Its four test cases move into the
   `reconcileTabIds` describe unchanged in meaning — including the inactive-unsent-draft drop, which
   is a listed acceptance criterion.
6. **`SessionTabs` gets the canonical active id, and no new component test.** Between the reload and
   the router's `switchToThread`, `mainThreadId` is still the local id while the tab is already
   canonical; comparing raw ids would blank the active underline for a frame and would make
   `nextActiveAfterClose` mis-resolve a close in that window. The component change is a one-line
   substitution onto a unit-tested helper. The file has no test today (`MainToolbar.test.tsx` mocks
   `SessionTabs` wholesale) and rendering it would need a Radix `TooltipProvider` harness; typecheck
   plus the model tests are the gate. Stated here so the omission is a decision, not an oversight.
7. **`restoreTabIds` / `persistTabIds` stay untouched.** Both already resolve through `remoteId`, and
   the reconcile pass is the safety net if a restore ever matches the orphan entry first (it collapses
   on the next pass). The persisted payload therefore keeps the `{ v: 1, ids }` shape and each stable
   id appears exactly once, which is what the acceptance criteria ask for.

## Tasks

TDD order: tasks 1–4 are red-phase and must be **observed failing** before tasks 5–8 exist.

### Task 1 — Red: `canonicalTabId` unit cases

**File:** `packages/ui/src/features/session-tabs/__tests__/tabs-model.test.ts` (append a
`describe('canonicalTabId')`; import the not-yet-existing `canonicalTabId` from `../tabs-model`).

Reuse the file's existing `entry(id, over)` helper (`tabs-model.test.ts:15-17`), which builds
`{ id, status: 'regular', ...over }`.

Cases, each its own `it`:

- collapses the local id onto the remote entry when both exist:
  `items = [entry('__LOCALID_1', { remoteId: 'chat-a' }), entry('chat-a', { custom: {}, title: 'Fix the parser' })]`
  → `canonicalTabId('__LOCALID_1', items) === 'chat-a'`.
- returns the local id unchanged when the remote entry has not landed yet (the window between the
  first send and the `chat.created` reload): `items = [entry('__LOCALID_1', { remoteId: 'chat-a' })]`
  → `'__LOCALID_1'`.
- returns an unsent draft unchanged: `items = [{ id: '__LOCALID_1', status: 'new' }]` → `'__LOCALID_1'`.
- returns a canonical id unchanged: `items = [entry('chat-a', { remoteId: 'chat-a', custom: {} })]`
  → `'chat-a'` (guards against a self-mapping loop, since listed entries carry `remoteId === id`).
- returns an id with no entry at all unchanged: `canonicalTabId('chat-gone', []) === 'chat-gone'`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/tabs-model.test.ts`
fails to resolve `canonicalTabId`. Every pre-existing describe in the file must still pass.

### Task 2 — Red: `reconcileTabIds` unit cases (absorbing the `validTabIds` block)

**File:** `packages/ui/src/features/session-tabs/__tests__/tabs-model.test.ts`

Add `describe('reconcileTabIds')` and **delete** `describe('validTabIds')` (`tabs-model.test.ts:89-117`),
carrying its four cases over as reconcile cases — nothing is dropped, they are restated through the
exported function. Import `reconcileTabIds`; remove `validTabIds` from the import list.

The acceptance-criterion case, written literally:

```ts
it('collapses the orphaned draft identity onto the created session, in its original slot', () => {
  const items = [
    entry('chat-a', { custom: {}, title: 'Older session' }),
    entry('__LOCALID_9', { remoteId: 'chat-new' }), // orphan: regular, remoteId, no custom/title
    entry('chat-new', { custom: {}, title: 'Fix the parser' }),
  ];

  expect(reconcileTabIds(['chat-a', '__LOCALID_9', 'chat-new'], items, 'chat-new')).toEqual([
    'chat-a',
    'chat-new',
  ]);
});
```

The remaining cases:

- collapses in place even before the seam appends the canonical id (input
  `['chat-a', '__LOCALID_9']`, same items → `['chat-a', 'chat-new']`) — the pass does not depend on
  the seam having run.
- keeps the pre-handoff draft as itself when only the local entry exists
  (`items = [entry('chat-a', { custom: {} }), entry('__LOCALID_9', { remoteId: 'chat-new' })]`,
  input `['chat-a', '__LOCALID_9']`, active `'__LOCALID_9'` → unchanged).
- keeps the ACTIVE unsent draft (from `validTabIds`): `items = [entry('chat-a'), entry('__LOCALID_1', { status: 'new' })]`,
  input `['chat-a', '__LOCALID_1']`, active `'__LOCALID_1'` → `['chat-a', '__LOCALID_1']`.
- drops the INACTIVE unsent draft (from `validTabIds` — the boot-draft cleanup rule): same items,
  input `['chat-a', '__LOCALID_1']`, active `'chat-a'` → `['chat-a']`.
- drops archived entries (from `validTabIds`): `items = [entry('chat-a'), entry('chat-b', { status: 'archived' })]`,
  input `['chat-a', 'chat-b']`, active `'chat-a'` → `['chat-a']`.
- drops ids whose thread vanished (from `validTabIds`): input `['chat-a', 'chat-gone']`,
  `items = [entry('chat-a')]`, active `'chat-a'` → `['chat-a']`.
- keeps the active thread canonical when the active id is still the local one (the frame between the
  reload and the router's handoff): same three-entry fixture as the criterion case, input
  `['chat-a', '__LOCALID_9']`, active `'__LOCALID_9'` → `['chat-a', 'chat-new']`.
- is a no-op on a set with nothing to collapse (`['chat-a', 'chat-b']`, two plain entries, active
  `'chat-a'` → `['chat-a', 'chat-b']`).

**Verify:** the same single-file vitest run fails on the new describe (unresolved `reconcileTabIds`);
`restoreTabIds`, `persistTabIds`, `nextActiveAfterClose` and `canRestoreTabs` still pass.

### Task 3 — Red: store `reconcile` cases

**File:** `packages/ui/src/features/session-tabs/__tests__/store.test.ts`

Replace `describe('pruneTo')` (`store.test.ts:80-107`) with `describe('reconcile')`. The store no
longer knows the rule; it applies a resolver to the current ids.

- applies the resolver to the live ids: `setState({ tabIds: ['a', 'gone', 'b'] })`, then
  `reconcile((ids) => ids.filter((id) => id !== 'gone'))` → `['a', 'b']`.
- swaps an id in place: `setState({ tabIds: ['a', 'local', 'b'] })`,
  `reconcile((ids) => ids.map((id) => (id === 'local' ? 'remote' : id)))` → `['a', 'remote', 'b']`
  (the tab keeps its slot — this is the store half of the in-place identity swap).
- leaves the state object untouched when the resolver returns an EQUAL list — asserting on identity
  (`expect(useSessionTabsStore.getState()).toBe(before)`) with a resolver that returns
  `[...ids]`. Content equality, not reference equality, is the guard that matters:
  `reconcileTabIds` allocates a fresh array on every pass and the effect runs on every thread-list
  tick, so a reference check would re-render the whole strip while a chat streams.
- empties the strip when the resolver returns `[]`.
- reads the CURRENT ids, not a captured snapshot: `setState({ tabIds: ['a'] })`, then inside one test
  call `useSessionTabsStore.getState().ensureTab('b')` before `reconcile((ids) => ids)` and assert
  `['a', 'b']` survives — pins that the store passes `s.tabIds` into the resolver.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/store.test.ts`
— the `reconcile` describe fails (no such action); `ensureTab`, `closeTab` and `hydrate` still pass.

### Task 4 — Red: hook-level handoff regression tests

**File:** `packages/ui/src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx` (append a
`describe('first-send identity handoff')`; keep the file's existing mock harness — mutable
`itemsValue` / `isLoadingValue` / `mainThreadIdValue` behind the mocked `useAuiState`, the
`beforeEach` reset, and `listSucceeded()`).

Cases:

1. **The ghost never reaches the strip.** Start hydrated-by-play: `listSucceeded()`,
   `items = [entry chat-a (custom), { id: '__LOCALID_9', status: 'new' }]`, `isLoading: false`,
   `mainThreadId: '__LOCALID_9'`, render, assert `tabIds === ['chat-a', '__LOCALID_9']`
   (`chat-a` arrives through the seam by activating it first, or by seeding
   `useSessionTabsStore.setState({ tabIds: ['chat-a'] })` before the render — either is fine as long
   as the draft tab lands second). Then simulate the first send + `chat.created` reload:
   `items = [chat-a, { id: '__LOCALID_9', status: 'regular', remoteId: 'chat-new' }, { id: 'chat-new', status: 'regular', custom: {}, title: 'Fix the parser' }]`
   with `mainThreadId` STILL `'__LOCALID_9'`; rerender. Assert `tabIds === ['chat-a', 'chat-new']` —
   one tab, in the draft's slot, before the router even hands over.
2. **The router's handover adds nothing.** From case 1's end state set
   `mainThreadId = 'chat-new'` and rerender. Assert `tabIds` is still `['chat-a', 'chat-new']`
   (the seam appends, the reconcile pass collapses in the same flush).
3. **N sessions → N tabs.** Continue: `mainThreadId = '__LOCALID_10'` with a new draft entry appended
   to `items`, rerender (→ three tabs), then land the second session the same way
   (`__LOCALID_10` regular + `remoteId: 'chat-two'`, plus a `chat-two` entry with `custom`) and set
   `mainThreadId = 'chat-two'`. Assert `tabIds === ['chat-a', 'chat-new', 'chat-two']` — three tabs
   for three sessions, not five.
4. **The persisted set holds each session once.** After case 3, assert the payload read back from
   `localStorage['mf:session-tabs']` is `['chat-a', 'chat-new', 'chat-two']` (helper
   `readPersistedIds()` already exists in the file).
5. **Reconciliation does not wait for hydration.** Fresh state, `listSucceeded()` NOT called
   (`hydrated` stays false), `items` = the orphan + its canonical entry, `mainThreadId` = the local
   id, `tabIds` seeded `['__LOCALID_9']`. Assert `tabIds === ['chat-new']` and
   `hydrated === false` — pins decision 3, and pins that a failed list load cannot strand a ghost.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx`
— every new case fails on `main` (today the seam adds the canonical id and the prune rule keeps the
orphan, so cases 1–3 see two ids per session and case 4 sees a doubled payload; case 5 sees the
orphan survive because the prune effect is gated on `hydrated`). **The five pre-existing #312 cases
must still pass** — record that in the red-phase output. Then run the two other suites unchanged as a
baseline: `store.test.ts` (expected: task 3's describe red) and
`src/features/sessions/ws/__tests__/use-session-list-router.test.tsx` (expected: green).

### Task 5 — `canonicalTabId` + `reconcileTabIds` in the pure model

**File:** `packages/ui/src/features/session-tabs/tabs-model.ts`

- Add exported `canonicalTabId(id: string, items: readonly ThreadListEntry[]): string` — look up the
  entry by `id`; return `id` unless its `remoteId` is set, differs from `id`, and `items` also holds
  an entry keyed by that `remoteId`; then return the `remoteId`. Docblock: aui keeps BOTH identities
  in its thread map for the run (the first send stamps `remoteId` on the local entry, the
  `chat.created` reload adds a second remote-keyed entry), and `switchToThread` accepts either — cite
  `RemoteThreadListThreadListRuntimeCore` / `classifyThreads`.
- Add exported `reconcileTabIds(tabIds, items, activeId: string | null): string[]` — build the valid
  set from `validTabIds(items, activeId === null ? null : canonicalTabId(activeId, items))` so the set
  is expressed in canonical ids, then map each open id through `canonicalTabId`, keeping the FIRST
  occurrence and dropping anything the valid set rejects. Docblock: first-wins dedupe is what makes
  the handoff an in-place swap — the appended canonical tab merges into the draft tab's slot instead
  of taking a new one at the end.
- Drop the `export` from `validTabIds` (its rule is unchanged; its only caller is now
  `reconcileTabIds`) and move its docblock's boot-draft paragraph with it.

Both functions stay pure and allocation-only; no store, no aui imports. Keep the file under 300 lines
and each function under 50.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/tabs-model.test.ts`
— all green, including the pre-existing `restoreTabIds` / `persistTabIds` / `nextActiveAfterClose` /
`canRestoreTabs` describes.

### Task 6 — `reconcile` in the store

**File:** `packages/ui/src/features/session-tabs/store.ts`

- Replace `pruneTo: (valid: ReadonlySet<string>) => void` with
  `reconcile: (resolve: (ids: readonly string[]) => string[]) => void`, implemented as
  `set((s) => { const next = resolve(s.tabIds); return sameIds(next, s.tabIds) ? s : { tabIds: next }; })`
  with a module-local `sameIds(a, b)` comparing length and every element in order.
- Comment the two load-bearing properties in one line each: the resolver runs against the CURRENT
  ids (a precomputed array would be stale after a same-flush `hydrate`), and the content check keeps
  the state object identical when nothing moved (the caller allocates a fresh array on every
  thread-list tick, and a new object would re-render the strip while a chat streams).
- Update the interface docblock: the store no longer knows the prune rule; it applies whatever the
  sync hook's pure resolver returns.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/store.test.ts` — green.

### Task 7 — Reconcile at the sync seam

**File:** `packages/ui/src/features/session-tabs/use-session-tabs-sync.ts`

- Import `reconcileTabIds` instead of `validTabIds`; select `reconcile` instead of `pruneTo`.
- Replace the prune effect with
  `useEffect(() => { reconcile((ids) => reconcileTabIds(ids, items, mainThreadId)); }, [items, mainThreadId, reconcile]);`
  — **without** the `hydrated` guard (decision 3), and leave `hydrated` out of its dependencies.
- Leave the hydrate effect, the `ensureTab` effect (decision 4 — do NOT add `items` to its deps) and
  the persist effect exactly as they are.
- Update the module docblock: the third effect now reconciles identities as well as pruning — one
  session's pre-send and post-create ids are one member, collapsed onto the remote-keyed entry in
  place — and say why it runs before hydration (pre-hydration the set holds only seam-added active
  ids, and a ghost must not outlive a failed list load).

**Verify, in order:**
1. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx` — green, new describe AND the five #312 cases.
2. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/store.test.ts` — green.
3. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/tabs-model.test.ts` — green.
4. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/use-session-list-router.test.tsx` — green (the first-send handoff is untouched).

### Task 8 — Canonical active id in the strip

**File:** `packages/ui/src/features/session-tabs/SessionTabs.tsx`

- Import `canonicalTabId` alongside `nextActiveAfterClose`.
- Compute `const activeTabId = canonicalTabId(mainThreadId, items);` once in the component and use it
  everywhere `mainThreadId` is compared against a TAB id: the `toTabEntry(id, items, activeTabId)`
  call, the `handleActivate` early-return guard, and both `nextActiveAfterClose(...)` and the
  post-close switch guard in `handleClose`.
- Keep passing the id the user clicked to `aui.threads.switchToThread` — the ids in `tabIds` are
  already canonical, and aui resolves either form.
- One-line comment on `activeTabId`: between the `chat.created` reload and the router's handover the
  active thread is still the local id while its tab is already canonical; comparing raw ids would
  blank the active underline and mis-resolve a close in that window.

Nothing else in the file changes — no markup, no testids, no styling (the brief puts the strip's
visual design out of scope).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes (it includes the test files), and
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/MainToolbar.test.tsx` is
green (it mocks `SessionTabs`, so this only proves nothing upstream moved).

### Task 9 — Changeset

Run `pnpm changeset`, select `@qlan-ro/mainframe-ui`, bump **patch**. One sentence, no marketing:
starting a session no longer leaves a second, unselectable tab behind — the draft tab becomes the
session's tab in place.

**Verify:** the generated `.changeset/*.md` names `@qlan-ro/mainframe-ui` with `patch`.

## Manual QA (post-merge, not a task gate)

In the Tauri dev app with an isolated `MAINFRAME_DATA_DIR` and `DAEMON_PORT`: press "+", send a first
message, and confirm the strip keeps ONE tab, in the slot the draft held, which takes the session's
real title and project dot. Repeat twice more and confirm three tabs, not six. Click every tab and
confirm each activates its own session with no bounce-back. Then `location.reload()` and confirm the
same three tabs return (#312's behavior, unchanged).

## Out of scope

The no-id-flip contract and the per-chat controller's remote-id adoption; the session-list router's
first-send handoff, boot auto-select, and archived-active fallback; assistant-ui internals and the
exact `0.15.13` pin; the sidebar session list (it already hides the orphan); tab restore-on-reload
timing (#312, already landed); any visual change to the strip — pill styling, overflow, the close
affordance, and the new-session button all stay as they are.
