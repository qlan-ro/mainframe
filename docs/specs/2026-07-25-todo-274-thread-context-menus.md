# Spec: Thread context menus — path copy (#274) + selection actions & multi-quote (#280)

**Todos:** #274 (`route:full`) + #280 (escalated `route:no-spec` → `route:full` per its design direction)
**Design gate:** approved 2026-07-25 via the `prototype` skill, jointly for both todos. Artifact: branch `proto/thread-context-menu` @ `910bafe7`, `packages/ui/src/prototypes/thread-context-menu/`. `unified-shell.tsx` is the reference implementation of the whole interaction; `VariantF.tsx` of the composer; `VariantE.tsx` is the named fallback.
**Ships as:** one PR on `todo/274-thread-context-menus`.
**Daemon impact:** none. Both features are client-only (`packages/ui`); no daemon routes, no WS contract change, no Rust parity work.
**Revision:** 2026-07-25 rev 2 — resolves the two-reviewer panel verdict (8 blocking, 6 follow-up). Changed sections: §1 trigger + nesting + path derivation, §2.2, §2.3, §2.4, §2.5, all acceptance criteria, Decisions 3–4 and 11–12, plus new Decisions 14–21.

This spec defines behavior, not implementation. Where the approved design direction fixed a choice, it is restated here as settled; the sections marked *(spec ruling)* are the calls the design left open.

## Current behavior (verified in code)

- File paths in tool-result headers render via `ClickableFilePath` (`features/chat/tools/shared/chrome.tsx` — used by `EditFileCard`, `ReadFileCard`, `WriteFileCard`). Left-click opens the file in the editor surface; a tooltip shows the full path. There is no right-click menu and no way to copy a path from the thread.
- Left-click open routes the path string through `toFileRef` (`lib/files/file-ref.ts`, via `store/intent-subscriber.ts`), using the bases in `useActiveBasesStore` (populated in `app/AppShell.tsx` from `useActiveIdentity()`: `{ worktreePath, projectPath }`). `toFileRef` is pure, unit-tested, and tries the bases as an **ordered fallback** — worktree first, then project — rather than a single hard root.
- Select-to-quote ships: `SelectionToolbar` (`components/ui/assistant-ui/quote.tsx`, wrapping `SelectionToolbarPrimitive`) floats a single **Quote** button over a selection; the quote lands in the native composer's single slot and `parseSendInput` (`features/chat/controller/chat-reconcile.ts:66`) prepends it to the sent text as a markdown blockquote. One quote per send; a second Quote overwrites the first.
- `EditorContextMenu` ("Add Agent Context") also writes to the same single slot via `composer().setQuote()`.
- `Composer.tsx:65` reads `s.composer.quote != null` as `hasQuote` and uses it for one thing: the live input's placeholder (`'Add a message…'` when a quote is pending, else `'Reply to Mainframe…'`).
- Markdown links in assistant prose carry their own `ContextMenu` (`LinkWithPreview` in `features/chat/parts/markdown-text.tsx`): Copy link / Open link, with a `Copied` → delayed-close mechanism (dispatched `Escape`, state reset in `onOpenChange`) identical to the one this spec needs. It does **not** stop `contextmenu` propagation today.
- The composer's send gate on 0.14.27: `canSend = isEditing && !isEmpty && !isSendDisabled` with `isEmpty` computed from text + attachments only (`ExternalThread.js` ~395), and `send()` early-returns on `!state.canSend`. A quote with an empty draft cannot send today. `send()` also hardcodes `metadata: { custom: { quote } }` and clears text/attachments/quote **synchronously** after handing the message to `onSend`, without awaiting it.
- `thread().append(message)` reaches the identical sink: `if (queue) queue.enqueue(...) else onNew?.(...)`, where `onNew` is the same `handleSendNew` passthrough wired as the composer's `onSend`. The native queue adapter is not wired here (`thread.capabilities.queue` is false — the daemon owns the queue), so both paths land in `use-chat-thread-runtime.ts`'s `onNew`. `append` accepts caller-supplied `metadata`, `attachments` and `runConfig`, and does **not** clear the composer; `composer().reset()` does (text, role, runConfig, attachments, quote).
- `MessagePrimitive.GroupedParts` renders a `Fragment` (verified in `@assistant-ui/core@0.2.21`), so message parts are direct flex children of `MessagePrimitive.Root`, which carries `flex flex-col gap-2 py-3` (`AssistantMessage.tsx`).
- Selection reach is bounded by the deliberate `user-select` policy in `styles/globals.css` (`none` on body; opt-in for `.aui-md`, `pre`, `code`, inputs). Selections spanning two messages show no toolbar. Both stay as-is.
- `packages/e2e/tests-tauri/composer-advanced.spec.ts:249` carries an unresolved `test.skip(true, 'TODO(investigate): chat-selection-toolbar never appears after programmatic selection + synthetic mouseup')`; the quote-preview and quote-dismiss tests below it are skipped as dependents. The suspected cause sits in `SelectionToolbarPrimitive.Root`, which this feature keeps.

## Scope

