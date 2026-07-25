# Implementation plan: thread context menus — path copy (#274) + selection actions & multi-quote (#280)

**Spec:** `docs/specs/2026-07-25-todo-274-thread-context-menus.md` (rev 2, committed `cf3edc30`). Its `## Decisions` are settled; this plan implements them and does not reopen them.
**Branch / worktree:** `todo/274-thread-context-menus` in `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-274-thread-context-menus`. All work happens there.
**Ships as:** one PR. Package touched: `@qlan-ro/mainframe-ui` (plus `packages/e2e` selectors and one changeset). No daemon, no types package, no Rust.

## Goal

Give the chat thread two context-sensitive affordances that share one substrate. #274 adds a single right-click context menu per top-level assistant message that resolves the file path under the cursor from `[data-file-path]` and offers `Copy Absolute Path` / `Copy Relative Path`, both derived from the shipped `toFileRef` normalizer and the same `useActiveBasesStore` bases that left-click open uses, so copy and open can never disagree. #280 adds a second action (`New session`) to the existing floating selection toolbar and replaces assistant-ui's single overwriting quote slot with a segmented composer (Variant F): each Quote appends a quote pill plus its own comment box, the live box stays the native `ComposerPrimitive.Input`, and the whole composition is serialized to one markdown string at the `thread().append()` call site — which lets `parseSendInput` lose its quote branch entirely and lets quote-only sends work for the first time. The two features ship together because they are one interaction model over the same thread surface, and because #280's producer migration deletes the code #274's menu would otherwise have to coexist with.

---

## Preconditions (not tasks)

1. **This worktree has no `node_modules`.** `pnpm --filter … exec vitest` and `typecheck` both fail with `Command "vitest" not found` until dependencies are installed. Per the dispatch, `pnpm install` is deliberately not a task — the orchestrator/user installs once before T1. Every verification command below assumes it has happened.
2. `zustand` is a phantom dep in `packages/ui` (imported, not declared). Unchanged by this work; do not "fix" it here.

## Reference material

| What | Where |
|---|---|
| Contract | `docs/specs/2026-07-25-todo-274-thread-context-menus.md` |
| Prototype (reference implementation, not on this branch) | `git show 910bafe7:packages/ui/src/prototypes/thread-context-menu/VariantF.tsx` (composer), `…/unified-shell.tsx` (whole interaction), `…/VariantE.tsx` (named fallback) |
| Existing Copied→delayed-close mechanism to extract | `packages/ui/src/features/chat/parts/markdown-text.tsx:110-153` |
| Existing new-thread draft sequence to extract | `packages/ui/src/features/sessions/sidebar/SessionsNewButton.tsx:58-107` |
| jsdom context-menu test precedent | `packages/ui/src/features/chat/parts/__tests__/markdown-text.test.tsx:278-333` (`fireEvent.contextMenu`, fake timers) |

## Conventions every task inherits

- **Verification.** Per-task: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (single file — batched multi-suite runs hit spurious cross-file `React.act` failures) and `pnpm --filter @qlan-ro/mainframe-ui typecheck`. `packages/ui` has no `lint` script; do not invent one.
- **vitest environment routing** (`packages/ui/vitest.config.ts`): `*.test.ts` → node, `*.test.tsx` → jsdom. Pure logic gets `.test.ts`; anything rendering gets `.test.tsx`.
- **TDD.** Test tasks precede their implementation task and must be run and seen failing first. Where a change is a single attribute or a single deletion, the test assertion is folded into the implementation task with an explicit "write the assertion first, watch it fail" instruction — those are called out per task.
- **Tailwind v4** in `packages/ui`: `/opacity` modifiers are fine here (the `packages/desktop` v3 trap does not apply). Only `mf-*` tokens that actually exist in `packages/ui/src/styles/globals.css` — a `mf-*` class that is not in that file renders silently unstyled.
- **`data-testid` on every interactive element**, `<surface>-<element>` kebab-case, keyed by domain id and never by array index. Repeating per-segment elements additionally carry `data-segment-id`.
- **≤300 lines/file, ≤50 lines/function.** `markdown-text.tsx` is already at 286 lines — T4 must leave it smaller than it found it. Decompose into sibling files rather than growing `AssistantMessage.tsx` or `Composer.tsx`.
- No `@ts-ignore` (`@ts-expect-error` + reason only); comments explain *why*; no dead code and no deferred cleanups.
- Do not touch `@assistant-ui/*` versions. Everything here is composition against the exact pin `react@0.14.27` / `core@0.2.21`.

## Data model (planner call — the spec describes behavior, not shape)

The spec's `s0..sN` maps onto two pieces, so that the live segment's prose has exactly one home (the native composer) and never needs mirroring:

```ts
// features/chat/composer/segments/segment-model.ts
export interface Segment { id: string; quote: string | null; text: string }
export interface Composition { committed: Segment[]; liveQuote: { id: string; text: string } | null }
```

- `committed` = `s0..s(N-1)`, each with its own quote and its own prose (a plain `<textarea>` in the DOM).
- The live segment `sN` = `liveQuote` (may be `null`) + the **native composer's text**, read at render/submit time. It is never stored.
- `committed: [], liveQuote: null` is today's composer, byte-identical.
- **Append (commit-and-clear, spec §2.2):** if `liveQuote != null || liveText.trim() !== ''`, push `{ id: liveQuote?.id ?? mint(), quote: liveQuote?.text ?? null, text: liveText }` onto `committed`; then `liveQuote = { id: mint(), text: newQuote }`; the caller clears the native input. A blank quoteless live segment commits nothing (spec serialization rule 2).
- **Dismiss(id):** `id === liveQuote.id` → `liveQuote = null`, native draft untouched. Otherwise the committed segment is removed when its `text.trim()` is empty, else keeps its prose with `quote: null`.
- Ids are opaque and minted once (`mint()`), never reassigned when a segment above is removed.

---

## Phase A — shared substrate (front-loaded)

Everything in Phase B and C depends on some part of this phase. A1→A2, A3→A4, A6→A7, A8→A9, A11→A12 are strict pairs; the five pairs plus A5 and A10 touch disjoint files and can run **in parallel**.

