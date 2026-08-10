# Session tabs: hydrate against the settled thread list (todo #312)

## Goal

Session tabs vanish on reload because `useSessionTabsSync` restores the persisted open set as
soon as `s.threads.threadItems` is non-empty, and the assistant-ui remote thread-list runtime
seeds that array synchronously with the transient new-thread draft before `adapter.list()`
resolves. The restore therefore runs against a one-entry draft-only list, matches none of the
persisted ids, commits an empty restore, and latches `hydrated` for the rest of the app run; the
persist effect then writes the single surviving tab back over `mf:session-tabs`, making the loss
permanent. This change moves the readiness decision into a pure predicate in `tabs-model.ts`
(`canRestoreTabs(items, isListLoading)`) that requires a **settled** list carrying at least one
real session, and gates the hydrate effect on it by subscribing to the runtime's
`s.threads.isLoading`. Nothing else moves: the payload shape stays `{ v: 1, ids }`, the persist
effect stays gated on `hydrated`, and boot auto-select, the sidebar, and the identity
reconciliation tracked as #319 are untouched.

## Verified facts this plan rests on

Read before planning; cite these instead of re-deriving them.

- `@assistant-ui/core@0.2.21` `RemoteThreadListThreadListRuntimeCore` initialises its state with
  `isLoading: true` and sets `isLoading: false` on **both** the success path and the `.catch()`
  path of `getLoadThreadsPromise()`. `isLoading === false` therefore means "settled", including a
  failed load — which is exactly why the predicate also needs the "has a real session" half.
- `store/runtime-clients/thread-list-runtime-client.js` maps `runtimeState.isLoading` into the
  store scope, so `useAuiState((s) => s.threads.isLoading)` is live and re-renders on change.
  The type is declared on `ThreadsState` in `store/scopes/threads.d.ts`.
- `makeChatsRemoteAdapter().list()` returns `{ threads }` with **no** `nextCursor`
  (`packages/ui/src/features/sessions/runtime/chats-remote-adapter.ts`), so the thread list is a
  single page. There is no "tabs on page 2 get pruned" risk.
- Nothing outside `packages/ui/src/features/session-tabs/` reads `useSessionTabsStore` or
  `hydrated` (grepped). Moving when the flag latches cannot affect another surface.
- The freshly-created draft entry gets `remoteId` stamped by `adapter.initialize` **without**
  `custom` (custom only arrives on the next list reload, under a remoteId-keyed entry — see the
  `activeSessionCustom` docblock in `chat-to-thread-custom.ts`). `custom` is written **only** by
  the `list()` projection, which makes it the one available proof that a load succeeded: a
  "real session" test is `custom != null`, and a `remoteId` alone must NOT qualify.
- `use-session-list-router.ts` reloads the thread list on `chat.created` / `chat.updated`, so the
  first send on a session-less install (and any recovery after a failed load) brings a
  `custom`-carrying list in on its own — hydration needs no retry of its own.

## Files touched

| File | Change |
|---|---|
| `packages/ui/src/features/session-tabs/tabs-model.ts` | add `isSessionEntry` (private) + exported `canRestoreTabs` |
| `packages/ui/src/features/session-tabs/use-session-tabs-sync.ts` | subscribe `s.threads.isLoading`; gate the hydrate effect on `canRestoreTabs`; correct the header docblock |
| `packages/ui/src/features/session-tabs/__tests__/tabs-model.test.ts` | add a `canRestoreTabs` describe block |
| `packages/ui/src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx` | new — hook-level boot-race regression tests |
| `.changeset/<generated>.md` | patch bump for `@qlan-ro/mainframe-ui` |

Constraints from `CLAUDE.md` / `packages/ui/CLAUDE.md`: max 300 lines per file (all four files stay
far under), no `@ts-ignore`, comments state *why*, changeset required, single-file vitest runs only
(`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`) — never the full suite.

## Decisions taken while planning

