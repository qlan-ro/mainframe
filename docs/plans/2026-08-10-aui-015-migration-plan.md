# assistant-ui 0.15 migration — implementation plan

Todo #306 · branch `todo/306-aui-015-migration` · route `no-spec` (plan written from the approved Agent Brief)

## Goal

Move `packages/ui` off the two assistant-ui legacy context hooks it still imports — `useAssistantRuntime` (46 references) and `useThreadListItemRuntime` (5) — onto the `useAui` client and `useAuiState` selectors, then bump the whole `@assistant-ui/*` set, exact-pinned, to the 0.15 line (`react@0.15.13`, `store@0.3.8`, `react-markdown@0.14.10`). 0.15.0 deletes those hooks, so the migration is the toll gate for every future assistant-ui adoption. The change must be invisible to users: sessions list, select, archive, tag, rename and draft exactly as today; the new-thread flow still creates a chat on first send only; `convertMessage` output is untouched. `packages/ui` is the only package that depends on assistant-ui, so the blast radius is one package plus its Playwright coverage.

## Verified API facts (checked against the published tarballs, not the docs)

Every claim below was verified by extracting `@assistant-ui/react@0.15.13`, `@assistant-ui/core@0.3.12`, `@assistant-ui/store@0.3.8` and `@assistant-ui/react-markdown@0.14.10` and diffing their `.d.ts` against the installed `react@0.14.27` / `core@0.2.21` / `store@0.2.20`. Implementers should trust this section over the brief where they disagree.

**Exactly 23 exports are removed in 0.15.13**, and 3 are added:

- Removed: `useAssistantRuntime`, `useThreadRuntime`, `useThread`, `useThreadList`, `useThreadListItem`, `useThreadListItemRuntime`, `useThreadComposer`, `useThreadComposerAttachment`, `useThreadComposerAttachmentRuntime`, `useThreadModelContext`, `useMessage`, `useMessageRuntime`, `useMessagePart`, `useMessagePartRuntime`, `useMessageAttachment`, `useMessageAttachmentRuntime`, `useComposer`, `useComposerRuntime`, `useEditComposer`, `useEditComposerAttachment`, `useEditComposerAttachmentRuntime`, `useAttachment`, `useAttachmentRuntime`.
- Added: `AuiConfig`, `MessagePartStreamStatus`, `RemoteThreadListProviderComponent`.
- Of the 23, this repo imports only `useAssistantRuntime` and `useThreadListItemRuntime`.

**Nothing else in our consumed surface moved.** These typedefs are byte-identical between 0.14.27 and 0.15.13: `ExternalStoreAdapter`, `groupPartByType`, `RemoteThreadListAdapter`, `ThreadListItemRuntimeProvider`. The scope registry (`threads`, `threadListItem`, `thread`, `message`, `part`, `composer`, `attachment`, …) is identical between `core@0.2.21` and `core@0.3.12`; the only scope changes are additive: `threads.reloadMainThread()`, `threadListItem.isRunning`, `thread.importExternalState()`, `composer.queueItem({id})`. All `Unstable_TriggerPopover*` / `unstable_use*Adapter` exports the composer triggers depend on still exist.

**Four brief claims are wrong; the resolutions are binding for this plan:**

1. *"Land the whole set on one 0.15.x line."* `@assistant-ui/react-markdown` has no 0.15 line — its newest is `0.14.10`, whose peer is `@assistant-ui/react: ^0.15.0`. The criterion as literally written is unsatisfiable. **Resolution:** `react@0.15.13` + `react-markdown@0.14.10` + `store@0.3.8`, all exact. The criterion's intent (one mutually compatible set, no ranges, markdown moves in lockstep) is met; the current `^0.14.6` caret is killed.
2. *"The provider's extended-client prop was renamed `aui` → `config`."* It was not renamed. `AssistantRuntimeProvider.Props` at 0.15.13 has **both** `aui?: AssistantClient` and a new `config?: AuiConfig`. We pass neither. **No action.**
3. *"0.15 no longer throws on selecting an unavailable scope."* The opposite. An unavailable accessor has `source: null` and **throws when any other property is read or when it is called**; the accessor object itself is **always truthy**, so `if (aui.thread)` is a bug. Availability is tested with `aui.thread.source != null` (client) or by selecting through `s.optional.<scope>`, which resolves to `undefined` instead of throwing (selector). Verified clean: this repo has no try/catch or truthiness check that relies on the old throw.
4. *"0.15.0 drops `ToolsState.tools` and the `mcp-app` group key."* `mcp-app` is still present at 0.15.13. Verified clean: this repo references neither `ToolsState.tools` nor `toolUIs`, so both are no-ops here.

**Call-form scope accessors are deprecated, not removed.** At `store@0.3.8` the accessor type is `ClientSchemas[K]["methods"] & { /** @deprecated */ (): ClientSchemas[K]["methods"] } & …`. `aui.composer()` keeps working; the property sweep is hygiene, not a break. This is what makes the ordering below safe.

**The two container shapes differ and this bites three call sites.** The legacy `ThreadListState` (`runtime.threads.getState()`) exposes `threadIds` plus a `threadItems` **Record keyed by id**. The store scope `ThreadsState` (`aui.threads.getState()` / `s.threads`) exposes `threadItems` as an ordered **array** holding regular *and* archived entries. `chat-to-thread-custom.ts` already documents this and already ships both projections for the regular list; only the archived projection is missing.

## Constraints from CLAUDE.md

- Max 300 lines per file, 50 per function. `SessionRow.tsx` is at 283 — task 4 extracts rather than grows it.
- `data-testid` on every interactive element; this migration must not move or rename one.
- No `@ts-ignore` (use `@ts-expect-error` with a reason); no silent catches; comments say *why*.
- No leftovers: once the array converters land, the record-shaped ones are dead and get deleted in the same PR (task 17).
- A changeset is required before commit (task 26).
- Prefer single-file vitest runs; large multi-suite UI batches hit cross-file `React.act` failures (see task 1).

## Strategy: migrate first on 0.14.27, then bump, then sweep