### T1 — Tests: `toFileRef` relative→absolute join *(test-writer)*

**Files:** `packages/ui/src/lib/files/__tests__/file-ref.test.ts` (extend; 167 lines today).

Add hardcoded vectors for the one new case (spec §Path derivation, 274-A11):
- `toFileRef('src/a.ts', { worktreePath: '/w', projectPath: '/p' })` → `{ relative: 'src/a.ts', absolute: '/w/src/a.ts', isExternal: false }` (worktree wins).
- Same input with `{ projectPath: '/p' }` only → `absolute: '/p/src/a.ts'`.
- Same input with `{}` → `absolute` stays `undefined`.
- `'./src/a.ts'` → `relative: 'src/a.ts'`, `absolute: '/w/src/a.ts'` (the `./` strip happens before the join).
- Trailing-slash base `{ worktreePath: '/w/' }` → `'/w/src/a.ts'`, no doubled slash.
- Agreement vector: for one raw path + bases, the string the relative menu item copies (`ref.relative`) equals the `relative` the open-file intent keys on — i.e. one `toFileRef` call, two assertions, pinning that copy and open cannot diverge.
- Regression: the existing absolute / `file://` / external vectors keep their current expectations unchanged.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/files/__tests__/file-ref.test.ts` — the four join vectors (worktree, project-only, `./` strip, trailing slash) fail; the no-base vector and the agreement vector pass already and are there to pin existing behavior, not to drive the change.

### T2 — Implement the join *(ui-dev)* — depends on T1

**Files:** `packages/ui/src/lib/files/file-ref.ts`.

In the already-relative branch (lines 77-81), after stripping `./`, join against the first defined of `bases.worktreePath`, `bases.projectPath` — same precedence array the absolute branch uses; normalize the base's trailing slash. With neither base defined, return today's shape (no `absolute`). Update the `absolute?` doc comment on `FileRef` (lines 31-37), which currently states the opposite. No new module, no second containment implementation.

**Verify:** the T1 file green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### T3 — Tests: shared menu copy-feedback hook *(test-writer)*

**Files:** `packages/ui/src/lib/ui/__tests__/use-menu-copy-feedback.test.tsx` (new; `.tsx` for jsdom).

Test the hook (`useMenuCopyFeedback(delayMs?)` → `{ copiedId, handleOpenChange, onCopySelect(id, run) }`) through a tiny harness component with two items:
- `onCopySelect('a', run)` calls `event.preventDefault()`, invokes `run`, sets `copiedId === 'a'` — and item `b` stays uncopied.
- After `vi.advanceTimersByTime(900)` a bubbling `keydown` with `key === 'Escape'` has been dispatched on `document` exactly once (spy on `document.dispatchEvent`).
- `handleOpenChange(false)` clears `copiedId` and cancels the pending timer (no Escape afterwards).
- Unmount before the delay cancels the timer.
Use fake timers wrapped in `act`, as `markdown-text.test.tsx:278-333` does.

**Verify:** `… exec vitest run src/lib/ui/__tests__/use-menu-copy-feedback.test.tsx` — fails (module missing).

### T4 — Extract the hook and adopt it in the link menu *(ui-dev)* — depends on T3

**Files:** `packages/ui/src/lib/ui/use-menu-copy-feedback.ts` (new), `packages/ui/src/features/chat/parts/markdown-text.tsx`.

Move the `menuCopied` / `closeTimeoutRef` / `closeMenu` / `handleMenuOpenChange` / `handleMenuCopy` mechanism out of `LinkWithPreview` (lines 110-153) into the hook; keep the "why" comments (uncontrolled Radix root, Escape is the only dismiss signal) with the code, not duplicated at the call site. `LinkWithPreview` then reads `copiedId === 'copy-link'`. Nothing about the link menu's rendered output, testids, or timing changes. Net line count of `markdown-text.tsx` must go **down** (it is at 286/300).

**Verify:** `… exec vitest run src/lib/ui/__tests__/use-menu-copy-feedback.test.tsx` and `… exec vitest run src/features/chat/parts/__tests__/markdown-text.test.tsx` both green; `typecheck`.

### T5 — Nested-transcript context *(ui-dev)*

**Files:** `packages/ui/src/features/chat/messages/nested-transcript-context.tsx` (new), `packages/ui/src/features/chat/tools/cards/TaskCard.tsx`.

Create a context defaulting to `false` with `NestedTranscriptProvider` and `useIsNestedTranscript()`. Mount the provider (`value={true}`) in `TaskCard`'s `SubagentTranscript`, wrapping `ReadonlyThreadProvider` / `ThreadPrimitive.Messages`. No consumer yet — this task is a no-op at runtime, which is the point: it lands before T9 so the nesting rule is available the moment the wrapper exists. Do not add a second `components` map (spec Decision 19); `bounded-messages.tsx` stays the single canonical map.

**Verify:** `typecheck`; `… exec vitest run src/features/chat/tools/cards/__tests__/TaskCard.test.tsx` (the file that actually renders the provider — `ChatThread.test.tsx` mocks `bounded-messages` and cannot exercise it) and `… exec vitest run src/features/chat/thread/__tests__/ChatThread.test.tsx`, both still green (no render change).

### T6 — Tests: segment transitions *(test-writer)*

**Files:** `packages/ui/src/features/chat/composer/segments/__tests__/segment-model.test.ts` (new, node env).

Pure vectors against the model above (280-A10):
- append onto an empty composition with blank live text → `committed: []`, one `liveQuote`.
- append with live text `'intro'` → `committed: [{ quote: null, text: 'intro' }]`, new `liveQuote`; the live text is **moved**, so the caller is expected to clear it (assert the function returns/needs no copy of it).
- second append → the previous live quote and the prose typed under it become one committed segment, in that order.
- dismiss the live quote → `liveQuote: null`, `committed` untouched.
- dismiss a committed segment with prose → segment stays, `quote: null`, prose intact, order unchanged.
- dismiss a committed segment whose prose is `'   '` → segment removed.
- ids: minting is unique and stable; removing a segment does not renumber the others.

**Verify:** `… exec vitest run src/features/chat/composer/segments/__tests__/segment-model.test.ts` — fails.

### T7 — Implement the segment model *(ui-dev)* — depends on T6

**Files:** `packages/ui/src/features/chat/composer/segments/segment-model.ts` (new).

Pure functions only — no React, no zustand, no aui import: `appendQuote(composition, { quote, liveText })`, `dismissQuote(composition, id)`, `mintSegmentId()`. Export the `Segment` / `Composition` types from here (client-only shape; it is not a daemon contract, so it does **not** go in `@qlan-ro/mainframe-types`).

**Verify:** T6 file green; `typecheck`.

### T8 — Tests: serializer *(test-writer)*

**Files:** `packages/ui/src/features/chat/composer/segments/__tests__/serialize-composition.test.ts` (new, node env).

`serializeComposition(committed, live)` where `live = { quote, text }`. Hardcoded expected strings, never recomputed from the input (280-A6):
1. The spec's worked example (`quote A`/`first`, `quote B\nline two`/`second`, empty live box) → the exact block in spec §2.3.
2. Single quote + comment → `'> q\n\nbody'`, byte-equal to today's output. **Migrate these vectors verbatim from `packages/ui/src/features/chat/controller/__tests__/parse-send-input-quote.test.ts`** with their expectations unchanged.
3. Quote with empty comment → `'> q'`.
4. Dismissed-quote prose → the paragraph alone, no `>` prefix.
5. Multiline quote → `> ` on every line.
6. Quote-only send, live box empty → non-empty result (this is the case that cannot send today).
7. Text typed in the live box before a quote is appended → `'intro\n\n> Q'`, never `'> Q\n\nintro'`.
8. Everything empty → `''`.
Join with `\n\n`, trim the result; quoteless-and-empty segments render nothing.

**Verify:** `… exec vitest run src/features/chat/composer/segments/__tests__/serialize-composition.test.ts` — fails.

### T9 — Implement the serializer *(ui-dev)* — depends on T8

**Files:** `packages/ui/src/features/chat/composer/segments/serialize-composition.ts` (new).

Pure, no imports beyond the model types. ≤50 lines.

**Verify:** T8 file green; `typecheck`.

### T10 — Segment store, per thread *(ui-dev, test-first within the task)* — depends on T7

**Files:** `packages/ui/src/features/chat/composer/segments/segment-store.ts` (new), `packages/ui/src/features/chat/composer/segments/__tests__/segment-store.test.ts` (new, node env), `packages/ui/src/features/daemon/reset-daemon-scoped-stores.ts`, `packages/ui/src/features/daemon/__tests__/reset-daemon-scoped-stores.test.ts`.

Zustand store `useComposerSegments` with `byThread: Record<string, Composition>`, keyed by the aui thread item id (`threadListItem.id` — the same key the controller uses; it stays `__LOCALID_*` for life, so the key is stable across a draft's first send). Actions delegate to the T7 pure functions: `append(threadId, {quote, liveText})`, `dismiss(threadId, segmentId)`, `clear(threadId)`, plus a `select(threadId)` helper returning the empty composition for unknown threads. In-memory only — no `persist`, no `daemonScopedKey`. Register a `byThread: {}` reset in `reset-daemon-scoped-stores.ts` alongside the other stores (spec is silent here; see Open questions #3), and extend the existing `packages/ui/src/features/daemon/__tests__/reset-daemon-scoped-stores.test.ts` with a case asserting a seeded segment composition is gone after the reset — the registration must not land unasserted.

Write the store test first: per-thread isolation (thread A's append does not touch B), `clear` empties only its own thread, a composition survives a read-switch-read cycle (280-A7 store half), unknown thread reads return the empty composition without writing.

**Verify:** `… exec vitest run src/features/chat/composer/segments/__tests__/segment-store.test.ts`; `… exec vitest run src/features/daemon/__tests__/reset-daemon-scoped-stores.test.ts`; `typecheck`.

### T11 — Tests: `openNewThreadDraft` *(test-writer)*

**Files:** `packages/ui/src/features/sessions/new-thread/__tests__/open-new-thread-draft.test.ts` (new, node env).

The sequence is order-sensitive and about to gain a second call site, so it is tested as a pure dependency-injected module with fakes for `runtime.threads`, `initializeDraft`, `resetNewThreadDraft`, `setText`, `setFilterProjectId`, `mfToast`. Mirror the seven behaviors `SessionsNewButton.test.tsx` already pins, plus the new ones:
- the project filter is cleared **only** when it is non-null and differs from the target project;
- `rememberReturn` snapshots `mainThreadId` **before** the switch;
- `resetNewThreadDraft` runs on the pre-switch slot id;
- `newThreadId` is re-read **after** `await switchToNewThread()` — a fake that returns `undefined` before the switch and an id after must still produce the right `initializeDraft` call;
- `newThreadId == null` after the switch → no `initializeDraft`, no `setText`;
- `initializeDraft` rejecting surfaces `mfToast.error('Couldn’t initialize session', …)` and **does not** call `setText`;
- with `prefill` given, `setText` is called exactly once, after `initializeDraft` resolves, with the raw string (no `> ` markers);
- with `prefill` omitted (the sidebar picker path), `setText` is never called.

**Verify:** `… exec vitest run src/features/sessions/new-thread/__tests__/open-new-thread-draft.test.ts` — fails.

### T12 — Extract `openNewThreadDraft` and move the sidebar onto it *(ui-dev)* — depends on T11

**Files:** `packages/ui/src/features/sessions/new-thread/open-new-thread-draft.ts` (new), `packages/ui/src/features/sessions/new-thread/use-open-new-thread-draft.ts` (new), `packages/ui/src/features/sessions/sidebar/SessionsNewButton.tsx`.

`open-new-thread-draft.ts` holds the pure sequence with every dependency injected (spec §2.4 steps 1-5). `use-open-new-thread-draft.ts` is the thin hook that binds `useAssistantRuntime()`, `useAui()`, `useDaemonPort()`, `useSettingsStore`, `useAdapters`, `useSessionFilters` and returns `openNewThreadDraft({ projectId, prefill? })`. `SessionsNewButton`'s `pick()` becomes a call into it; its observable behavior does not change, and the `filterProjectId != null` branch (native `ThreadListPrimitive.New`) is left exactly as it is.

Hazard to encode in the module, not the caller: the second call site (T16) lives inside `ChatThread` and can unmount mid-`await`, so the module must close over everything it needs and must not read component state after an await.

**Verify:** T11 file green; `… exec vitest run src/features/sessions/sidebar/__tests__/SessionsNewButton.test.tsx` green **unchanged** (if a mock path must move, that is the only permitted edit); `typecheck`.

---

## Phase B — #274 path context menu

T13 is independent. T14→T15→T16 is a chain. T17 is independent of T14-T16 but touches `markdown-text.tsx`, so it must not run concurrently with T4.

### T13 — `data-file-path` on the path pill *(ui-dev, assertion first)*

**Files:** `packages/ui/src/features/chat/tools/shared/chrome.tsx`, `packages/ui/src/features/chat/tools/shared/__tests__/chrome.test.tsx`.

Write the assertion first and watch it fail: the `tool-card-file-path` span exposes `data-file-path` equal to the **same** `filePath` string passed to `openFile()` — not a derived, shortened, or normalized variant (`shortFilename()` output stays the visible label only). Then add the attribute. `role="button"`, `tabIndex`, `onClick`, `onKeyDown`, tooltip and classes are untouched (274-A6).

**Verify:** `… exec vitest run src/features/chat/tools/shared/__tests__/chrome.test.tsx`; `typecheck`.

### T14 — Tests: the message path menu *(test-writer)* — depends on T2, T4

**Files:** `packages/ui/src/features/chat/messages/__tests__/MessagePathContextMenu.test.tsx` (new).

Render the component directly around a fixture containing a `[data-file-path]` element and plain text. Mock `useActiveBasesStore` bases and `navigator.clipboard.writeText`; stub `window.getSelection`. Use `fireEvent.contextMenu` (not `userEvent`) per the shipped precedent. Assert (274-A1…A5, A9, A10):
- right-click on the pill with an empty selection → exactly two enabled items, `tool-card-path-copy-absolute` (`Copy Absolute Path`) and `tool-card-path-copy-relative` (`Copy Relative Path`), in that order;
- right-click on a child node *inside* the pill resolves the same path (`closest`, not `target`);
- selecting the absolute item writes the absolute string; the relative item writes the base-relative string — with hardcoded expectations, and one degraded case (path outside every base) where both write the same stored string;
- after select: `Check` + `Copied` on the clicked item only, `text-mf-success`, and an `Escape` keydown dispatched ~900ms later (fake timers); reopening shows the normal labels;
- non-empty `window.getSelection()` → only the disabled `chat-menu-empty` item, no copy items;
- right-click on non-pill content → only `chat-menu-empty`;
- the trigger element carries `data-testid="chat-message-menu-trigger"` and the classes `flex flex-col gap-2` (274-A9 pin).

**Verify:** `… exec vitest run src/features/chat/messages/__tests__/MessagePathContextMenu.test.tsx` — fails.

### T15 — Implement `MessagePathContextMenu` *(ui-dev)* — depends on T14

**Files:** `packages/ui/src/features/chat/messages/MessagePathContextMenu.tsx` (new).

A component taking `children` and rendering `ContextMenu` (shadcn, `components/ui/context-menu.tsx`) → `ContextMenuTrigger asChild` → `<div data-testid="chat-message-menu-trigger" className="flex flex-col gap-2">{children}</div>` → `ContextMenuContent`. On `onContextMenu`, resolve `const el = (e.target as HTMLElement).closest('[data-file-path]')` and set state with the settled arbitration `setPath(hasSelection ? null : (el?.dataset.filePath ?? null))`, `hasSelection = Boolean(window.getSelection()?.toString().trim())`. Derive both strings with `toFileRef(path, bases)` where `const bases = useActiveBasesStore((s) => s.bases)` — the hook, never `useActiveBasesStore.getState()`; `getState()` reach-through is forbidden from React features. Relative item copies `ref.relative`; absolute copies `ref.absolute ?? ref.relative`. Clipboard through `writeToClipboard` (`lib/editor/copy-reference.ts`). Copied feedback through `useMenuCopyFeedback` from T4. `Copy` lucide icon on both items; `Check` in `text-mf-success` when copied. `path == null` → one disabled item, `No actions available`, testid `chat-menu-empty`.

The wrapper re-declares `flex flex-col gap-2` because `GroupedParts` is a Fragment and the trigger would otherwise collapse N flex children into one — keep that as the file's one *why* comment.

**Verify:** T14 file green; `typecheck`.

### T16 — Mount the menu in `AssistantMessage` *(ui-dev)* — depends on T5, T15

**Files:** `packages/ui/src/features/chat/messages/AssistantMessage.tsx`, `packages/ui/src/features/chat/messages/__tests__/AssistantMessage.test.tsx` (new — `messages/__tests__/` has no AssistantMessage or bounded-messages test today, so this is the file that pins the mount rule).

Wrap **only** the `MessagePrimitive.GroupedParts` block of the normal branch, and only when `useIsNestedTranscript()` is `false`. The action-bar/timing row stays outside the wrapper (its right-click keeps the native WebView menu). The error branch is untouched. `MessagePrimitive.Root` keeps `group/message flex flex-col gap-2 py-3` verbatim.

Assertions (274-A7), in the new test file, written first: rendered with no provider, an assistant message renders exactly one `chat-message-menu-trigger`; rendered under `NestedTranscriptProvider value={true}`, it renders **none** and no menu content, and its markup is otherwise identical to today; the error branch renders no wrapper in either case.

**Verify:** `… exec vitest run src/features/chat/messages/__tests__/AssistantMessage.test.tsx`; `… exec vitest run src/features/chat/thread/__tests__/ChatThread.test.tsx`; `typecheck`.

### T17 — Link menu wins innermost *(ui-dev, assertion first)* — depends on T4 (same file; must be sequential)

**Files:** `packages/ui/src/features/chat/parts/markdown-text.tsx`, `packages/ui/src/features/chat/parts/__tests__/markdown-text.test.tsx`.

Assertion first (274-A8): right-clicking a markdown link inside a message wrapped in `MessagePathContextMenu` opens exactly one menu — `chat-link-copy` / `chat-link-open` present, `tool-card-path-copy-absolute` and `chat-menu-empty` absent. Then add `onContextMenu={(e) => e.stopPropagation()}` on the `<a>` inside `ContextMenuTrigger asChild`, **declared after** the `{...props}` spread so the spread cannot overwrite it. It calls `stopPropagation()` **only** — never `preventDefault()`, because Radix composes the trigger's own handler with `checkForDefaultPrevented` and would skip opening the link menu. That constraint is the file's one *why* comment here.

**Verify:** `… exec vitest run src/features/chat/parts/__tests__/markdown-text.test.tsx`; `typecheck`.

### T18 — E2E: path menu *(test-writer)* — depends on T13, T15, T16

**Files:** `packages/e2e/tests-tauri/tool-cards.spec.ts` (existing `tool-card-file-path` coverage at :140/:174/:190 is the natural home).

Add a describe covering 274-A1, A2, A3, A5, A10 with the shipped idiom: `await locator.click({ button: 'right' })` → assert the menu testid with `{ timeout: 5_000 }` → act → `page.keyboard.press('Escape')`. Grant clipboard permissions via `page.context().grantPermissions(['clipboard-read', 'clipboard-write'])` and read back with `navigator.clipboard.readText()`. 274-A4 (selection arbitration) and A7/A9/A11 stay in jsdom/unit per the spec's verification-layers table — do not attempt them here.

**Verify:** `pnpm test:e2e --grep "tool-card"` (or the suite's documented single-spec invocation) green.

---

## Phase C — #280 selection toolbar + multi-quote

Strictly sequential in file terms: T19→T20→T21 (toolbar), T22→T23 (segments UI), T24→T25 (submit), T26 (editor producer), T27 (sweep). T19 and T22 can be drafted in parallel with Phase B, but T21 and T23 both edit `Composer.tsx`/`ChatThread.tsx` and must land in order.

### T19 — Presentational toolbar action *(ui-dev)*

**Files:** `packages/ui/src/components/ui/assistant-ui/quote.tsx`.

Add a generic `SelectionToolbar.Action` (icon + label + `data-testid` prop + `onMouseDown` preventDefault, same classes as today's Quote child) alongside the existing pieces. `SelectionToolbarPrimitive.Root` and its `chat-selection-toolbar` testid, placement and portal are kept exactly (spec §2.1). Do **not** delete `SelectionToolbarQuote` / `ComposerQuotePreview` / `QuoteBlock` yet — they still have consumers until T27. This file stays presentational: no store, no `useAui`, no daemon calls (`ui/` primitives stay passthrough).

**Verify:** `typecheck`; `… exec vitest run src/features/chat/thread/__tests__/ChatThread.test.tsx` green.

### T20 — Tests: wired selection toolbar *(test-writer)* — depends on T10, T12, T19

**Files:** `packages/ui/src/features/chat/thread/__tests__/ChatSelectionToolbar.test.tsx` (new).

Stub `window.getSelection` to return a non-empty selection; mock the segment store and `use-open-new-thread-draft`. Assert (280-A1, A2, A8):
- exactly two actions in order — `chat-selection-quote` (`Quote`) then `chat-selection-new-session` (`New session`);
- both buttons `preventDefault()` on `mousedown` (assert `defaultPrevented` on a dispatched mousedown), so the click does not clear the selection first;
- Quote appends the selected text to the segment store for the active thread and clears the DOM selection afterwards;
- New session calls `openNewThreadDraft` with `projectId` taken from the **source chat's** `chatConfig.projectId` and `prefill` equal to the raw selection (no `> ` markers), and does **not** append a segment;
- with no resolvable source project, New session is a no-op and logs a tagged `console.warn` (no toast, no navigation).

280-A2's second half ("the toolbar is gone" after the action) is **not** assertable here: dismissal is `SelectionToolbarPrimitive.Root`'s own reaction to a real selection change, and this test stubs `window.getSelection`. Assert the part we own — the selection is cleared — and record the gap in the coverage table rather than claiming A2 is fully covered.

**Verify:** `… exec vitest run src/features/chat/thread/__tests__/ChatSelectionToolbar.test.tsx` — fails.

### T21 — Implement the wired toolbar *(ui-dev)* — depends on T20

**Files:** `packages/ui/src/features/chat/thread/ChatSelectionToolbar.tsx` (new), `packages/ui/src/features/chat/composer/segments/use-append-quote-segment.ts` (new), `packages/ui/src/features/chat/thread/ChatThread.tsx`, `packages/ui/src/features/chat/thread/__tests__/ChatThread.test.tsx`, `packages/ui/src/features/chat/thread/__tests__/ChatThread-compacting.test.tsx`.

`ChatSelectionToolbar` composes `SelectionToolbar.Root` + two `SelectionToolbar.Action`s. Both read `window.getSelection()` themselves at click time (`useSelectionToolbarInfo` is not exported from the package root), then clear the selection.

`useAppendQuoteSegment()` is the single append seam both producers use (this one and T26): read the active thread id (`useAuiState((s) => s.threadListItem?.id)`), read the live text off the composer, call `segmentStore.append(threadId, { quote, liveText })`, then `aui.composer().setText('')`. Note the stale-read trap in the same-tick case: prefer `composer.__internal_getRuntime?.().getState().text` when a `setText` may have already run this tick (precedent: `ComposerTriggers.tsx:169-177`).

`New session` reads `useChatExtras()?.state.chatConfig?.projectId` (never ambient sidebar state) and calls `openNewThreadDraft({ projectId, prefill: selection })` from T12. `chatConfig` is null on a `__LOCALID_*` draft, so the draft-aware fallback in `composer/triggers/resolve-draft-chat-context.ts` is deliberately **not** used here — a draft thread has no messages to select text in, so the toolbar cannot appear there; the null case is the `console.warn` no-op. Say that in one comment so a reviewer does not re-derive it.

Swap `<SelectionToolbar />` for `<ChatSelectionToolbar />` in `ChatThread.tsx:128` (same position — direct child of `ThreadPrimitive.Root`, after the Viewport). Both `ChatThread` test files mock `@/components/ui/assistant-ui/quote` by export name at line 35; retarget those mocks at the new module.

**Verify:** T20 file green; `… exec vitest run src/features/chat/thread/__tests__/ChatThread.test.tsx` and `… exec vitest run src/features/chat/thread/__tests__/ChatThread-compacting.test.tsx` green; `typecheck`.

### T22 — Tests: segmented composer rendering *(test-writer)* — depends on T10

**Files:** `packages/ui/src/features/chat/composer/segments/__tests__/ComposerSegments.test.tsx` (new).

Render the segments block against a seeded store (280-A3, A5, A11):
- one committed segment renders a `composer-segment` with `composer-quote-preview` + `composer-quote-dismiss` + a controlled `<textarea>`; all three carry the same `data-segment-id`;
- the live quote renders its pill directly above the native input, and the live segment's box is **not** a second textarea;
- clicking a committed segment's dismiss with prose present keeps the prose in place as an unquoted paragraph — addressed by `data-segment-id`, never by ordinal;
- dismissing an empty committed segment removes the whole `composer-segment` element;
- dismissing the live quote leaves the native input and its text alone;
- with an empty composition the segments block renders nothing at all (zero DOM diff vs today);
- appending a quote focuses the live box: after the append, `document.activeElement` is the `chat-composer-input` element (280-A3's focus half — the effect T23 builds, which would otherwise ship unverified). **This one case needs a harness that owns that element**, which `ComposerSegments` does not render: either render the real `Composer` for it, or give the fixture a composer-root wrapper containing a stub `<textarea data-testid="chat-composer-input">` for the focus effect's ref/`querySelector` to land on. Pick one in the test and say which in a comment — a `document.activeElement` assertion against an element that does not exist passes for the wrong reason;
- placeholder rule: a box that sits under a quote reads `Add a message…`, the quoteless box reads `Reply to Mainframe…`.

**Verify:** `… exec vitest run src/features/chat/composer/segments/__tests__/ComposerSegments.test.tsx` — fails.

### T23 — Implement the segmented composer *(ui-dev)* — depends on T22

**Files:** `packages/ui/src/features/chat/composer/segments/ComposerSegments.tsx` (new), `packages/ui/src/features/chat/composer/segments/SegmentQuotePill.tsx` (new), `packages/ui/src/features/chat/composer/Composer.tsx`.

Mount `<ComposerSegments />` inside `ComposerPrimitive.AttachmentDropzone`, **above** the `relative max-h-48 overflow-y-auto` wrapper — never inside it. That wrapper is `ComposerHighlight`'s positioning parent (`absolute inset-0` over the native textarea); adding siblings inside it, or touching its padding/typography, drifts the caret overlay. Container testid `composer-segments`; each rendered segment `composer-segment` + `data-segment-id`; pill styling per spec §2.2 (`border-l-2 border-primary bg-muted`, `Quote` icon, `line-clamp-2`, `✕` dismiss reusing the shipped `composer-quote-preview` / `composer-quote-dismiss` testids).

Committed boxes are plain controlled `<textarea>`s writing back to the store, autosizing to `Math.max(scrollHeight, 22)`; the live native input keeps its taller minimum. Enter inside a committed box inserts a newline and never submits (`/` and `@` do not trigger there — accepted gap, spec §2.2).

Focus: when `liveQuote.id` changes to a new id, focus the native input (effect keyed on the id, using a ref on `ComposerPrimitive.Input`; if the primitive does not forward a ref on 0.14.27, scope a `querySelector('[data-testid="chat-composer-input"]')` to the composer root ref — verify against the installed dist, do not guess).

In `Composer.tsx`: replace the `hasQuote` `useAuiState` read with the per-box placeholder rule (live box reads `Add a message…` when `liveQuote != null`). Keep `Composer.tsx` under 300 lines — put anything larger in the segments directory.

**Verify:** T22 file green; `… exec vitest run src/features/chat/composer/__tests__/Composer.test.tsx` (its quote-placeholder assertions at :317-343 will need retargeting at the new rule — that is expected and in scope); `typecheck`.

### T24 — Tests: `submitComposition` *(test-writer)* — depends on T9, T10

**Files:** `packages/ui/src/features/chat/composer/segments/__tests__/use-submit-composition.test.tsx` (new).

With a fake aui client (`thread().append`, `composer().getState/reset/setText`) and a seeded store, assert (280-A6 wiring, A7):
- `append` is called once with `{ role: 'user', content: [{ type: 'text', text: <serialized> }], attachments, runConfig }`;
- **`runConfig` and `attachments` are read before `composer().reset()`** and passed into `append` — `reset()` also clears `runConfig`, so a per-send run config would otherwise be silently dropped (spec Risks). Pin this with a fake whose `getState()` returns a `runConfig` and whose `reset()` nulls it: the asserted `append` argument must be the pre-reset value;
- `composer().reset()` and `segmentStore.clear(threadId)` both run, in the same synchronous step, after the append call;
- empty serialization **and** no attachments → nothing happens (no append, no reset, no clear);
- empty serialization **with** attachments → append still fires (parity with `parseSendInput`, which allows attachment-only sends);
- the submit predicate is non-empty-serialization OR attachments — never `canSend`.

**Verify:** `… exec vitest run src/features/chat/composer/segments/__tests__/use-submit-composition.test.tsx` — fails.

### T25 — Implement the submit path *(ui-dev)* — depends on T23, T24

**Files:** `packages/ui/src/features/chat/composer/segments/use-submit-composition.ts` (new), `packages/ui/src/features/chat/composer/Composer.tsx`.

One `submitComposition()` used by all three entry points: send-button click, idle Enter, and the existing mid-run Enter interception (`Composer.tsx:73-85`, which currently calls `aui.composer().send()`).

Interception strategy — verify before choosing, do not guess: `ComposerPrimitive.Root` renders a `Primitive.form` and the native input submits via `requestSubmit()`. Check the installed dist (`node_modules/@assistant-ui/react/dist/primitives/composer/ComposerRoot.js`) for whether its `onSubmit` is composed with `checkForDefaultPrevented`. **If yes** (expected): pass `onSubmit={(e) => { e.preventDefault(); submitComposition(); }}` on `ComposerPrimitive.Root` — one seam that covers Enter and the button. **If no**: fall back to the already-shipped shape — intercept Enter on the input for both idle and mid-run, and make the send control a `type="button"`.

Replace `ComposerPrimitive.Send` with a plain button keeping `data-testid="chat-composer-send"`, `aria-label="Send"` and today's classes; `disabled = worktreeMissing || !(serializedNonEmpty || attachments.length > 0)`. `ComposerPrimitive.Cancel` and the `thread.isRunning` swap are untouched. This Send/Enter replacement is **pre-authorized** by spec §2.5 and is not a Variant-E trigger.

**Verify:** T24 file green; `… exec vitest run src/features/chat/composer/__tests__/Composer.test.tsx`; `… exec vitest run src/features/chat/composer/__tests__/composer-states.test.tsx`; `typecheck`.

### T26 — Migrate `EditorContextMenu` onto the segment append *(ui-dev)* — depends on T21

**Files:** `packages/ui/src/features/editor/context-menu/EditorContextMenu.tsx`, its existing test file under `packages/ui/src/features/editor/context-menu/__tests__/`.

`handleAddAgentContext` (`:137-143`) stops calling `aui.thread().composer().setQuote({ text: ref, messageId: '' })` and appends a quote segment through the T21 seam instead. Rewrite the file docstring at `:8`, which still describes the `setQuote` call — a stale header is a leftover, and T27's grep gate matches it. Update the test's assertion to the store call. After this task nothing in the repo writes `metadata.custom.quote`.

**Verify:** the `EditorContextMenu` test file green; `typecheck`. **Then confirm the live E2E stays green:** `packages/e2e/tests-tauri/editor-comments-review.spec.ts:320-334` asserts `composer-quote-preview` contains `review.ts:2` and that dismissing it drops the count to 0. Those testids survive per-segment, and dismissing a quote on an empty segment removes the segment, so the assertions should hold as written — but run that spec and fix the selectors if they do not. This spec is **not** skipped and the plan spec never mentions it (see Open questions #2).

### T27 — Sweep the leftovers *(ui-dev)* — depends on T21, T23, T25, T26

**Files:** `packages/ui/src/features/chat/controller/chat-reconcile.ts`; `packages/ui/src/components/ui/assistant-ui/quote.tsx`; `packages/ui/src/features/chat/controller/__tests__/parse-send-input-quote.test.ts` → renamed `parse-send-input.test.ts`; `packages/ui/src/features/chat/composer/__tests__/Composer.test.tsx`; `packages/ui/src/features/chat/composer/__tests__/composer-states.test.tsx`; `packages/e2e/tests-tauri/composer-advanced.spec.ts`.

Delete, in one pass (280-A9):
- `quoteText()` (`chat-reconcile.ts:59-64`) and the quote branch inside `parseSendInput` (:70-76) — it becomes a plain text + attachments parser; its `AppendMessage` role guard and the `!text && no uploads → null` return stay;
- `ComposerQuotePreview` (whole compound) and `SelectionToolbarQuote` from `quote.tsx`, and the `ComposerQuotePreview` import + `<ComposerQuotePreview />` mount from `Composer.tsx`;
- `QuoteBlock` (dead export at `quote.tsx:190`) **and everything that references it** — the `test.skip` at `composer-advanced.spec.ts:312-316` and the `QuoteBlock` mentions in that spec's docstring at :13/:22. The spec requires the skip to die with the symbol (§2.3), and the grep gate below cannot pass while they stand;
- `hasQuote` and its `useAuiState` subscription (already replaced in T23 — assert it is gone);
- the `ComposerQuotePreview` stubs at `Composer.test.tsx:111-113` and `composer-states.test.tsx:64-66`;
- the quote vectors in `parse-send-input-quote.test.ts` (already migrated in T8). Keep the file, renamed to `parse-send-input.test.ts`, holding its remaining non-quote assertions (the non-user-role → `null` vector) so the parser keeps a direct test; rewrite its header comment at `:17`, which still describes `metadata.custom.quote` (the grep gate matches it); the controller-level role guard at `chat-thread-controller-send.test.ts:346` stays as it is.

Grep gate for the task: `rg -n "quoteText|ComposerQuotePreview|SelectionToolbarQuote|QuoteBlock|hasQuote|metadata.custom.quote|setQuote" packages/ui/src packages/e2e` returns nothing outside the deleted lines.

**Verify:** `… exec vitest run src/features/chat/controller/__tests__/parse-send-input.test.ts`; `… exec vitest run src/features/chat/controller/__tests__/chat-thread-controller-send.test.ts`; `… exec vitest run src/features/chat/composer/__tests__/Composer.test.tsx`; `… exec vitest run src/features/chat/composer/__tests__/composer-states.test.tsx`; `typecheck`.

---

## Phase D — E2E honesty, budgets, changeset

### T28 — Update the skipped E2E selectors *(test-writer)* — depends on T23, T27

**Files:** `packages/e2e/tests-tauri/composer-advanced.spec.ts`.

The three skips at :249/:293/:305 stay skipped — their cause is undetermined and lives in `SelectionToolbarPrimitive.Root`, which this feature preserves; unskipping them is explicitly out of scope (spec §Scope, Decision 17). But a skipped test must not also be silently wrong: update their `composer-quote-preview` / `composer-quote-dismiss` selectors to the per-segment shape (scope them via `data-segment-id` where they addressed a single pill) and keep the verbatim skip reasons. (The `QuoteBlock` skip and docstring in this same file were already deleted in T27, with the symbol.)

**Verify:** `pnpm test:e2e --grep "composer"` — the suite loads, the three tests report as skipped, and the drivable non-selection coverage of `/`, `@` and attachments (280-A4's regression proof) stays green.

### T29 — Budget and hygiene sweep *(ui-dev)* — depends on T27, T28

**Files:** none new; audits everything touched.

- `wc -l` every new/modified `packages/ui/src` file: all ≤300; no function >50.
- Every new interactive element has a `data-testid`; every repeating segment element has `data-segment-id`.
- Only `mf-*` tokens present in `packages/ui/src/styles/globals.css` (`mf-success` is the only new one used — confirm it exists).
- No `@ts-ignore`, no leftover `TODO`, no commented-out code.
- Run the full touched-test list once, file by file, plus `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