1. **"The previously active session is active" needs no new work.** `use-session-list-router.ts`
   already persists the active chat id via `rememberActiveSession` → `useLastSessionStore`, and the
   boot auto-select passes it to `pickInitialSession`, which prefers it over the most-recent
   session. The acceptance criterion is met by existing machinery, so the persisted payload keeps
   its `{ v: 1, ids }` shape and boot auto-select stays out of scope as the brief requires.
2. **`isSessionEntry` requires `custom`; a `remoteId`-only entry does not qualify.** The brief's
   "at least one entry that is not the synthetic draft" reads as `custom != null || remoteId != null`,
   but that admits the one path where the guard matters most: after a failed initial load,
   `adapter.initialize` stamps `remoteId` on the still-draft-only list at the user's first send,
   hydration would restore nothing, latch, and the persist effect would overwrite the live payload
   with the one new chat. Requiring `custom` means only a list the daemon actually returned can
   open the gate. Cost: on a session-less install hydration waits for the `chat.created` reload
   instead of latching at the send — a few hundred ms, then persistence behaves as before.
3. **No extra "never persist an empty set" guard.** With the new latch, any hydration that happens
   consumed a settled list holding a real session, so a persisted `[]` is a true state (e.g. every
   persisted session has since been archived). Adding a second guard would make that legitimate
   case unrepresentable.
4. **No timer, no retry loop.** `hydrated` stays unlatched until a qualifying list arrives; the
   effect already re-runs on `items` / `isLoading` changes, so a late-arriving list is picked up
   for free.

## Tasks

TDD order: tasks 1 and 2 are red-phase and must be **observed failing** before tasks 3 and 4 exist.

### Task 1 — Red: `canRestoreTabs` unit cases

**File:** `packages/ui/src/features/session-tabs/__tests__/tabs-model.test.ts` (append one
`describe('canRestoreTabs')` block; import the not-yet-existing `canRestoreTabs` from `../tabs-model`).

**Fixture rider — read before writing the cases.** The file's existing `entry()` helper
(`tabs-model.test.ts:15-17`) builds `{ id, status: 'regular', ...over }`: no `custom`, no
`remoteId`. Task 3's predicate is `custom != null || remoteId != null`, so a bare `entry('chat-a')`
is **not** a real session and `canRestoreTabs` returns `false` for it. Every case below that expects
`true` must therefore hand the entry a `custom` — `entry('chat-a', { custom: {} })` — which is what
production does: `chatToThreadCustom` stamps a `SessionCustom` onto every listed chat
(`packages/ui/src/features/sessions/view-model/chat-to-thread-custom.ts:56-81`). `custom` is typed
`Record<string, unknown> | undefined` on `ThreadListEntry`, so `{}` typechecks. Do **not** instead
default `custom: {}` inside the helper: the `validTabIds` describe builds its synthetic drafts with
the same helper (`tabs-model.test.ts:99,107`), and a default would give those drafts a `custom` that
the real draft never has.

Cases, each a separate `it`:

- returns `false` while the list is still loading, even with real sessions present
  (`canRestoreTabs([entry('chat-a', { custom: {} })], true) === false`).
- returns `false` for a settled list holding only the synthetic draft
  (`[{ id: '__LOCALID_1', status: 'new' }]`, `isLoading: false`) — the defect, stated as a test.
- returns `false` for a settled empty list (`[]`) — a failed load or a session-less install is
  "nothing restored yet", not "no tabs".
- returns `true` for a settled list with a real session (`entry('chat-a', { custom: {} })`).
- returns `false` for a just-sent draft carrying `remoteId` but no `custom`
  (the object literal `{ id: '__LOCALID_1', status: 'regular', remoteId: 'chat-a' }`, not the helper)
  — after a failed load that is the whole list, and restoring against it would drop every tab.