**In:** the per-message path context menu (#274); the second selection-toolbar action "New session" (#280); the segmented multi-quote composer, Variant F (#280); migration of the two existing single-slot quote producers onto the segment model.

**Out (non-goals):**
- Prose-path detection ("anywhere else in the thread") — only structured `ClickableFilePath` elements get the menu. Follow-up todo.
- "Reveal in Finder" / "Open in external editor" menu items.
- Any change to left-click open behavior, the `user-select` policy, or cross-message selection.
- Skill-instruction buttons (#278) and localhost-tunnel button (#279).
- Persisting quote segments across app restart.
- `/` and `@` autocomplete inside earlier segments' comment boxes (accepted gap; the live segment always has them).
- **Unskipping `composer-advanced.spec.ts:249` and its two dependents.** Their cause is undetermined and lives in a primitive this feature preserves; investigating it is a separate todo. Their selectors are updated in place so they stay honest, but they stay skipped (§Verification).

---

## Part 1 — #274: path context menu

### Behavior

One `ContextMenu` (shadcn primitive, `components/ui/context-menu.tsx`) per **top-level** assistant message. The trigger wraps the message parts/content region of `AssistantMessage`'s normal branch — not the action bar or timing rows, whose right-click keeps the WebView's native menu *(spec ruling)*. It resolves the path at right-click time from `(e.target).closest('[data-file-path]')` — not one menu per pill. `ClickableFilePath` keeps `data-testid="tool-card-file-path"` and gains `data-file-path` carrying the same path string it passes to open (the design note says "absolute path"; tool-card paths are absolute in practice, but the contract is "the string the pill opens" so copy and open can never disagree).

**Trigger wrapper markup** *(spec ruling — finding 11)*: `ContextMenuTrigger asChild` needs exactly one DOM child, and `GroupedParts` is a Fragment, so the wrapper would otherwise collapse N flex items into one and delete the `gap-2` between every part of every message. The wrapper is a `<div data-testid="chat-message-menu-trigger" className="flex flex-col gap-2">` — it re-declares the layout it interposes on, so the rendered spacing is byte-identical to today (Root keeps `flex flex-col gap-2 py-3`; it now has two children — the wrapper and the action-bar row — separated by the same `gap-2`). A test pins the wrapper's layout classes; visual review confirms no spacing change.

**Nesting rules** *(spec ruling — Radix context-menu triggers do not stop propagation, so without these two rules a right-click opens two stacked menus)*:

- `boundedMessageComponents` (`features/chat/messages/bounded-messages.tsx`) is a single map consumed by both `thread/ChatThread.tsx` and `tools/cards/TaskCard.tsx`, and `AssistantMessage()` takes no props — so "nested messages mount no wrapper" needs an actual discriminator. **The mechanism is a React context**: a `NestedTranscriptProvider` (default `false`) that `TaskCard` mounts around its `ThreadPrimitive.Messages`. `AssistantMessage` reads it and mounts the `ContextMenu` + wrapper only when the value is `false`; nested instances render exactly today's markup (no wrapper, no class change, no spacing delta). The top-level wrapper contains the nested pills in the DOM, so `closest('[data-file-path]')` resolves them. (A second `components` map for nested transcripts is the alternative; the context is chosen because it survives arbitrary nesting depth and keeps one map.)
- The existing link menu (`LinkWithPreview`) wins innermost. This is a **required edit, not current state**: the anchor inside `ContextMenuTrigger asChild` gains an `onContextMenu` handler that calls `stopPropagation()` **only** — never `preventDefault()`, because Radix composes the trigger's own handler with `checkForDefaultPrevented` and would skip it, killing the link menu. The handler must be declared so the existing `{...props}` spread cannot overwrite it.

**Selection-first arbitration (settled):** in the `onContextMenu` handler,

```ts
setPath(hasSelection ? null : (el?.dataset.filePath ?? null));
```

where `hasSelection = Boolean(window.getSelection()?.toString().trim())`. A non-empty selection suppresses the path actions entirely — no merged menu, no sections. When no path resolves (selection present, or right-click off any pill), the menu shows a single disabled item — label `No actions available`, testid `chat-menu-empty` — rather than an empty box.

**Menu items**, in order, both with the `Copy` lucide icon:

1. `Copy Absolute Path` — testid `tool-card-path-copy-absolute`
2. `Copy Relative Path` — testid `tool-card-path-copy-relative`

On select, the clicked item swaps to a `Check` icon in `text-mf-success` with label `Copied`, and the menu closes ~900ms later. Radix `ContextMenu.Root` has no controlled open state, so the delayed close is a bubbling `Escape` keydown dispatched on `document`; the copied state resets in `onOpenChange(false)`, which also clears the pending timer (user-pressed Escape or outside-click therefore behaves correctly). This exact mechanism already ships in `LinkWithPreview` (`markdown-text.tsx`); this menu makes it a second verbatim copy, so per the repo's extract-at-duplication rule the mechanism is pulled into a shared helper both menus consume rather than pasted again. Clipboard writes go through the existing `writeToClipboard` (`lib/editor/copy-reference.ts` — logs on failure, never throws; the `Copied` feedback shows regardless).

Prior-art wording note: the file tree already ships `Copy Path` / `Copy Relative Path` (`FileTreeRowMenu`, no Copied feedback). This menu's labels are design-fixed (`Copy Absolute Path` / `Copy Relative Path`); the divergence is accepted and unifying the file-tree menu is out of scope.

Native Radix placement at the cursor. No new affordance on the pill (hover + tooltip already carry it). Left-click and keyboard activation of the pill are unchanged.

### Path derivation *(spec ruling — reuse, do not restate)*

Both menu items derive their strings from the **shipped** normalizer `toFileRef(rawPath, bases)` (`lib/files/file-ref.ts`), fed by the **same** `useActiveBasesStore` bases the open-file intent uses. This is the whole point of the `data-file-path` contract: copy and open consume one normalizer and one set of bases, so they cannot disagree — including for a path under the project root but outside the worktree, where a hard `worktreePath ?? projectPath` root would have copied the absolute path while left-click opened the project-relative one.

- `Copy Relative Path` copies `ref.relative`.
- `Copy Absolute Path` copies `ref.absolute ?? ref.relative`.

What that yields, given `toFileRef`'s existing semantics (worktree base tried first, then project base; `relativeUnder` matches on a `/` boundary, so a sibling directory never mis-relativizes):

| Input | Relative item copies | Absolute item copies |
|---|---|---|
| absolute, under a known base | base-relative path | the absolute path |
| relative | the path as stored | root-joined absolute path (**the one new case**) |
| absolute, outside every base (`isExternal`) | the absolute path | the absolute path |
| no bases resolvable | the stored path unchanged | the stored path unchanged |

The only genuinely new logic is the relative→absolute join: `toFileRef` leaves `absolute` undefined for already-relative input. It is added **inside `lib/files/file-ref.ts`**, behind that module's existing test file — the joined base is the first defined of `worktreePath`, `projectPath` (same precedence as the absolute branch); with neither base defined, `absolute` stays undefined and both items fall back to the stored path. No new module, no restated rules, no second copy of the containment logic.

### #274 acceptance criteria

- [ ] **274-A1** Right-clicking a `ClickableFilePath` pill in a tool-result header (with no text selection) opens a context menu with exactly two enabled items: `Copy Absolute Path`, `Copy Relative Path`.
- [ ] **274-A2** For a path under a known base, `Copy Absolute Path` places the absolute filesystem path on the clipboard and `Copy Relative Path` places the base-relative path (worktree base first, then project base). In the degraded cases the spec allows — path outside every base, or no bases resolvable — **both** items place the stored path unchanged (§Path derivation table).
- [ ] **274-A3** After selecting an item, it shows `Check` + `Copied` (`text-mf-success`) and the menu closes on its own ~900ms later; reopening shows the normal labels again.
- [ ] **274-A4** With a non-empty `window.getSelection()`, right-clicking a path pill does NOT show the copy items — only the single disabled `chat-menu-empty` item.
- [ ] **274-A5** Right-clicking assistant-message content that is not on (or inside) a `[data-file-path]` element shows only the disabled `chat-menu-empty` item.
- [ ] **274-A6** Left-click and Enter/Space on the pill still open the file in the editor surface, unchanged.
- [ ] **274-A7** Right-clicking a path pill inside a nested Task-transcript tool card opens **exactly one** context menu (one menu content in the DOM), and its items resolve that pill's path. Nested `AssistantMessage` instances render no trigger wrapper.
- [ ] **274-A8** Right-clicking a markdown link in assistant prose shows **exactly one** menu — the link menu (`chat-link-copy`, `chat-link-open`) — with no path items and no second stacked menu.
- [ ] **274-A9** The trigger wrapper carries `flex flex-col gap-2`, so inter-part spacing inside a message is unchanged from before this feature (pinned by test).
- [ ] **274-A10** Menu items carry the settled testids; the pill keeps `tool-card-file-path` and exposes `data-file-path`; the trigger wrapper carries `chat-message-menu-trigger`.
- [ ] **274-A11** `file-ref.ts` gains unit tests for the new relative→absolute join: relative input with a worktree base, with only a project base, and with neither base (absolute stays undefined). Plus one agreement test: for the same raw path and bases, the string `Copy Relative Path` copies equals the `relative` the open-file intent keys on.

---

## Part 2 — #280: selection toolbar + multi-quote

Per the approved direction, #280's trigger is the **floating selection toolbar**, not a right-click menu, and "Add to composer" is the existing Quote feature. #280 contributes one new action (**New session**) and the **multi-quote** composer model.

### 2.1 Toolbar

Extend the existing `SelectionToolbar` compound (`components/ui/assistant-ui/quote.tsx`) with a second child — a sibling, not a fork. Root keeps testid `chat-selection-toolbar` and its native placement/portal. Order and wording (settled):

| # | Label | Icon | Testid |
|---|-------|------|--------|
| 1 | `Quote` | `Quote` | `chat-selection-quote` (exists) |
| 2 | `New session` | `MessageSquarePlus` | `chat-selection-new-session` |

Every button `preventDefault()`s on `mousedown` so the click doesn't clear the selection first. `useSelectionToolbarInfo` is not exported from the package root, so both buttons read `window.getSelection()` themselves at click time. After either action, the selection is cleared and the toolbar dismisses.

**Native-conflict note (required by the golden rule):** the native `SelectionToolbarPrimitive.Quote` writes to `composer().setQuote()` — a single overwriting slot with no append. Multi-quote requires append, so the Quote child becomes a custom button dispatching to the segment store (§2.2) while `SelectionToolbarPrimitive.Root` is kept for selection detection, positioning, and the mousedown trick. The native `ComposerPrimitive.Quote`/`QuoteText`/`QuoteDismiss` pill (`ComposerQuotePreview`) is likewise replaced by the segment pills. This is a deliberate, design-approved departure from the native single-quote plumbing, confined to the Quote child, the composer pill, and the send predicate (§2.3); everything else native stays.

### 2.2 Multi-quote: the segmented composer (Variant F, settled)

The composer becomes a short document. Each Quote appends a **segment**: a quote pill plus its own comment box directly underneath. Segment 0 is the plain comment box with no quote (today's composer). A new quote always appends at the **bottom** and focuses its box — load-bearing, because it means **the live segment is always the last one**, so the native `ComposerPrimitive.Input` IS the last segment's box and keeps `/` skills, `@` files, `ComposerHighlight`, autosize, attachments, and Enter-to-send / Enter-to-queue unchanged. Committed segments above render as pill + plain controlled `<textarea>` held in a client-side store (behavioral contract below; the store is not part of the daemon state).

- Pill look: shipped quote styling (`border-l-2 border-primary bg-muted`, `Quote` icon, `line-clamp-2` preview, `✕` dismiss).
- Committed boxes autosize and collapse when spent; the live box keeps a taller minimum (reference: `Math.max(scrollHeight, last ? 48 : 22)` in the prototype).
- Quotes from different messages may mix in one send (explicit user ruling).
- **Appending a quote while the live box has text: commit-and-clear** *(spec ruling — finding 7)*. Because the live box is the native input and the new segment lands **below** it, leaving the text where it is would serialize `> Q\n\nintro` instead of `intro\n\n> Q`. So on every quote append, in one step: (1) the native input's current text becomes the prose of the current last segment, committing it; (2) the native input is cleared (`composer().setText('')`); (3) the new quoted segment is appended and its box — the native input again — is focused and empty. The text is moved, never copied: it exists in exactly one place at every point. The step is identical whether the live text is empty or not, which is why quoting again with an empty live box needs no separate rule — the committed segment simply has empty prose and stays as a quote with no comment.
- Editing an earlier segment's box: plain text editing only; Enter inserts a newline and never sends; `/`/`@` do not trigger (accepted gap). Only the live (native) input submits.
- Empty state: with no quote segments the composer looks and behaves exactly as today (segment 0 alone; zero visual or behavioral diff).
- **Placeholder cue** *(spec ruling — finding 13)*: today's `hasQuote` placeholder swap dies with `s.composer.quote`, so it is re-expressed per box — a box that sits under a quote shows `Add a message…`; the quoteless segment-0 box shows `Reply to Mainframe…`. With one quote pending, the live box therefore reads `Add a message…` exactly as it does today; `hasQuote` and its `useAuiState` read are deleted.

**Testids** *(settled, with finding 9's keying fix)*: `composer-segments` (container), `composer-segment` (each), `composer-quote-preview` and `composer-quote-dismiss` (per segment, reusing the shipped names). Because these repeat across N segments, every one of the three per-segment elements also carries `data-segment-id="<id>"` — a stable, opaque id minted when the segment is created (never an array index, never reassigned when a segment above is removed), so a test can address "the segment that had prose" across the exact transition it is testing. The existing `chat-composer-input` stays on the live native input.

**Dismiss semantics** *(design fixed the rule; spec pins the edges)*:

- Dismiss (`✕`) drops the quote but keeps typed prose: a segment whose box has prose stays as an unquoted paragraph in place; segments never merge or reorder on dismiss.
- A dismissed segment whose box is empty (whitespace-only counts as empty) disappears entirely.
- Dismissing the last segment's quote keeps the live native input and its draft text; the pill above it disappears.
- Dismissing all quotes returns the composer to the plain single-input state.

**Store lifecycle** *(spec ruling — revised per finding 12)*: segments live in an in-memory client store keyed per thread (the aui thread item id, same key the controller uses). They survive switching threads within the app session — mirroring the native per-thread draft — and are not persisted across app restart.

- **Clear ordering: at dispatch, together with the native draft.** The submit path (§2.3) clears the segment store in the same synchronous step in which it clears the native composer (`composer().reset()`). This is exact parity with the shipped composer: native `send()` also clears text and attachments immediately after handing the message to `onSend`, without awaiting it, so a daemon hiccup during `createForLocal` already discards the typed draft today. Segments inherit that behavior rather than inventing a segment-only retry buffer; the pre-existing gap is recorded under Risks and is not widened by this feature.
- **No archive/delete hook.** The earlier "archiving/deleting a thread drops its segments" clause is dropped: archive runs through `chats-remote-adapter`, nowhere near a client store, and there is no client-side event to hang it on. A stale entry for a vanished thread is memory-only, unreachable (no thread renders it), and dies with the app session.

### 2.3 Serialization and the send path *(spec ruling — revised per findings 1 and 3)*

**Carrier: serialize at the append call site.** The composition is turned into one markdown string in the composer (React), and the string is what leaves as message content. `parseSendInput` (`chat-reconcile.ts`) is *not* taught about segments: it loses its quote branch and becomes a plain text + attachments parser. The rejected alternative was carrying `metadata.custom.segments` through to the controller — technically viable via `append()` (verified: `append` forwards caller `metadata`, `send()` hardcodes its own), but it invents a client-internal message-shape contract and pushes React state into a non-React class (`chat-thread-controller.ts:247`) that cannot reach the store without the `getState()` reach-through the package DoD forbids.

**The submit path.** Send-button click, live-input Enter (idle), and live-input Enter (mid-run, the existing queue interception) all call one shared `submitComposition()` helper:

1. Read the segments, the live input's text, the composer's `attachments` and `runConfig`.
2. Serialize (pure function, rules below). If the result is empty **and** there are no attachments, do nothing.
3. `thread().append({ role: 'user', content: [{ type: 'text', text: serialized }], attachments, runConfig })` — the same sink `send()` reaches (`onNew` → `controller.sendMessage`), so optimistic-store and run-state behavior are unchanged.
4. `composer().reset()` (clears text, attachments, runConfig, and the now-unused quote slot) and clear this thread's segments.

**This replaces `ComposerPrimitive.Send` and the native idle-Enter submit, and that is pre-authorized** — see §2.5. The reason is structural, not stylistic: `send()` gates on `canSend`, which counts only native text and attachments, so a quote-only composition can never send through it.

**Serialization rules**, in order, given segments `s0..sN` (s0 has no quote; the live text is sN's prose at submit time):

1. Each segment renders as: blockquote of its quote — `> ` prefixed on **every** line of the quoted text — then, if its prose is non-empty, `\n\n` + prose. A quoteless segment renders as its prose alone.
2. Segments with no quote and empty prose render nothing (s0 is omitted when empty; dismissed-empty segments are already gone).
3. Rendered segments join with `\n\n`; the result is trimmed.
4. Attachments are unaffected (same `uploadItems` path).
5. Send is allowed whenever the serialized text is non-empty, even if the live box is empty — quote-only sends work. **This is new**; today a quote with an empty draft cannot send at all. The Send button's disabled state and the Enter handler both bind the serialized-non-empty predicate, not `canSend`.

Worked example — `quote A` + comment `first`, then `quote B\nline two` + comment `second`, live box empty:

```
> quote A

first

> quote B
> line two

second
```

**Single-quote equivalence (backward compatibility):** one quote + one comment must serialize byte-for-byte to today's output (`> q\n\nbody`). The hardcoded vectors currently in `parse-send-input-quote.test.ts` move to the serializer's own test file with their expectations unchanged; that file is deleted along with the quote branch it covers (the file's remaining non-quote assertions, if any, move to the existing controller send tests).

The sent user message displays this text the same way today's quoted sends display (markdown text in the bubble); optimistic-send reconcile keys off the same serialized text, so reconcile behavior is unchanged.

**Producer migration (no leftovers):** both existing single-slot producers move to the segment append — the toolbar Quote button and `EditorContextMenu`'s "Add Agent Context" (`aui.thread().composer().setQuote(...)` → append a segment). After migration nothing writes `metadata.custom.quote`. Deleted in the same pass:

- `parseSendInput`'s quote branch and its `quoteText` helper;
- the `ComposerQuotePreview` compound and `SelectionToolbarQuote` (both replaced by the segment pills / the custom Quote button) in `quote.tsx`;
- `QuoteBlock` (exported at `quote.tsx:190`, imported nowhere — already dead; swept while the file is open, together with the `TODO(app-tauri)` e2e skip that exists only to track it);
- `hasQuote` in `Composer.tsx` and its `useAuiState` subscription (replaced by the per-box placeholder rule in §2.2).

### 2.4 "Start new session" *(behavior settled; mechanics are spec rulings — revised per findings 5 and 6)*

Clicking **New session** with a non-empty selection opens a new-thread draft in the **source chat's project** (the project the message belongs to, read from the source thread's `custom.projectId` — never from ambient sidebar state), pre-filled with the raw selection. Nothing is auto-sent, and no chat exists until the first send.

The mechanics are the shipped **picker** draft flow (`sidebar/SessionsNewButton.tsx`'s `pick()`), not the ⌘N hotkey flow — the hotkey flow reads `filterProjectId` and would open the project picker on "All" or seed the *filter's* project on a different pill. The earlier reference to `use-start-todo-session.ts` was also wrong: that path creates a **real** chat via `startTodoSession` + `threads.reload()`, which contradicts "no chat until first send"; only its prefill-after-switch ordering (bug #212) carries over. Sequence:

1. If the sidebar project filter is set and differs from the source chat's project, clear it (`setFilterProjectId(null)`) — the same reconciliation that already fires when the user activates a chat in another project. This keeps the draft row visible and stops `useNewThreadAutoConfig` from seeding the filter's project instead of the source's.
2. `rememberReturn()` — snapshot the active session so discarding the draft returns to it. The source session is switched away from (unchanged, not closed) and is reachable via that return target and the sessions list.
3. `resetNewThreadDraft(newThreadId)` on the current slot, then `await threads.switchToNewThread()`, then re-read `newThreadId` (the slot id is only valid after the switch resolves).
4. `initializeDraft({ localId, projectId: sourceProjectId, port, defaultAdapterId, adapters })` — note the adapter comes from the **global** `defaultAdapterId` setting (`initialize-draft.ts` → `resolveDefaultAdapterId`), not a per-project default; failure surfaces the same `mfToast.error('Couldn't initialize session')` the picker path shows.
5. Set the composer text to the **raw selected text as plain text** — no `> ` markers, no quote segment (a new session has no thread to quote from) — after the switch has landed.

Because steps 2–5 are order-sensitive and now have two call sites, they are extracted into one `openNewThreadDraft({ projectId, prefill })` module that both the sidebar picker and this action call; the picker's observable behavior does not change.

**Reused-slot text** *(spec ruling — finding 6)*: aui reuses a single `__LOCALID_*` slot until the first send, and `resetNewThreadDraft` clears draft *config* and ready flags, not composer text. Any text left in that slot from an abandoned New action is **replaced**: the prefill sets the composer text to exactly the selection. This is the same intent `resetNewThreadDraft` already encodes — a fresh New action must reflect the current context, not a stale one — and it is now explicit rather than an accident of `setText`. The composer of a *committed* chat is never touched.

The action starts no launch config and does **not** inherit the source chat's worktree — it is a plain project session. If the source chat's project cannot be resolved (should not happen for a live chat), the action is a no-op with a tagged `console.warn` — no toast, no partial navigation.

### 2.5 Fallback: Variant E *(trigger criteria — spec ruling, rewritten per finding 1)*

Variant E ("markdown at the caret": Quote inserts a `> …` blockquote at the cursor with a blank line beneath, composer stays one native textarea, serialization is the literal draft text) is the fallback if F proves unbuildable. The triggers are stated as **user-visible affordance loss**, because the previous "reimplementing primitive behavior" wording fired on the Send replacement that §2.3 requires — i.e. it mandated the variant the design direction rejected.

**Pre-authorized. None of these is a trigger** (they are the known, accepted cost of F, and all are composition against the pinned 0.14.27 — no patching or forking):

- Replacing `ComposerPrimitive.Send` with a custom send button whose disabled state binds the serialized-non-empty predicate instead of `canSend`.
- Replacing/intercepting the native idle-Enter submit on the live input for the same reason (the mid-run Enter interception already ships).
- Using `thread().append()` instead of `composer().send()`, and clearing the composer manually afterwards via `composer().reset()`.
- Rendering the committed segments as plain controlled textareas above the native input.
- File-size pressure (300-line cap) — decompose instead.

**Take E only if, after the above, the shipped composer loses an affordance a user can observe:**

1. The live box stops behaving like today's composer in any of: `/` skills, `@` files, `ComposerHighlight` painting, attachment drop/paste/picker, autosize, Shift+Enter newline, Enter-to-send when idle, or Enter-to-queue while running.
2. Composer edit mode (`ComposerEditMode`) or the queued-message banner regress in observable behavior.
3. The segment layer cannot render a dismissable quote pill with its own comment box at all — the one thing E cannot express, and therefore the only condition under which trading down to E is coherent.

Taking E must be stated explicitly in the PR description with the specific trigger hit; shipping E silently is a spec violation. Variant G is an also-ran, not a fallback.

### Verification layers *(spec ruling — finding 10)*

Every #280 criterion that starts from a real text-selection gesture is verified in **jsdom/vitest**, not Playwright. `composer-advanced.spec.ts:249` is skipped with an undetermined cause that lives in `SelectionToolbarPrimitive.Root` — the part Variant F preserves — so shipping this feature does not close it, and this spec does not promise the unskip. The layer per criterion:

| Criteria | Layer |
|---|---|
| 280-A1, A2, A8 (selection gesture → toolbar → action) | jsdom component tests (`quote.tsx` toolbar + the New-session action), stubbing `window.getSelection`. Precedent: `markdown-text.test.tsx`, `SessionContextMenu.test.tsx`. |
| 280-A3, A5 (append / dismiss rendering) | jsdom component tests on the composer (`Composer.test.tsx`, `composer-states.test.tsx` are the existing homes). |
| 280-A4 (live box keeps native affordances) | jsdom component test that the native input is the last segment and keeps `chat-composer-input`, **plus** the existing non-selection E2E coverage of `/`, `@` and attachments in `composer-advanced.spec.ts` staying green — that part of the suite is drivable and is the regression proof. |
| 280-A6, A7, A10 (serialization, store transitions) | pure unit tests, no DOM. |
| 280-A9, A11 (migration, testids, budgets) | unit tests + typecheck/lint; the dead-code removals are verified by grep assertions in review, not by a runtime test. |
| 274-A1…A8, A10 | Playwright is fine — `click({ button: 'right' })` is already used in `editor-comments-review.spec.ts` and `sessions-rows.spec.ts`. 274-A9/A11 are unit/jsdom. |

The three skipped tests in `composer-advanced.spec.ts` reference `composer-quote-preview` / `composer-quote-dismiss`. Those testids survive (now per-segment, with `data-segment-id`), so their selectors are updated in place while they remain skipped — a skipped test must not also be silently wrong. The `QuoteBlock` skip is deleted with `QuoteBlock` itself.

### #280 acceptance criteria

- [ ] **280-A1** Selecting text inside one assistant message shows the floating toolbar with exactly two actions in order: `Quote`, `New session`, with the settled testids; selections spanning two messages show no toolbar (existing behavior, pinned).
- [ ] **280-A2** Clicking either toolbar button does not clear the selection before the action runs (mousedown preventDefault); after the action, the selection is cleared and the toolbar is gone.
- [ ] **280-A3** Quote appends a segment (pill + its own comment box) at the bottom of the composer and focuses that box; a second Quote appends a second segment below the first. Quotes from different messages mix in one send. When the live box held text at the moment of quoting, that text stays above the new pill as the previous segment's prose and the new box is empty (never duplicated, never left below the quote).
- [ ] **280-A4** The live (last) segment's box is the native composer input: `/` skills, `@` files, highlight, attachments, and Enter-to-send/queue all work there; `chat-composer-input` stays on it.
- [ ] **280-A5** Dismissing a quote keeps that segment's typed prose as an unquoted paragraph; dismissing a quote on an empty segment removes the segment; with no segments left the composer renders exactly as today. Both cases are addressed by `data-segment-id`, not by ordinal position.
- [ ] **280-A6** Send serializes segments per §2.3 through the pure serializer, whose test file holds these hardcoded vectors: the worked example above; single quote + comment (byte-equal to today's `> q\n\nbody`, migrated from `parse-send-input-quote.test.ts`); quote with empty comment; dismissed-quote prose paragraph; multiline quote (`> ` on every line); quote-only send with empty live box; and text typed in the live box before a quote is appended (serializes `intro\n\n> Q`, never `> Q\n\nintro`).
- [ ] **280-A7** Sending clears all segments and the native draft in the same step; the segments of thread A are still there after switching to thread B and back (within the app session).
- [ ] **280-A8** `New session` opens a new-thread draft in the **source chat's** project — regardless of the sidebar project filter, including the "All" view, which must not open the project picker — with the composer containing exactly the raw selection as plain text (any text left in the reused draft slot is replaced). Nothing is auto-sent; no chat is created until the first send; the source chat's worktree is not inherited; a differing project filter is cleared.
- [ ] **280-A9** `EditorContextMenu`'s "Add Agent Context" appends a quote segment (same store) instead of `setQuote`; nothing writes `metadata.custom.quote`; and the leftovers listed in §2.3 are gone: `parseSendInput`'s quote branch and `quoteText`, `ComposerQuotePreview`, `SelectionToolbarQuote`, `QuoteBlock` (+ its e2e skip), and `hasQuote`.
- [ ] **280-A10** Serialization and segment-store transition logic (append incl. the commit-and-clear step, dismiss, clear-on-send, per-thread keying, segment-id minting) live in pure non-React modules with unit tests; components consume them.
- [ ] **280-A11** All new interactive elements carry the settled testids and per-segment elements carry `data-segment-id`; files stay ≤300 lines / functions ≤50 (decompose `AssistantMessage`/`Composer` additions into sibling files as needed); only real `mf-*` tokens, no `/opacity` on CSS-var colors.

---

## Decisions

Rulings made in this spec (design-approved points are not repeated here). 1–13 were the original set; 3, 4, 11 and 12 were revised and 14–21 added in rev 2.

1. **Relative path comes from the shipped normalizer** — `toFileRef` + `useActiveBasesStore`, i.e. worktree base first then project base, rather than a single hard root. Copy and open consume one code path, so they cannot disagree.
2. **Prose paths stay out; follow-up todo** — adopted the brief's recommendation; #274 covers `ClickableFilePath` only.
3. **Degraded paths copy the stored string, and that now falls out of `toFileRef`** — external and base-less inputs return `relative === absolute === stored`, so both items work and degrade predictably with no disabled/error state. (Revised: previously a hand-written rule that diverged from the helper.)
4. **Path logic lives in the existing `lib/files/file-ref.ts`** — the root rule says "pure logic in core", but `mainframe-core` is orphaned post-cutover and this logic already ships in `packages/ui`'s shared lib, unit-tested. Only the relative→absolute join is added. (Revised: previously a new module restating four rules.)
5. **Disabled-item copy: `No actions available`**, testid `chat-menu-empty` — production wording for the design's "single disabled item".
6. **Menu wrapper on assistant messages only** — the only messages that render `ClickableFilePath`.
7. **Serialization contract (§2.3)** — blockquote-per-segment joined by blank lines; single-quote output byte-compatible with today; quote-only sends allowed.
8. **Segment store lifecycle** — per-thread key, survives in-session thread switches, cleared on send, not persisted across restart; mirrors the native draft's lifetime.
9. **Earlier-segment editing** — plain textarea semantics; Enter is a newline; only the live input submits.
10. **Producer migration + dead-code removal** — `EditorContextMenu` moves to segment append; every leftover named in §2.3 is deleted in the same pass.
11. **New session follows the sidebar *picker* flow, not ⌘N** — project comes from the source chat, adapter from the global `defaultAdapterId`, no worktree inheritance; a differing project filter is cleared; the ordering is extracted into one shared module. (Revised: the ⌘N reference resolved the project from ambient filter state and could have sent into the wrong project; the `use-start-todo-session` reference created a real chat.)
12. **Variant E triggers are stated as observable affordance loss, and the Send/Enter replacement is pre-authorized** — the previous "no reimplementing primitive behavior" trigger fired on the very change quote-only sends require, mandating the rejected variant. (Revised.)
13. **No daemon/Rust work** — serialization keeps the send payload a plain string on the existing path; explicitly no contract change, so daemon parity requirements don't apply.
14. **Serialization carrier: the append call site, not `metadata.custom.segments`** — `parseSendInput` runs in a non-React class that cannot read a React store without the forbidden `getState()` reach-through; serializing in the composer keeps the message shape unchanged and lets the quote branch die outright. The metadata route was verified viable (`append` forwards caller metadata) and rejected on coupling, not feasibility.
15. **Quoting with a non-empty live box moves that text up into the committed segment and clears the native input** — the alternatives are wrong output order (`> Q\n\nintro`) or duplicated text. Chosen because it preserves what the user typed *and* the order they typed it in; it is the same step as the empty-box case, so there is one code path.
16. **The reused new-thread slot's leftover text is replaced by the prefill** — the slot holds an abandoned draft, and `resetNewThreadDraft` already encodes "a fresh New reflects current context". Stated explicitly instead of happening silently. Flagged under Risks as the one place a user could lose typed text.
17. **Selection-gesture criteria are verified in jsdom/vitest; the E2E skip is not promised** — its cause is undetermined and lives in a primitive this feature keeps, so promising the unskip would be promising an investigation this spec does not scope.
18. **The "quote pending" placeholder becomes a per-box rule** — a box under a quote reads `Add a message…`, the quoteless box reads `Reply to Mainframe…`. Preserves today's cue exactly for the single-quote case and generalizes to N segments, instead of letting the cue vanish with `s.composer.quote`.
19. **Nested transcripts are discriminated by a React context, not a second components map** — one `components` map stays canonical and the rule survives arbitrary nesting depth.
20. **Segments carry an opaque `data-segment-id`; testid names stay stable** — satisfies "keyed by domain id, not array index" without inventing per-segment testid strings, and keeps the shipped `composer-quote-preview` / `composer-quote-dismiss` names (and the skipped e2e selectors) meaningful.
21. **Segments clear at dispatch, with no archive/delete hook** — parity with the native draft, which already clears without awaiting the send; and there is no client-side archive event to hang a cleanup on, so the clause was dropped rather than faked.

## Risks and flagged conflicts

- **The per-message menu shadows the WebView's native context menu** inside assistant messages: right-clicking a text selection now yields our menu with a single disabled item instead of the WKWebView menu (Copy / Look Up). The floating toolbar and ⌘C remain the copy paths. This is the approved arbitration (`setPath(hasSelection ? null : …)` + disabled-item fallback) taken literally; if the loss of native right-click Copy on selections proves annoying, the one-line alternative is to `stopPropagation()` when a selection exists so the native menu shows — flagged for the user, not implemented.
- **Global-selection suppression:** `window.getSelection()` is document-wide, so a selection left in the Files editor pane suppresses path copy in the thread until it's cleared. Accepted (approved snippet is global); listed so QA doesn't file it as a bug.
- **Send-failure loss is pre-existing, not new:** a failure inside `onNew` (notably `createForLocal` for a brand-new thread) discards the composition, because the composer clears at dispatch. Today that already loses the typed draft; segments now go with it. Not fixed here — fixing it means changing the shipped clear-on-dispatch behavior for everyone, which is its own todo.
- **Abandoned new-thread draft text is replaced** by the New-session prefill (Decision 16). The window is narrow (an unsent draft in the reused local slot) but it is the one path in this feature where typed text disappears without a prompt.
- **assistant-ui pin:** everything here must land on `@assistant-ui/react@0.14.27` exactly; no bump is in scope. The Send/Enter replacement and `append()` usage are composition against that version's public client surface, not patches to it.
- **`composer().reset()` also clears `runConfig`**, so `submitComposition()` must read `runConfig` before resetting and pass it into `append` — otherwise a per-send run config would be silently dropped.