**Verify:** the commands above, all green.

### T30 — Changeset *(ui-dev)*

**Files:** a new file under `.changeset/`.

`pnpm changeset` → `@qlan-ro/mainframe-ui`, **minor** (two user-visible features). Summary in the repo's voice: one sentence for the path menu, one for the selection toolbar + multi-quote composer.

**Verify:** the changeset file exists and names `@qlan-ro/mainframe-ui`.

---

## Parallelism map

| Group | Tasks | Notes |
|---|---|---|
| Parallel | T1→T2, T3→T4, T5, T6→T7, T8→T9, T11→T12 | Disjoint files. T10 joins after T7. |
| Parallel | T13, T14→T15 | Independent of Phase A except T2/T4. |
| Sequential | T4 → T17 | Both edit `markdown-text.tsx`. |
| Sequential | T5, T15 → T16 | `AssistantMessage.tsx`. |
| Sequential | T19 → T21 → T26 | `quote.tsx` then the append seam. |
| Sequential | T23 → T25 → T27 | All edit `Composer.tsx`. |
| Sequential | T21, T23, T25, T26 → T27 → T28 → T29 → T30 | The sweep must be last. |

## Acceptance-criteria coverage

| Criterion | Task(s) |
|---|---|
| 274-A1, A2, A3, A5, A10 | T14/T15 (jsdom), T18 (E2E) |
| 274-A4 | T14/T15 (jsdom only — global-selection stub) |
| 274-A6 | T13 |
| 274-A7 | T5, T16 |
| 274-A8 | T17 |
| 274-A9 | T14/T15 (class pin) |
| 274-A11 | T1/T2 |
| 280-A1 | T20/T21 |
| 280-A2 | T20/T21 for the mousedown-preventDefault and selection-clear halves; the "toolbar is gone" half is **not covered by an automated test** — it belongs to `SelectionToolbarPrimitive.Root`, which the jsdom tests stub around and the E2E selection gesture cannot drive (spec Decision 17). Verify it by hand once. |
| 280-A3 | T6/T7 (transitions), T22/T23 (render + focus assertion) |
| 280-A4 | T23 (native input is the live box), T28 (existing drivable E2E stays green) |
| 280-A5 | T22/T23 |
| 280-A6 | T8/T9 |
| 280-A7 | T10, T24/T25 |
| 280-A8 | T11/T12, T20/T21 |
| 280-A9 | T26, T27 |
| 280-A10 | T6-T10 (all pure modules) |
| 280-A11 | T29 |