- returns `true` for a settled list of only archived entries
  (`[entry('chat-a', { status: 'archived', custom: {} })]`) — the sessions existed; restoring
  nothing and persisting `[]` is the correct outcome there.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/tabs-model.test.ts`
fails to resolve `canRestoreTabs` (or every new case fails). The pre-existing describes in the file
must still pass.

### Task 2 — Red: hook-level boot-race regression test

**File:** `packages/ui/src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx` (new;
`.test.tsx` so the vitest `dom` project gives it jsdom — do not add a `@vitest-environment` pragma).

Mock `@assistant-ui/react` the way `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`
does: `vi.mock` with mutable module-scope variables (`itemsValue`, `isLoadingValue`,
`mainThreadIdValue`) behind a `useAuiState` implementation that applies the selector to
`{ threads: { threadItems: itemsValue, isLoading: isLoadingValue, mainThreadId: mainThreadIdValue } }`.
Reset `useSessionTabsStore.setState({ tabIds: [], hydrated: false })` and `localStorage.clear()` in
`beforeEach`. Drive re-renders with `rerender()` from `renderHook` after mutating the variables.

Cases:

1. **Boot race — does not latch against the draft-only list.** Seed
   `localStorage['mf:session-tabs'] = JSON.stringify({ v: 1, ids: ['chat-a', 'chat-b'] })`;
   render with `isLoading: true`, `items: [{ id: '__LOCALID_1', status: 'new' }]`,
   `mainThreadId: '__LOCALID_1'`. Assert `hydrated === false` and that the stored payload still
   holds `['chat-a', 'chat-b']` (the persist effect must not have run).
2. **Restore on settle, in persisted order.** From case 1's state, set
   `items: [{ id: 'chat-b', status: 'regular', custom: {} }, { id: '__LOCALID_9', status: 'regular', remoteId: 'chat-a', custom: {} }]`,
   `isLoading: false`, `mainThreadId: 'chat-b'`, rerender. Assert `hydrated === true` and
   `tabIds` starts with `['__LOCALID_9', 'chat-b']` — persisted order (`chat-a` then `chat-b`)
   preserved and the persisted `chat-a` mapped onto this boot's runtime id.
3. **Settled draft-only list does not clobber.** Seed the same payload; render with
   `isLoading: false`, `items: [{ id: '__LOCALID_1', status: 'new' }]`,
   `mainThreadId: '__LOCALID_1'`. Assert `hydrated === false` and that the stored payload still
   holds `['chat-a', 'chat-b']`. Then set
   `items: [{ id: 'chat-a', status: 'regular', custom: {} }, { id: 'chat-b', status: 'regular', custom: {} }]`,
   `mainThreadId: 'chat-a'`, and rerender; assert `hydrated === true` and
   `tabIds === ['chat-a', 'chat-b']` — the boot draft pruned away, both tabs back.

   This item list, not `items: []`, is what makes the case red. With `items: []` the current effect
   early-returns on `items.length === 0` (`use-session-tabs-sync.ts:42`), never latches, and never
   persists — both assertions already pass on `main`, so that shape tests nothing here. It stays a
   `canRestoreTabs` unit case in task 1 instead. A settled one-entry draft list is the real
   clobber path: it has length 1, so today it hydrates `[]`, latches, and the persist effect
   overwrites `mf:session-tabs` with `{ v: 1, ids: [] }`.
4. **Failed load, then a first send.** Seed the same payload; settle draft-only, then stamp the
   draft with a `remoteId` (`adapter.initialize`) while the list is still the failed one. Assert
   `hydrated === false` and the payload intact. Then let the `chat.created` reload land the real
   sessions and assert both tabs restore ahead of the draft tab.
5. **Session-less install stays clean.** Empty `localStorage`; `isLoading: false`,
   `items: [{ id: '__LOCALID_1', status: 'new' }]`, `mainThreadId: '__LOCALID_1'`. Assert
   `tabIds === ['__LOCALID_1']` (the membership seam still opens the draft tab), `hydrated === false`,
   and `localStorage.getItem('mf:session-tabs') === null`.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx`