The two directions of the constraint are both proven:

- Bumping first turns the whole package red at once — 51 references across 20 source files and 10 test files stop compiling simultaneously, and no intermediate state is verifiable.
- The 0.15 **property** form does not exist at 0.14.27 (`store@0.2.20`'s accessor is call-only), so phase A must be written in **call form**: `aui.threads().reload()`, `aui.threadListItem().archive()`.

Migrating first keeps every cluster independently verifiable against a green suite. The double touch is cheap because a call→property sweep is required regardless: 13 call-form sites already exist in the repo today, predating this work.

Everything phase A needs exists at 0.14.27: `useAui`, `useAuiState`, `AuiProvider` and `AuiIf` are re-exported by `@assistant-ui/react@0.14.27`, and `Derived` is exported by `@assistant-ui/store@0.2.20` with the same `{type:'id', id}` `threadListItem` query meta as 0.3.8.

## The one real design decision: SessionRow's by-id `threadListItem` scope

`SessionRowResolver` is the only site that cannot be replaced by a straight `useAui` call. It resolves a **legacy `ThreadListItemRuntime` by id** (`useAssistantRuntime().threads.getItemById(item.id)`) and feeds it to `ThreadListItemRuntimeProvider`, which is what makes `ThreadListItemPrimitive.Root/.Trigger` and `useThreadListItemRuntime` work for that row. The aui client's `aui.threads().item({id})` returns `ThreadListItemMethods`, not a `ThreadListItemRuntime`, so it is not a drop-in for the provider's prop.

**Chosen mechanism (primary): mirror assistant-ui's own `ThreadListItemByIndexProvider`, keyed by id.** Its source (shipped in the `core` tarball) is:

```tsx
const aui = useAui();
const config = AuiConfig({
  threadListItem: Derived({
    source: "threads",
    query: { type: "index", index, archived },
    get: (aui) => aui.threads.item({ index, archived }),
  }),
});
return <AuiProvider extends={aui} config={config}>{children}</AuiProvider>;
```

We write the `{type:'id', id}` twin. This is public API, and `store` is already named in the acceptance criterion's "whole family". It requires adding `@assistant-ui/store` as a direct exact-pinned dependency of `packages/ui`, because `Derived` is exported by `store` and is **not** re-exported by `@assistant-ui/react` at either version.

**The discriminating constraint: there must be exactly one `@assistant-ui/store` instance in the lockfile.** A second copy means our `AuiProvider` writes a different React context than the one `ThreadListItemPrimitive` reads, and every session row silently stops working. Task 4 verifies this before the mechanism is trusted, and task 19 re-verifies it after the bump.

**Documented fallback, same task, objective gate:** if `pnpm why @assistant-ui/store` in `packages/ui` shows more than one resolved instance and a single `pnpm dedupe` does not collapse it, drop the direct `store` dependency and instead source the runtime from the typed escape hatch `aui.threads().item({ id }).__internal_getRuntime?.()`, feeding the still-public, still-unchanged `ThreadListItemRuntimeProvider`. The repo already uses this pattern once (`features/chat/composer/read-live-composer-state.ts:18`). Whichever branch is taken, the mechanism lives in exactly one small module.

**Rejected:** carrying the `AssistantRuntime` object down through a local React context. It recreates `useAssistantRuntime` privately and defeats the brief's "actions through the `useAui` client".

## Call-site translation table

Bind `const aui = useAui();` and rewrite. Phase A uses call form throughout; task 21 sweeps it to property form.

| Today | Phase A (0.14.27) | After task 21 |
|---|---|---|
| `runtime.threads.switchToThread(id)` | `aui.threads().switchToThread(id)` | `aui.threads.switchToThread(id)` |
| `runtime.threads.reload()` | `aui.threads().reload()` | `aui.threads.reload()` |
| `runtime.threads.switchToNewThread()` | `aui.threads().switchToNewThread()` | `aui.threads.switchToNewThread()` |
| `runtime.threads.getState().newThreadId` | `aui.threads().getState().newThreadId` | `aui.threads.getState().newThreadId` |
| `runtime.threads.main.append(msg)` | `aui.threads().thread('main').append(msg)` | `aui.threads.thread('main').append(msg)` |
| `runtime.thread.composer.setText(t)` (one in-scope site: `use-instruction-actions.ts`) | `aui.threads().thread('main').composer().setText(t)` | `aui.threads.thread('main').composer().setText(t)` |
| `itemRuntime.rename(t)` / `.archive()` | `aui.threadListItem().rename(t)` / `.archive()` | `aui.threadListItem.rename(t)` / `.archive()` |
| `runtime.threads.getItemById(id)` | task 4's scope module | unchanged |

**Only the top-level `aui.<scope>` accessor drops its parens** — in code and in test mocks. Nested calls (`.thread('main')`, `.composer()`, `.item({id})`) keep theirs at both versions: the dual property/call form is declared on `AssistantClient`'s top-level keys alone (`store@0.3.8` `AssistantClientAccessor`), while `ThreadMethods.composer()` is still call-only at `core@0.3.12`. Writing `aui.threads.thread('main').composer.setText(…)` is a TS2339 — `.composer` there is a function value, not `ComposerMethods`.

Two type gotchas that fall out of the table:

- `ThreadsMethods.switchToNewThread()` returns `void`, whereas the legacy `ThreadListRuntime.switchToNewThread()` returned `Promise<void>`. Sites that `await` it still compile (awaiting `void` is legal), but structural dependency types that *declare* `Promise<void>` do not — see task 14.
- `ThreadsState.newThreadId` is `string | null` (legacy: `string | undefined`) and `mainThreadId` is `string` (legacy: `string | null`). Same file, task 14.

## Verification commands

- Single test file: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <path>`
- Full UI unit suite: `pnpm --filter @qlan-ro/mainframe-ui test`
- Typecheck (includes tests): `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- Full E2E batch: `pnpm test:e2e` (from the repo root; runs `E2E_MODE=mock`)
- Legacy-hook grep (must print nothing):
  `grep -rnE "\b(useAssistantRuntime|useThreadRuntime|useThread|useThreadList|useThreadListItem|useThreadListItemRuntime|useThreadComposer|useThreadModelContext|useMessage|useMessageRuntime|useMessagePart|useMessagePartRuntime|useMessageAttachment|useComposer|useComposerRuntime|useEditComposer|useAttachment|useAttachmentRuntime)\b" --include="*.ts" --include="*.tsx" packages/ui/src`
- Call-form grep (must print nothing after task 21):
  `grep -rnE "aui\.(threads|thread|composer|threadListItem|message|part|attachment|modelContext|suggestions|suggestion|chainOfThought|queueItem)\(\)" --include="*.ts" --include="*.tsx" packages/ui/src`

---

## Tasks

### Task 1 — Record the pre-change baseline

**Files:** none (no edits).

1. Run `pnpm --filter @qlan-ro/mainframe-ui test` and record the pass/fail counts and the names of any already-failing files.
2. Run `pnpm --filter @qlan-ro/mainframe-ui typecheck` and record the result.

**Why:** the UI suite is known to hit cross-file `React.act` failures in large batches. Without a recorded baseline, post-bump fallout is not attributable. Re-run any file that fails in the batch on its own before calling it a genuine failure.

**Verify:** the baseline is written into the task's report — counts, plus the exact list of files that were already red (re-confirmed individually).

---

### Task 2 — RED: test the archived array projection

**Files:** `packages/ui/src/features/sessions/view-model/__tests__/thread-list-projection.test.ts`

Add a `describe('archivedThreadItemsToSessionItems')` block importing a not-yet-existing `archivedThreadItemsToSessionItems` from `../chat-to-thread-custom`. Cases, mirroring the existing `archivedThreadListStateToSessionItems` behaviour but over the store-scope array:

1. Returns only entries whose `status === 'archived'`; a `'regular'` entry is excluded.
2. Drops the custom-less draft entry (`custom: undefined`) even when its status is `'archived'`.
3. Maps `{id, remoteId, title, custom}` through unchanged and sets `status: 'archived'` on the result.
4. Preserves the input array order.
5. Returns `[]` for an empty array.

Do not touch `chat-to-thread-custom.ts` in this task.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/view-model/__tests__/thread-list-projection.test.ts` fails, and it fails on the missing export — not on a syntax error. Every other block in the file still passes.

**Scheduling constraint this creates:** `packages/ui`'s typecheck is `tsc --noEmit` over `include: ["src"]`, which covers `src/**/__tests__/`. From the moment this task lands until task 3 heals it, `pnpm --filter @qlan-ro/mainframe-ui typecheck` is red package-wide, by design. Any task whose verify step demands a clean typecheck must therefore be scheduled after task 3, never between tasks 2 and 3.

---

### Task 3 — GREEN: add `archivedThreadItemsToSessionItems`

**Files:** `packages/ui/src/features/sessions/view-model/chat-to-thread-custom.ts`

Add, next to `regularThreadItemsToSessionItems`:

```ts
export function archivedThreadItemsToSessionItems(entries: readonly ThreadListEntry[]): SessionItem[] {
  return entries
    .filter(hasSessionCustom)
    .filter((entry) => entry.status === 'archived')
    .map(threadEntryToSessionItem);
}
```

It is the exact complement of `regularThreadItemsToSessionItems`'s `status !== 'archived'` filter. It reads status off the entry rather than intersecting `archivedThreadIds`, because the store-scope `threadItems` array holds both buckets and the entry's own status is what `threadEntryToSessionItem` already keys on. Add a one-line doc comment saying why it filters on status instead of the id bucket. Do not touch the record-shaped functions yet.

**Verify:** the task-2 file passes in full. `pnpm --filter @qlan-ro/mainframe-ui typecheck` is clean. The file stays under 300 lines.

---

### Task 4 — New module: the by-id `threadListItem` scope for a session row

**Files:** new `packages/ui/src/features/sessions/SessionRowItemScope.tsx`; `packages/ui/package.json`

1. Add `"@assistant-ui/store": "0.2.20"` (exact, no caret) to `packages/ui` dependencies — the version `@assistant-ui/react@0.14.27` already resolves. Run `pnpm install`.
2. **Gate:** run `pnpm --filter @qlan-ro/mainframe-ui why @assistant-ui/store` and grep `pnpm-lock.yaml` for `'@assistant-ui/store@`. Exactly one resolved instance must appear. If two appear, run `pnpm dedupe` once and re-check; if it still shows two, take the fallback in step 4 instead and revert the dependency addition.
3. **Primary:** export `SessionRowItemScope({ id, children })`:

```tsx
const aui = useAui({
  threadListItem: Derived({
    source: 'threads',
    query: { type: 'id', id },
    get: (client) => client.threads().item({ id }),
  }),
});
return <AuiProvider value={aui}>{children}</AuiProvider>;
```

`useAui`, `AuiProvider` come from `@assistant-ui/react`; `Derived` from `@assistant-ui/store`. At `store@0.2.20` the extend-and-provide idiom is the `useAui(clients)` overload plus `AuiProvider value={…}`; task 22 converts it to the 0.15 `AuiConfig` + `extends`/`config` form.
4. **Fallback (only if the gate in step 2 fails):** keep `ThreadListItemRuntimeProvider` and source its runtime from `aui.threads().item({ id }).__internal_getRuntime?.()`, returning `null` when the optional method is absent. Record in the module's header comment which branch was taken and why.
5. Header comment: state that this module is the single place a session row's `threadListItem` scope is constructed, and that a second `@assistant-ui/store` instance would silently break every row by splitting the React context.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` is clean; the lockfile shows one `@assistant-ui/store` entry; the new file is under 300 lines.

---

### Task 5 — Migrate `SessionRow.tsx`

**Files:** `packages/ui/src/features/sessions/SessionRow.tsx`

1. Drop the `useAssistantRuntime` and `useThreadListItemRuntime` imports; import `useAui` from `@assistant-ui/react` and `SessionRowItemScope` from task 4.
2. `useRowActions`: `assistantRuntime.threads.reload()` → `aui.threads().reload()`. The `.catch` and its `console.warn` tag stay exactly as they are.
3. `SessionRowInner`: `const itemRuntime = useThreadListItemRuntime()` → `const aui = useAui()`, and `itemRuntime.rename(next)` → `aui.threadListItem().rename(next)`.
4. `SessionRowResolver`: replace `useAssistantRuntime().threads` with `useAuiState((s) => s.threads.threadItems)`. The presence guard changes container shape — `!(item.id in threadItems)` becomes `!threadItems.some((t) => t.id === item.id)` — because the store scope's `threadItems` is an array, not a Record. Keep the guard: its comment explains that resolving a vanished id throws synchronously during an optimistic archive, and that hazard is unchanged.
5. Drop the `threadListRuntime?.` optional chain. Under the property form a scope accessor is always truthy, so an optional chain there reads as a safety check that can never fire; the `threadItems` array from the selector is the real guard.
6. Wrap `SessionRowInner` in `<SessionRowItemScope id={item.id}>` in place of `<ThreadListItemRuntimeProvider runtime={…}>`.
7. Update the file header comment: actions now come from the `threadListItem` scope on the aui client, not from an item runtime object. Keep the "keyed by the stable `item.id`, never `remoteId`" sentence — it is still load-bearing.

**Verify:** typecheck clean; `data-testid="sessions-row"`, `data-chat-id` and `sessions-row-title` are byte-identical to before; file under 300 lines.

---

### Task 6 — Migrate `use-archive-session.ts`

**Files:** `packages/ui/src/features/sessions/sidebar/use-archive-session.ts`, `packages/ui/src/features/sessions/sidebar/__tests__/use-archive-session.test.tsx`

1. `useThreadListItemRuntime()` → `useAui()`; `itemRuntime.archive()` → `aui.threadListItem().archive()`. The `useCallback` dependency becomes `aui`.
2. Preserve the ordering invariant exactly: worktree question resolved → `stageArchiveChoice` → `archive()`. The header comment explaining why (aui switches the active thread away optimistically) stays.
3. Test: replace the `useThreadListItemRuntime: () => ({ archive: archiveSpy })` mock with `useAui: () => ({ threadListItem: () => ({ archive: archiveSpy }) })`. Assertions do not change — this is a contract-preserving mock update, not a new test.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/use-archive-session.test.tsx` passes with the same test names and count as the baseline.

---

### Task 7 — Migrate `use-draft-row.ts` and the create-once harness

**Files:** `packages/ui/src/features/sessions/sidebar/use-draft-row.ts`, `packages/ui/src/features/sessions/sidebar/__tests__/use-draft-row.test.ts`, `packages/ui/src/features/sessions/runtime/__tests__/new-thread-create-once.test.tsx`

1. `use-draft-row.ts`: `useAssistantRuntime()` → `useAui()`; both `runtime.threads.switchToThread(...)` calls → `aui.threads().switchToThread(...)`. The existing `useAuiState` selectors for `newThreadId`/`mainThreadId` are already correct — leave them. Update the `runtime.threads.switchToNewThread()` mention in the long `wasSelectedRef` comment to the new spelling; the reasoning it describes is unchanged.
2. `use-draft-row.test.ts`: mock `useAui: () => ({ threads: () => ({ switchToThread: switchToThreadSpy }) })` in place of the `useAssistantRuntime` mock.
3. `new-thread-create-once.test.tsx`: the harness component captures `useAssistantRuntime()` into a ref to drive the thread list. Replace with `useAui()` and drive through `aui.threads()`. This test asserts the "chat created on first send only, no empty sessions" invariant — its assertions must not change.

**Verify:** each of the three test files passes individually, with unchanged test names and counts.

---

### Task 8 — Migrate `use-session-list-router.ts`

**Files:** `packages/ui/src/features/sessions/ws/use-session-list-router.ts`, `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`

1. `useAssistantRuntime()` → `useAui()`. Rewrite all five action sites: one `runtime.threads.reload()` inside `scheduleReload` and four `runtime.threads.switchToThread(...)` calls (lines ~157, ~170, ~181, ~213) to `aui.threads()`.
2. The existing `useAuiState` selectors for `mainThreadId` and `threadItems`, and the `useMemo` that projects outside the selector, are already correct — do not touch them. The comment explaining that a fresh array inside the selector would loop `Object.is` is still true and stays.
3. Effect dependency arrays that list `runtime` become `aui`. `useAui()` returns a client whose identity changes only on a structural change, so the "created once, disposed on unmount" property of the WS wiring effect is preserved — say so in a one-line comment on that effect's dependency array.
4. Update the header comment's `runtime.threads.reload()` references to `aui.threads().reload()`.
5. Test: replace the `useAssistantRuntime` mock with the equivalent `useAui` shape. All existing assertions — reload coalescing, unread clearing, cross-project filter clear, draft adoption, archived-active fallback, boot auto-open — must pass unchanged.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/ws/__tests__/use-session-list-router.test.tsx` passes with unchanged names and counts.

---

### Task 9 — Migrate `AppShell.tsx` and the new-chat hotkey handler

**Files:** `packages/ui/src/app/AppShell.tsx`, `packages/ui/src/features/sessions/new-thread/use-new-chat-hotkey-handler.ts`, `packages/ui/src/app/__tests__/App.integration.test.tsx`

1. `AppShell.tsx`: keep the `AssistantRuntimeProvider` import and the `useSessionsThreadList()` mount exactly as they are — the provider survives 0.15 unchanged and we pass neither `aui` nor `config`. Drop only the `useAssistantRuntime` import.
2. In `RuntimeBody`, `const runtime = useAssistantRuntime()` → `const aui = useAui()`; the navigator registration becomes `setSessionNavigator((chatId) => aui.threads().switchToThread(chatId))` with `aui` as the effect dependency. The teardown `setSessionNavigator(null)` stays.
3. `use-new-chat-hotkey-handler.ts`: change the parameter from `runtime: AssistantRuntime` to `aui: AssistantClient` (type imported from `@assistant-ui/react`), and rewrite the two calls to `aui.threads().getState().newThreadId` and `aui.threads().switchToNewThread()`. Update the `useNewChatHotkey(useNewChatHotkeyHandler(runtime))` call in `AppShell.tsx` accordingly. Keep the `resolveNewChatHotkeyAction` branch untouched — the picker-vs-direct decision is not part of this change.
4. Update `lib/session-nav.ts`'s header comment, which names `runtime.threads.switchToThread` as the real navigator, to the new spelling. No code change there.
5. Test: update the `useAssistantRuntime` mock in `App.integration.test.tsx` to the `useAui` shape.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/app/__tests__/App.integration.test.tsx` passes unchanged; typecheck clean.

---

### Task 10 — Migrate `use-first-run-tour.ts`

**Files:** `packages/ui/src/features/tour/use-first-run-tour.ts`

`useAssistantRuntime()` → `useAui()`, and swap the container-shaped projection:

```ts
const sessionCount = () => regularThreadItemsToSessionItems(aui.threads().getState().threadItems).length;
```

`threadListStateToSessionItems` walked the record's regular-only `threadIds` bucket; the array equivalent that excludes archived is the already-shipped `regularThreadItemsToSessionItems`. Using the unfiltered `threadItemsToSessionItems` here would count archived sessions and wrongly suppress the tour on a workspace whose only sessions are archived — do not use it. Effect dependency `runtime` → `aui`. The `SETTLE_MS` latch behaviour and the "never auto-open for a returning user" gate are unchanged.

**Verify:** typecheck clean; grep the file for `threadListStateToSessionItems` returns nothing.

---

### Task 11 — Migrate `SpotlightPalette.tsx` and `SessionTabs.tsx`

**Files:** `packages/ui/src/features/palette/SpotlightPalette.tsx`, `packages/ui/src/features/session-tabs/SessionTabs.tsx`, `packages/ui/src/features/palette/__tests__/SpotlightPalette.test.tsx`

Both already import `useAuiState` alongside `useAssistantRuntime`; drop the latter and add `useAui`. `runtime.threads.switchToThread(...)` → `aui.threads().switchToThread(...)` — one site in the palette, two in the tabs (including the `id !== mainThreadId` and `next !== mainThreadId` guards, which stay). Update the palette test's mock from `useAssistantRuntime: () => ({ threads: { switchToThread: mockSwitch } })` to `useAui: () => ({ threads: () => ({ switchToThread: mockSwitch }) })`.

**Verify:** the palette test passes unchanged; typecheck clean; every `data-testid` in both files is untouched.

---

### Task 12 — Migrate `ReviewPanel.tsx`

**Files:** `packages/ui/src/features/review/ReviewPanel.tsx`, `packages/ui/src/features/review/__tests__/ReviewPanel.test.tsx`

`runtime.threads.main.append({...})` → `aui.threads().thread('main').append({...})`. The legacy `threads.main` getter has no direct aui twin; `ThreadsMethods.thread('main')` is the documented selector and returns the same `ThreadMethods`. Do **not** substitute `aui.thread()` here — `ReviewPanel` is mounted at the app root, outside any thread scope, so `aui.thread` may be unavailable there and would throw on access. The appended message payload is unchanged. Update the test's mock to `useAui: () => ({ threads: () => ({ thread: () => ({ append: appendSpy }) }) })` and keep the existing append-capture assertions.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/review/__tests__/ReviewPanel.test.tsx` passes unchanged.

---

### Task 13 — Migrate `TagPopoverHost`, `ArchivedSessionsDialog`, `ImportSessionList`

**Files:** `packages/ui/src/features/sessions/TagPopoverHost.tsx`, `packages/ui/src/features/sessions/ArchivedSessionsDialog.tsx`, `packages/ui/src/features/sessions/ImportSessionList.tsx`

1. All three: `useAssistantRuntime()` → `useAui()`; every `runtime.threads.reload()` → `aui.threads().reload()` (one in `TagPopoverHost`'s async handler, one in its `onReload` prop, one each in the other two).
2. `ArchivedSessionsDialog` also changes container shape: `archivedThreadListStateToSessionItems(runtime.threads.getState())` → `archivedThreadItemsToSessionItems(aui.threads().getState().threadItems)`, importing the function added in task 3. Everything downstream of `all` — filtering, sorting, rendering — is unchanged.

**Verify:** typecheck clean; the archived dialog still lists archived sessions when exercised through its own test if one exists, otherwise through the task-27 E2E batch. Grep for `archivedThreadListStateToSessionItems` in these files returns nothing.

---

### Task 14 — Migrate the draft openers and widen the injected `runtimeThreads` type

**Files:** `packages/ui/src/features/sessions/use-open-draft.ts`, `packages/ui/src/features/sessions/new-thread/use-open-new-thread-draft.ts`, `packages/ui/src/features/sessions/new-thread/open-new-thread-draft.ts`

1. Both hooks already call `useAui()` for `setText`; drop their `useAssistantRuntime()` and pass `runtimeThreads: aui.threads()` instead of `runtime.threads`.
2. `open-new-thread-draft.ts` declares `runtimeThreads` structurally as `{ getState: () => { newThreadId: string | undefined; mainThreadId: string | null }; switchToNewThread: () => Promise<void> }`. The store scope does not satisfy it: `ThreadsState.newThreadId` is `string | null`, `mainThreadId` is `string`, and `ThreadsMethods.switchToNewThread()` returns `void`. Widen the injected type to `{ getState: () => { newThreadId: string | null | undefined; mainThreadId: string | null }; switchToNewThread: () => void | Promise<void> }`. The `await runtimeThreads.switchToNewThread()` inside the sequence is still correct — awaiting `void` is legal and preserves the yield the ordering relies on.
3. The `newThreadId == null` early return already covers both `null` and `undefined`. The `setReturnTarget(... ?? null)` already normalizes. No behaviour change; the order-sensitive sequence is untouched.
4. Update the module header's "supplies the runtime" phrasing to name the aui client.

**Verify:** typecheck clean; any existing test over `openNewThreadDraft` passes unchanged (its injected fakes still satisfy the widened type).

---

### Task 15 — Migrate `use-start-todo-session.ts` and `use-worktree-session.ts`

**Files:** `packages/ui/src/features/tasks/use-start-todo-session.ts`, `packages/ui/src/features/git/use-worktree-session.ts`, `packages/ui/src/features/tasks/__tests__/use-start-todo-session.test.ts`, `packages/ui/src/features/git/__tests__/BranchPopover.test.tsx`

1. Both hooks: drop `useAssistantRuntime()`; `use-start-todo-session.ts` already calls `useAui()` for `setText`, so reuse that client. `runtime.threads.reload()` → `aui.threads().reload()` and `runtime.threads.switchToThread(chatId)` → `aui.threads().switchToThread(chatId)` in both files. The reload-then-switch ordering is load-bearing (the new chat must be in the list before it can be selected) — keep it.
2. Tests: replace the `useAssistantRuntime: () => ({ threads: { reload, switchToThread } })` mocks with the `useAui: () => ({ threads: () => ({ reload, switchToThread }) })` shape. `BranchPopover.test.tsx` carries a comment naming `useWorktreeSession (use-worktree-session.ts) uses useAssistantRuntime` — update it to name `useAui`.

**Verify:** both test files pass individually with unchanged names and counts.

---

### Task 16 — Migrate `use-instruction-actions.ts`

**Files:** `packages/ui/src/features/chat/smart-actions/use-instruction-actions.ts`, `packages/ui/src/features/chat/smart-actions/__tests__/instruction-actions.test.ts`

1. `useAssistantRuntime()` → `useAui()`.
2. `runtime.thread.composer` → `aui.threads().thread('main').composer()` at both sites (`const composer = runtime.thread.composer` and `runtime.thread.composer.setText(insertText)`). Do **not** translate to `aui.composer()` here. The chips render inside a message part (`parts/markdown-text.tsx`, `parts/CodeHeader.tsx`), and `MessageByIndexProvider` rebinds the bare `composer` scope to *that message's edit composer* — so `aui.composer()` would make `append` write into an inert edit composer that never reaches the live composer, and would make `runInNewSession`'s final `setText` throw, because by then `switchToNewThread()` has left the message index unresolvable and the catch surfaces "Couldn't start a new session" over a draft that was created and never seeded. `aui.threads()` is a root scope no provider shadows, and `ThreadMethods.composer()` reaches the live main-thread composer — the same reasoning task 12 uses for `ReviewPanel`. After task 21 this reads `aui.threads.thread('main').composer()` — only the top-level `threads` accessor drops its parens; `.thread('main')` and `.composer()` keep theirs, because the property form exists only on `AssistantClient`'s top-level keys and `ThreadMethods.composer()` is call-only at `core@0.3.12`. A nested `.composer()` is also invisible to task 21's call-form grep, which is anchored on `aui.`.
3. `runtime.threads.getState().newThreadId` (twice) and `runtime.threads.switchToNewThread()` → `aui.threads()`. Keep the `await` on `switchToNewThread()` — the sequence depends on the yield before reading the fresh `newThreadId`.
4. The header comment must keep warning that at this call site the bare `composer` scope is the message's *edit* composer, because `MessageByIndexProvider` rebinds it. Reword only the second half: `aui.threads().thread('main').composer()` reaches the live main-thread composer regardless of that rebinding, where `runtime.thread` used to. Do not reword it into a claim that `aui.composer()` rebinds with the active thread — that is the bug this task exists to avoid.
5. Test: replace the `useAssistantRuntime` mock with `useAui: () => ({ threads: () => ({ thread: () => ({ composer: () => composerMock }), getState, switchToNewThread }) })`, where `composerMock` carries both `setText` and `getState` (the append path reads `.getState().text`). The mock must exercise the nested `threads().thread('main').composer()` path: a flat `composer` mock passes under either translation and would hide exactly the failure step 2 guards against.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/smart-actions/__tests__/instruction-actions.test.ts` passes unchanged.

---

### Task 17 — Delete the now-dead record-shaped projections

**Files:** `packages/ui/src/features/sessions/view-model/chat-to-thread-custom.ts`, `packages/ui/src/features/sessions/view-model/__tests__/thread-list-projection.test.ts`

Tasks 10 and 13 removed the last callers of the record-shaped API. Per the no-leftovers rule, delete in this pass:

1. `threadListStateToSessionItems`, `archivedThreadListStateToSessionItems`, and the `ThreadListRecordState` interface.
2. Trim the module header's two-container explanation to describe only the store-scope array shape, keeping the note that `threadItems` holds both regular and archived entries — that is why `regularThreadItemsToSessionItems` and `archivedThreadItemsToSessionItems` both exist.
3. In `thread-list-projection.test.ts`, delete the `makeState` helper and rewrite each record-shaped `describe` against the array converters, preserving the assertion for assertion: status mapping (`'archived'`, `'active'`, `'regular'`, an unknown status), `undefined` title staying `undefined`, order preservation, and the mixed draft-plus-real case returning only the real entry. The "skips ids absent from `threadItems`" case has no array analogue — an array cannot hold a dangling id — so drop it and note the deletion in the task report.

Before deleting, re-run the grep from the task-13 verify step across all of `packages/ui/src` to confirm zero remaining references.

**Verify:** `grep -rn "threadListStateToSessionItems\|archivedThreadListStateToSessionItems\|ThreadListRecordState" packages/ui/src` prints nothing; the projection test file passes; typecheck clean.

---

### Task 18 — Phase A gate

**Files:** none (no edits).

1. The legacy-hook grep from the Verification commands section prints nothing across `packages/ui/src`.
2. `pnpm --filter @qlan-ro/mainframe-ui typecheck` is clean.
3. `pnpm --filter @qlan-ro/mainframe-ui test` matches **baseline + 4**, with no new failures. Both deltas are deliberate: task 2 adds 5 cases, and task 17 deletes 1 — the record-shaped "skips ids absent from `threadItems`" case, which has no array analogue. Do not "fix" a count of baseline + 4 by restoring the deleted case. Re-run individually any file the batch reds to rule out the known `React.act` batch artifact.

If any check fails, fix it here rather than carrying it into the bump — a red suite at the bump makes fallout unattributable.

**Verify:** all three checks reported with their actual output.

---

### Task 19 — Bump the `@assistant-ui/*` set to 0.15

**Files:** `packages/ui/package.json`, `pnpm-lock.yaml`

1. Set exact versions, no caret and no tilde: `"@assistant-ui/react": "0.15.13"`, `"@assistant-ui/react-markdown": "0.14.10"` (this kills the existing `^0.14.6` caret — the last range in the family), `"@assistant-ui/store": "0.3.8"`.
2. `pnpm install`.
3. Confirm the resolved transitive family: `@assistant-ui/core@0.3.12`, `@assistant-ui/store@0.3.8`, `@assistant-ui/tap@0.9.11`. `react@0.15.13` declares `core: ^0.3.12`, `store: ^0.3.8`, `tap: ^0.9.11`; `react-markdown@0.14.10` peers `react: ^0.15.0`.
4. **Duplicate check (blocking):** grep `pnpm-lock.yaml` for `'@assistant-ui/store@`, `'@assistant-ui/core@` and `'@assistant-ui/tap@`. Each must appear at exactly one version. Two `store` trees split the React context that task 4's provider writes and `ThreadListItemPrimitive` reads, and every session row breaks silently — with no type error and, because the sidebar renders, possibly no test failure either. Run `pnpm dedupe` if needed; do not proceed while any of the three is duplicated.
5. Note in the task report the version of `@assistant-ui/store` that `packages/ui` now declares directly, so task 25's pin note can name the whole set.

**Verify:** `pnpm install --frozen-lockfile` succeeds; the three greps each return one version; `pnpm --filter @qlan-ro/mainframe-ui why @assistant-ui/store` shows one instance.

---

### Task 20 — Post-bump typecheck, suite, and fallout

**Files:** whatever the compiler names.

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck`. Expect it clean on the first run: the only removed exports were the 23 hooks, all already gone after phase A, and every other consumed typedef is byte-identical.
2. `pnpm --filter @qlan-ro/mainframe-ui test`, compared against the task-18 result.
3. Fix any fallout **at the runtime-wiring layer only**. Hard boundary, from the brief: `convertMessage` / project-messages test expectations must not be edited. If a genuine `ExternalStoreAdapter` or `ThreadMessageLike` change forces a projection-output change, stop and escalate rather than editing those expectations. (The diff says this cannot happen — both typedefs are byte-identical — so any such pressure means something else is wrong.)
4. Give the composer trigger tests specific attention: `features/chat/composer/triggers/` builds on `Unstable_TriggerPopoverRoot` and the `unstable_use{SlashCommand,Mention}Adapter` family. All those exports survive at 0.15.13, but they are unstable by contract. Any coupling that needs adjusting stays inside the small adapter modules — do not let it leak into the shared trigger-field engine.

**Verify:** typecheck clean; full suite at or above the task-18 result; the trigger tests and the session-list router test named explicitly in the report.

---

### Task 21 — Sweep call-form scope accessors to property form

**Files:** every file the call-form grep lists — the 13 pre-existing sites (`ComposerAttachmentStrip.tsx`, `use-append-quote-segment.ts`, `use-submit-composition.ts`, `ComposerTriggers.tsx`, `WelcomeState.tsx`, `use-open-new-thread-draft.ts`, `use-open-draft.ts`, `use-start-todo-session.ts` and their doc comments) plus every site tasks 5–16 wrote.

Rewrite `aui.<scope>()` → `aui.<scope>` throughout, including inside the doc comments that quote the old spelling (`use-submit-composition.ts`, `Composer.test.tsx`, `new-thread-create-once.test.tsx`). Test mocks written as `threads: () => ({...})` become plain objects `threads: {...}`.

Three rules while sweeping:

- Sweep **only** top-level `aui.<scope>` accessors, in source and in test mocks. Nested calls keep their parens: `aui.threads.thread('main').composer()`, `aui.threads.thread('main').append(…)`, `aui.threads.item({id})`. Flattening task 16's mock `composer: () => composerMock` into a plain object reds `instruction-actions.test.ts`, and flattening the call in source is a TS2339 — `ThreadMethods.composer()` has no property form at `core@0.3.12`. The call-form grep in this task's verify step catches neither mistake: it is anchored on `aui.`, so a nested `.composer()` never matches it.
- Do **not** introduce `if (aui.<scope>)` availability checks. The accessor is always truthy; an unavailable one has `source: null` and throws on any other property read. If a site genuinely needs a guard, use `aui.<scope>.source != null`, or select through `s.optional.<scope>` in a `useAuiState` selector. As of this plan no site in `packages/ui` needs one — verified by grep — so adding one is a signal to stop and re-check.
- Leave `__internal_getRuntime?.()` in `read-live-composer-state.ts` alone; it is a method call, not a scope accessor.

**Verify:** the call-form grep from the Verification commands section prints nothing; typecheck clean; full UI suite at the task-20 result.

---

### Task 22 — Move `SessionRowItemScope` onto the 0.15 provider form

**Files:** `packages/ui/src/features/sessions/SessionRowItemScope.tsx`

Only if task 4 took the primary branch. `AuiProvider value={…}` and the `useAui(clients)` overload are both `@deprecated` at `store@0.3.8`. Convert to the current form, mirroring `ThreadListItemByIndexProvider` at 0.15.13:

```tsx
const aui = useAui();
const config = AuiConfig({
  threadListItem: Derived({
    source: 'threads',
    query: { type: 'id', id },
    get: (client) => client.threads.item({ id }),
  }),
});
return <AuiProvider extends={aui} config={config}>{children}</AuiProvider>;
```

`AuiConfig` is exported from `@assistant-ui/react` at 0.15.13 (new in that line); `Derived` still comes from `@assistant-ui/store`. If task 4 took the `__internal_getRuntime` fallback, this task is a no-op — record that in the report.

**Verify:** typecheck clean with no deprecation-flagged usage remaining in the file; session rows still select, rename and archive under the task-27 E2E batch.

---

### Task 23 — Evaluate `threadListItem.isRunning`

**Files:** none unless adopted.

0.15 adds `ThreadListItemState.isRunning` — per-row run state including runs that continue after the user switches away. Compare it against our hand-rolled per-row run state (`features/sessions/view-model/session-status.ts` → `deriveSessionBadge`, fed by `SessionCustom` from the daemon).

Adopt **only** if it is a strict drop-in that preserves current behaviour for every badge state we render. Our state is daemon-derived and survives a reload; aui's docs are explicit that a thread list mounting only the open thread reads the others as *not running* rather than *unknown*. If that produces any user-visible difference, do not adopt — file a follow-up todo referencing #306 and leave ours in place. This must not become a feature change.

**Verify:** the report states adopt or defer with the concrete behavioural reason. If deferred, the follow-up todo number is in the report.

---

### Task 24 — Evaluate `threads.reloadMainThread()`

**Files:** none unless adopted.

0.15 adds `ThreadsMethods.reloadMainThread()` — an in-place remote re-seed. Compare it against the per-chat controller's refetch-on-gap re-seed (`features/chat/controller/`). Same rule as task 23: adopt only if drop-in with identical behaviour, otherwise file a follow-up todo and leave the controller alone. The controller's re-seed feeds the optimistic-send reconcile matcher, so any change to its timing or payload is a behaviour change, not an adoption.

**Verify:** the report states adopt or defer with the concrete reason; follow-up todo number if deferred.

---

### Task 25 — Update `packages/ui/CLAUDE.md`

**Files:** `packages/ui/CLAUDE.md`

1. Delete the "Deprecated assistant-ui hooks still in use" bullet from *Known gaps / phantom deps* (line ~76). It is resolved.
2. Rewrite the pin bullet under *Conventions* (line ~71): name the new set — `react@0.15.13` / `store@0.3.8` / `core@0.3.12` / `tap@0.9.11` / `react-markdown@0.14.10`, all exact — and keep the whole-set-pinned-together rule and the `react-markdown` lockstep rule. Per the PM's decision, record the "never 0.14.19/0.14.20" React-Compiler ban as **historical**, superseded by the 0.15 line, rather than carrying it as a live criterion.
3. Update the verification stamp at line ~35 to name `react@0.15.13` / `core@0.3.12` and today's date, keeping the earlier stamps.
4. Fix the two stale mentions of the old API: the sessions bullet's `useAssistantRuntime().threads` and the composer bullet's "**Never `useComposer()`** — `useAuiState` + `useAui().composer()`", which becomes `useAuiState` + `useAui().composer`. The `useComposer` warning itself stays — the getSnapshot loop it describes is why the hook is gone.
5. Leave the `Unstable_` warning in the composer bullet, updating only the version it names.

**Verify:** the file has no remaining reference to `useAssistantRuntime`, `useThreadListItemRuntime`, `0.14.27` as a live pin, or the call form `useAui().composer()`.

---

### Task 26 — Changeset

**Files:** new `.changeset/<name>.md`

Run `pnpm changeset`, select `@qlan-ro/mainframe-ui`, bump **patch** — the release group is lockstepped via changesets `fixed`, and this is an internal dependency migration with no user-facing behaviour change. Body: one sentence naming the 0.15 bump and the legacy-hook removal, no bullet list.

**Verify:** the changeset file exists and names `@qlan-ro/mainframe-ui`; `git status` shows it staged for the PR.

---

### Task 27 — Final verification

**Files:** none (no edits).

Run and report every one:

1. Legacy-hook grep across `packages/ui/src` — zero hits.
2. Call-form grep across `packages/ui/src` — zero hits.
3. `grep -n "assistant-ui" packages/ui/package.json` — every entry an exact version, no `^` and no `~`.
4. Lockfile family check — one version each of `@assistant-ui/react`, `store`, `core`, `tap`, `react-markdown`.
5. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean.
6. `pnpm --filter @qlan-ro/mainframe-ui test` — full suite green, including the composer trigger tests, the session-list router test, and the `convertMessage` / project-messages tests with **unedited** expectations.
7. `pnpm test:e2e` — a **full** batch from the repo root. Mandatory, not a subset: this change touches the runtime layer. Per the batch-e2e-at-the-end convention this is the one E2E run of the series. Compare against the known-red set (`docs`/memory: the transcript pair is CI-only red); a failure outside that set blocks.
8. Manual read-through of the diff for leftovers: no `@ts-ignore`, no dead imports, no stale comment naming a removed hook, no file over 300 lines, no function over 50, no moved or renamed `data-testid`.

**Verify:** every item above reported with its actual result. Any red that is not in the pre-existing known-red set blocks the PR.

---

## Risks

- **Duplicate `@assistant-ui/store` in the lockfile** — the one failure mode that is silent. It splits the React context between task 4's provider and `ThreadListItemPrimitive`, breaking every session row with no type error. Gated in tasks 4 and 19 and re-checked in task 27.
- **`SessionRowResolver`'s container-shape change** — the Record-membership guard becomes an array scan. It fires during an optimistic archive; get it wrong and the row throws mid-archive instead of unmounting. Covered by the E2E archive flow, not by a unit test.
- **Batch-vs-single test discrepancy** — the UI suite's known cross-file `React.act` failures can masquerade as bump fallout. Task 1's baseline exists precisely to tell them apart; always re-run a red file alone before reporting it.
- **Unstable trigger APIs** — the `/`-skills and `@`-files pickers ride `Unstable_TriggerPopoverRoot`. All the exports survive at 0.15.13, but the shapes behind them carry no compatibility promise. Task 20 confines any adjustment to the adapter modules.