## Risks carried into implementation

1. **`composer().reset()` clears `runConfig`.** `submitComposition()` must read `runConfig` (and `attachments`) *before* resetting and pass them into `append`. Pinned by a test in T24 rather than left to review.
2. **Abandoned-slot prefill replaces text.** The New-session prefill overwrites whatever sits in the reused `__LOCALID_*` draft slot (spec Decision 16). It is the one unprompted text-loss path in this feature; T11 pins the replacement so it stays deliberate.
3. **Send-failure loss is pre-existing.** Clearing at dispatch means a failure inside `onNew` discards the composition. Today's composer already loses the typed draft this way; segments inherit it. Not fixed here.
4. **Form-submit interception is version-sensitive.** T25's primary approach depends on `ComposerPrimitive.Root` composing `onSubmit` with `checkForDefaultPrevented` on 0.14.27. The task requires verifying that against the installed dist and names the fallback; do not bump assistant-ui either way.
5. **Native right-click Copy is shadowed** inside assistant messages when a selection exists (spec Risks). Approved as-is; the one-line alternative (`stopPropagation()` when a selection exists) is flagged for the user, not implemented.
6. **The selection gesture has no E2E.** Per spec Decision 17, the three `composer-advanced.spec.ts` skips stay skipped and this plan promises no unskip. Selection-gesture criteria are jsdom-only, which means a real-browser regression in `SelectionToolbarPrimitive.Root` would not be caught by this PR's tests.