— **every case** fails against current `main`. Each one renders a list of length ≥ 1, so today's
`items.length === 0` gate lets the hydrate effect through on the first render: it restores
nothing, latches `hydrated`, and the persist effect writes `{ v: 1, ids: [] }`. That breaks cases
1, 3, 4 and 5 on `hydrated === false` (plus case 5's `localStorage.getItem(...) === null` and
cases 3–4's intact payload), and case 2's restored `tabIds` order (the latched flag makes the real
list arrive too late to restore). Record the failure output; that is the red phase for the whole
change.

### Task 3 — `canRestoreTabs` in the pure model

**File:** `packages/ui/src/features/session-tabs/tabs-model.ts`

Add, below `findEntry`:

- private `isSessionEntry(entry: ThreadListEntry): boolean` → `entry.custom != null`, with a
  one-line comment explaining that `custom` is written only by the `list()` projection, so it is
  the one proof a load actually succeeded.
- exported `canRestoreTabs(items: readonly ThreadListEntry[], isListLoading: boolean): boolean` →
  `!isListLoading && items.some(isSessionEntry)`, with a docblock stating why both halves are
  needed: the runtime seeds `threadItems` with the draft before `list()` resolves, and `isLoading`
  also goes false on a **failed** load, where restoring would clobber a live payload.

No other export in the file changes.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/tabs-model.test.ts`
— all green, including the pre-existing describes.

### Task 4 — Gate the hydrate effect on the settled list

**File:** `packages/ui/src/features/session-tabs/use-session-tabs-sync.ts`

- Import `canRestoreTabs` alongside the existing `tabs-model` imports.
- Add `const isListLoading = useAuiState((s) => s.threads.isLoading);` next to the existing
  `items` / `mainThreadId` selectors.
- Replace the hydrate effect's condition with
  `if (hydrated || !canRestoreTabs(items, isListLoading)) return;` and add `isListLoading` to the
  dependency array.
- Rewrite the two now-false claims in the module docblock: "restore once the thread list has
  loaded" becomes restore once the list has **settled with at least one real session**, and
  "Zero-session boots never hydrate" becomes an explicit statement that an empty or unresolvable
  list leaves `hydrated` false so the persisted payload survives and a later list still restores.

Leave the `ensureTab`, `pruneTo`, and persist effects untouched — the persist gate on `hydrated` is
now sufficient by construction.

**Verify, in order:**
1. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/use-session-tabs-sync.test.tsx` — green.
2. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/session-tabs/__tests__/store.test.ts` — green (unchanged behavior).
3. `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/use-session-list-router.test.tsx` — green (the boot auto-select interaction is untouched).

### Task 5 — Changeset

Run `pnpm changeset`, select `@qlan-ro/mainframe-ui`, bump **patch**. One sentence, no marketing:
session tabs now restore against the settled thread list, so a reload no longer drops every tab but
the active one, and a failed or empty list no longer overwrites the persisted set.

**Verify:** the generated `.changeset/*.md` names `@qlan-ro/mainframe-ui` with `patch`.

### Task 6 — Typecheck

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` passes (it includes the test files).

## Manual QA (post-merge, not a task gate)

In the Tauri dev app with an isolated `MAINFRAME_DATA_DIR` and `DAEMON_PORT`: open two sessions as
tabs, `location.reload()`, confirm both tabs return in order with the last-used one active. Then
stop the daemon, reload, confirm the strip comes up empty **and** `localStorage['mf:session-tabs']`
still holds both ids; restart the daemon and reload to confirm both tabs come back.

## Out of scope

The assistant-ui thread-list internals and the exact `0.14.27` pin; the no-id-flip contract and the
first-send handoff in `use-session-list-router.ts`; the duplicate/ghost tab after a first send
(#319 — same two files, so whichever lands second rebases; do not fold its identity reconciliation
in here); the sidebar session list, boot auto-select, and layout persistence; the payload's shape
and version.