## Open questions / planner calls the spec left implicit

1. **Composition shape** (committed array + separate `liveQuote`) is a planner call; the spec describes `s0..sN` behaviorally. Chosen so the live prose has exactly one home (the native composer) and is never mirrored into the store.
2. **`editor-comments-review.spec.ts:320-334` is live, not skipped**, and the spec never mentions it. T26 must keep it green; the assertions look compatible with the per-segment testids but this is unverified until it runs.
3. **`resetDaemonScopedStores` registration** for the segment store is not in the spec. T10 adds it, on the reasoning that thread ids are daemon-scoped and a daemon switch should not leave another daemon's segments addressable.
4. **Layering of the wired toolbar.** The spec says "extend the existing `SelectionToolbar` compound"; the repo rule says `ui/` primitives stay passthrough. Resolved by keeping `quote.tsx` presentational (`Root` + generic `Action`) and putting the store/aui wiring in `features/chat/thread/ChatSelectionToolbar.tsx`. Cost: the two `ChatThread` test mocks move to the new module path (T21).
5. **`parse-send-input-quote.test.ts` is renamed, not deleted.** The spec says the file "is deleted along with the quote branch it covers"; its non-quote role-guard vector is a genuine parser test with no better home, so T27 keeps a slimmed `parse-send-input.test.ts` instead of folding it into the controller send tests.
