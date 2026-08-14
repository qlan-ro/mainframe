# Todo #336 — pin the interactive gate above the composer

**Branch:** `todo/336-pinned-permission-prompts` · **Package:** `@qlan-ro/mainframe-ui` only · **Route:** no-spec (works from the todo's Agent Brief)

## Goal

An unanswered gate — permission card, AskUserQuestion wizard, or plan card — currently renders at the tail of the
scrolling transcript column, so a user who has scrolled up to re-read a diff never sees the card that is blocking the
run. Move the single `ChatGateMount` out of the transcript content column and into the thread's existing sticky
`ThreadPrimitive.ViewportFooter`, directly above the worktree banner and composer, wrapped in a height-capped slot that
scrolls internally. Dispatch logic, the queue-front-only rule, the `ReplyFn` signature, the optimistic-drop plus
delayed re-read, and every existing gate testid stay exactly as they are: this is a placement change and nothing else.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file and 50 lines/function; `data-testid` on every interactive element as
  `<surface>-<element>` kebab-case; comments say *why*; changeset required before commit; no leftovers.
- `packages/ui/CLAUDE.md`: read the `mainframe-design-system` skill before writing class names; assistant-ui owns
  behavior, shadcn owns pixels — reuse the shipped `ViewportFooter` primitive rather than building a pinned overlay.
- Out of scope (from the brief): gate content/copy/actions, the queue model, the running indicator's placement,
  transcript auto-scroll behavior including the session-switch tail pin, and any daemon/WS contract change.

## Established facts

Each line is a behavior verified while planning, with its receipt. Downstream work should trust these rather than
re-deriving them.

1. `ThreadPrimitive.ViewportFooter` measures `offsetHeight + marginTop` and registers it as the viewport's content
   inset through a `ResizeObserver` — anything mounted inside it re-measures the inset with no new machinery.
   Receipt: `node_modules/.pnpm/@assistant-ui+react@0.15.13_*/node_modules/@assistant-ui/react/src/primitives/thread/ThreadViewportFooter.tsx:47-55`
   and `.../src/utils/hooks/useSizeHandle.ts:17-42` (ResizeObserver + `setHeight`).
2. Content-inset heights are summed across multiple registered footers (`.../src/context/stores/ThreadViewport.ts:17-49`,
   `:104`, `:217`). A second `ViewportFooter` for the gate is therefore *possible* but rejected: two sticky siblings
   would need the gate's `bottom` offset to track the composer's dynamic height. One footer, two children, is simpler.
3. The viewport's autoscroll watches its own subtree with a `MutationObserver` on `childList`/`subtree` plus a
   `ResizeObserver`, and re-scrolls **only when `isAtBottom`** is already true.
   Receipts: `.../src/utils/hooks/useOnResizeContent.tsx:6-33` (observer options) and
   `.../src/primitives/thread/useThreadViewportAutoScroll.ts:156-185` (`isAtBottom` guard before `scrollToBottom`).
   Consequence for two acceptance criteria at once: a gate mounting inside the footer never moves a scrolled-up
   viewport, and for an at-bottom viewport it re-pins so the last message is not hidden behind the taller footer.
4. `use-thread-bottom-pin.ts` observes only the transcript **content** element (`contentRef`, wired at
   `packages/ui/src/features/chat/thread/ChatThread.tsx:167`) and re-pins only when `pinned.current` is true
   (`packages/ui/src/features/chat/thread/use-thread-bottom-pin.ts:40-54`). The footer was never inside its observed
   subtree, so this hook needs **no change** — fact 3 covers footer growth.
5. The gate card shell has no width of its own (`packages/ui/src/features/chat/gates/shared/GateShell.tsx:31-38`), and
   the footer's inner wrapper carries the same width recipe as the transcript column
   (`ChatThread.tsx:167` vs `ChatThread.tsx:194`). Mounting the gate inside `chat-thread-footer` preserves the e2e
   width-parity assertion `expectGateMatchesComposerWidth` (`packages/e2e/tests-tauri/gates.spec.ts:31-40`).
6. `useChatPermissionFront` derives the front entry from the *rebound* `extras` of the thread context
   (`packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts:287-301`), and `ChatZone` gives each split zone
   its own `AuiProvider` with its own `extras` and its own `ChatThread`
   (`packages/ui/src/features/chat/zones/ChatZone.tsx:75-120`). Per-zone containment is therefore automatic.
7. The stock shadcn card in this repo already ships the Tailwind v4 `has-data-[slot=…]:` variant
   (`packages/ui/src/components/ui/card.tsx:19`), so a parent can react to a child slot's presence with no JS.
8. Scrollbars are styled globally for every element (`*::-webkit-scrollbar { width: 8px }` under an `@supports`
   guard, `packages/ui/src/styles/app.css:59-73`). Styling `::-webkit-scrollbar` at all makes Chromium and WebKit
   paint a **classic, layout-consuming** scrollbar: 8px comes out of the scroll container's content box, so any
   block child of a new scroll container is 8px narrower than the container's padding box while it overflows.
   The repo's opt-out is `[scrollbar-width:none]` — the standards property, which suppresses the webkit custom
   scrollbar and reserves no space. Three shipped call sites:
   `packages/ui/src/components/ui/attachment.tsx:161-162` (which names it "app.css's opt-out idiom"),
   `packages/ui/src/layout/WorkspaceTabStrip.tsx:47`, `packages/ui/src/features/session-tabs/SessionTabs.tsx:143`.
9. The composer's own growth is capped at `max-h-48` (192px) on its scroll wrapper
   (`packages/ui/src/features/chat/composer/Composer.tsx:167-168`), and the plan gate already caps its markdown body at
   `max-h-[300px]` with internal scrolling (`packages/ui/src/features/chat/gates/PlanGate.tsx:36`) — nested scrolling
   inside the new slot is an existing pattern, not a novelty.
10. The Tauri window's minimum size is 800×600 (`packages/app-tauri/src-tauri/tauri.conf.json:22-23`), which bounds how
    short an e2e window can be made to force transcript overflow.
11. `ChatGateMount` renders `null` when there is no queue front (`packages/ui/src/features/chat/gates/ChatGateMount.tsx:24`),
    and `ChatGateMount.test.tsx` asserts `expect(container).toBeEmptyDOMElement()` in that case
    (`packages/ui/src/features/chat/gates/__tests__/ChatGateMount.test.tsx:103`, `:176`) — the slot wrapper must live
    *inside* `ChatGateMount`, below the `if (!front) return null` guard, so no empty container is ever rendered.
12. `packages/ui/src/features/chat/thread/__tests__/ChatThread-degraded-placement.test.tsx:79-120` is the shipped
    precedent for asserting footer placement in jsdom (`card.closest('[data-testid="chat-thread-footer"]')` plus a
    "not inside `tp-messages`" counter-assertion). The new placement test mirrors it.
13. Gate/composer width parity survives today only because the sticky footer sits **inside** the scrolling viewport
    (`ChatThread.tsx:158-198`): the transcript column and `chat-thread-footer` carry the same
    `mx-auto w-full max-w-[min(48rem,100%-116px)] px-5` recipe *inside the same scroll container*, so the viewport's
    8px scrollbar narrows both equally and the edges still coincide. The pinned slot is the first scroll container
    that would narrow only the gate's side of that pair — which is why fact 8 is load-bearing here and was not
    before.

## Decisions

- **All three gates pin.** They come through one mount and one queue; splitting the behavior would mean two placements
  to reason about. (Brief's recommendation, adopted.)
- **The slot lives inside the existing `ViewportFooter`, above `WorktreeSwitchBanner`.** The banner annotates the
  composer and stays adjacent to it. No second footer (fact 2), no portal, no new measurement (facts 1 and 3).
- **Height cap: `max-h-[55%]` on the footer, engaged only while a gate is mounted, via
  `has-data-[slot=chat-gate-slot]:`.** Rationale: a percentage `max-height` on the *slot* would silently compute to
  `none`, because its containing block (the auto-height footer) has an indefinite height; the footer itself is a flex
  item of a viewport whose height is definite (`flex-1` inside the `h-full` root), so a percentage resolves there.
  `vh` units are wrong — the chat surface can share the window with the workspace strip, so window height is not thread
  height. 55% of the footer minus a resting composer (~90px) leaves the gate roughly 45% of the thread, which is the
  brief's target, and guarantees the transcript keeps at least 45%. Gating the cap on slot presence keeps a tall
  composer draft from being squeezed on a short window when no gate exists (fact 7 gives the idiom).
  *Fallbacks, in order, if the live render in Task 7 shows the cap not engaging:* (a) `max-h-[45cqh]` on the slot with
  `[container-type:size]` on `ThreadPrimitive.Root`; (b) read `useChatPermissionFront().front != null` in `ChatThread`
  and toggle the cap class in JS (this costs a mock extension in four `ChatThread*` test files). Record which one
  shipped in the changeset if the primary is abandoned.
- **The slot needs 4px of internal padding with a matching negative margin** (`-mx-1 px-1 py-1`). `overflow-y-auto`
  makes the other axis compute to `auto` as well, which would clip the card's `ring-3` accent; the padding gives the
  ring room while the negative margin keeps the card's own edges aligned with the composer (fact 5's e2e assertion).
- **The slot suppresses its own scrollbar with `[scrollbar-width:none]`.** This is the finding that sent the plan back
  for revision, so the geometry is written out. A scrolling slot paints the global 8px classic scrollbar (fact 8),
  which comes out of its content box: with `-mx-1 px-1` the card's left edge stays at `wrapper.left`
  (`−4px` margin + `4px` padding) while its right edge lands at `wrapper.right + 4 − 8 − 4 = wrapper.right − 8`.
  That 8px delta breaks `expectGateMatchesComposerWidth` (`packages/e2e/tests-tauri/gates.spec.ts:31-40`, tolerance
  1px on **both** edges) exactly when the AC requires the slot to scroll — including in the *existing*
  `§permission gate details` test, whose second parity call (`gates.spec.ts:81`) runs with Details expanded and the
  workspace open, a card of roughly 250px against a slot budget of roughly 210-240px. `[scrollbar-width:none]`
  removes the cost instead of compensating for it: the content box equals the padding box in **both** the scrolling
  and the resting state, so one symmetric `-mx-1 px-1` keeps parity exact and no assertion tolerance moves.
  Cost: the slot scrolls with no visible scrollbar. Accepted — the collapsed card does not overflow at all, the
  action row stays reachable by scrolling (wheel, trackpad, keyboard), and Task 7 case 1 verifies reachability.
  *Fallbacks, in order:* (a) if WKWebView still paints a scrollbar (a macOS below Safari 18.2 has no
  `scrollbar-width` support), add `[&::-webkit-scrollbar]:w-0` — the repo has no arbitrary-pseudo-variant precedent,
  so this is a fallback, not the opener; (b) if the cut edge reads as the end of the card, add a bottom fade mask
  (`mask-image` linear-gradient) to the slot — it costs no layout width, so parity is unaffected either way.
- **No entrance animation, no transcript marker, no auto-scroll on gate arrival.** All three are the brief's
  recommendations and all three are already satisfied by doing nothing (fact 3).
- **`use-thread-bottom-pin.ts` is not touched** (fact 4).

## Tasks

### Group A — red-phase placement tests (test)

**Task 1 — new unit test: the gate mount renders in the sticky footer, not the transcript column.**
File: `packages/ui/src/features/chat/thread/__tests__/ChatThread-gate-placement.test.tsx` (new).
Mirror the harness of `ChatThread-degraded-placement.test.tsx` exactly (same `vi.mock` block, same
`ThreadPrimitive` stub exposing `tp-messages` and `tp-viewport-footer`, `ChatGateMount` stubbed as
`<div data-testid="gate-mount-stub" />`). Assert:
- `screen.getByTestId('gate-mount-stub').closest('[data-testid="chat-thread-footer"]')` is not `null`;
- `screen.getByTestId('tp-messages')` does not contain the stub, and neither does the transcript content wrapper;
- the stub precedes `chat-composer` in document order
  (`stub.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING`).
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/thread/__tests__/ChatThread-gate-placement.test.tsx`
**fails** on the placement assertions (the mount is still in the content column). Record the failure output in the
task's completion note.

**Task 2 — extend `ChatGateMount.test.tsx` with the pinned-slot wrapper contract.**
File: `packages/ui/src/features/chat/gates/__tests__/ChatGateMount.test.tsx` (edit; keep every existing case).
Add cases:
- with a permission front, `chat-thread-gate-slot` exists and contains `chat-permission-gate`;
- the same for `chat-question-gate` (AskUserQuestion front) and `chat-plan-gate` (ExitPlanMode front);
- with `front: undefined`, `queryByTestId('chat-thread-gate-slot')` is `null` and the container is still empty
  (fact 11);
- a front that clears and then returns (the delayed re-read restoring a dropped reply) re-mounts the slot with the
  same gate — rerender with `front: entry → undefined → same entry`;
- the slot element carries the classes the cap and the width parity depend on: `data-slot="chat-gate-slot"`,
  `overflow-y-auto`, `[scrollbar-width:none]`, `min-h-0`, `flex-1`. State in a comment that this is a class-string
  regression check only — the real geometry is verified in Tasks 7 and 9 — and that dropping
  `[scrollbar-width:none]` costs 8px of card width whenever the slot scrolls (fact 8).
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/ChatGateMount.test.tsx`
**fails** on the new cases and **passes** every pre-existing case.

### Group B — the placement change (ui)

**Task 3 — `ChatGateMount` renders the pinned slot around the dispatched card.**
File: `packages/ui/src/features/chat/gates/ChatGateMount.tsx` (edit).
Below the existing `if (!front) return null` guard, wrap the dispatched card in:

```
<div
  data-testid="chat-thread-gate-slot"
  data-slot="chat-gate-slot"
  className="-mx-1 mb-2 min-h-0 flex-1 overflow-y-auto px-1 py-1 [scrollbar-width:none]"
>
  {card}
</div>
```

Keep the dispatch table, the adapter lookup, the `reply` passthrough, and every existing testid untouched. Refactor
the three `return` branches into a single `card` value so the wrapper is written once. Update the component's
docstring: it no longer renders "inline at the thread tail" — say where it renders now and why the padding/negative
margin pair exists (ring clipping), one line each. Add one line for `[scrollbar-width:none]`: an 8px classic
scrollbar would come out of the card's width and break the composer parity the gates e2e asserts.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/ChatGateMount.test.tsx`
passes, including Task 2's new cases; file stays under 300 lines.

**Task 4 — move the mount into the sticky footer and build the shrink chain.**
File: `packages/ui/src/features/chat/thread/ChatThread.tsx` (edit).
- Delete `<ChatGateMount />` from the transcript content `div` (currently line 175); keep the import.
- On `ThreadPrimitive.ViewportFooter`, add `min-h-0` and `has-data-[slot=chat-gate-slot]:max-h-[55%]` to the existing
  `sticky bottom-0 mt-auto flex flex-col bg-background`.
- On the inner `chat-thread-footer` wrapper, add `flex min-h-0 flex-col`; keep `mx-auto w-full max-w-[min(48rem,100%-116px)] px-5 pb-4` unchanged so width parity holds (fact 5).
- Render `<ChatGateMount />` as the wrapper's first child, above `<WorktreeSwitchBanner />`.
- Wrap `<WorktreeSwitchBanner />` + `<ThreadFooterInput />` in a `shrink-0` `div` so only the gate slot shrinks when
  the cap engages.
- Update the file's top docstring: it currently says the composer sits in a `ViewportFooter` — add that the pending
  gate shares that slot above it, capped and internally scrolling. Update the stale comment on line 171-172 only if
  it now misstates anything (the running indicator stays inline; leave it alone otherwise).
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/thread/__tests__/ChatThread-gate-placement.test.tsx`
passes; file stays under 300 lines.

**Task 5 — no-regression sweep over the sibling thread tests.**
Files: `packages/ui/src/features/chat/thread/__tests__/ChatThread.test.tsx`,
`ChatThread-degraded-placement.test.tsx`, `ChatThread-compacting.test.tsx`, `ChatThread-composer-gate.test.tsx`
(read-only unless one genuinely breaks).
Run all four plus the four gate suites (`PermissionGate`, `AskUserQuestionGate`, `PlanGate`, `gate-kit`). If one fails
only because the gate stub moved, fix the assertion in place — do not weaken a test to make it pass, and do not touch
`use-thread-bottom-pin.test.tsx` (fact 4).
Verify: each file green via `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (one file per invocation —
large batches hit the cross-file `React.act` failure).

**Task 6 — changeset.**
File: `.changeset/<generated-name>.md` (new). `pnpm changeset`, patch bump for `@qlan-ro/mainframe-ui`, one sentence in
the user's voice: an unanswered permission or question now stays above the composer instead of scrolling away.
Verify: the file exists and names `@qlan-ro/mainframe-ui` with `patch`.

**Task 7 — live-render verification (required; jsdom cannot check this geometry).**
No file. Run `pnpm tauri:dev` from `packages/app-tauri` in the background with output to a log file, using a
throwaway `MAINFRAME_DATA_DIR` and a non-31415 `DAEMON_PORT` (never hijack the production daemon). Check, with the
window resized to roughly 1200×600:
1. a permission gate with its Details disclosure expanded — the slot scrolls internally, the composer stays put, the
   transcript keeps its majority of the pane. Three extra checks here, because this is the case the width-parity
   finding turns on: **no scrollbar renders inside the slot** (WKWebView is the engine `[scrollbar-width:none]` is
   unproven on — Playwright's Chromium is covered by Task 9); the card's left and right edges still line up with the
   composer's *while the slot is scrolled*; and the action row (`Deny` / `Allow once`) is reachable by scrolling the
   slot. If a scrollbar renders, take fallback (a); if the cut edge reads as the end of the card, take fallback (b);
   both are spelled out under Decisions;
2. a long plan gate — same, and the card's tinted ring is not clipped on any edge;
3. scroll the transcript to the top, raise a gate, confirm the transcript does not move and the gate is fully visible;
4. answer it, confirm the slot disappears and the transcript reclaims the space;
5. open the split view, raise a gate in one zone, and confirm it pins in that zone only — the other zone's footer is
   unchanged (fact 6 predicts this; this is the acceptance criterion's verification step).
If the cap does not engage, fall back in the order given under Decisions and note which fallback shipped.
Verify: record the five observations in the completion note; attach a screenshot for cases 1 and 2.

**Task 8 — typecheck.**
Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck` is clean.

### Group C — e2e coverage (test)

**Task 9 — new e2e case: the gate stays in the viewport while the transcript is scrolled up.**
File: `packages/e2e/tests-tauri/gates.spec.ts` (edit — new `test.describe('§gate pinned slot')` block; add
`chat-thread-gate-slot` to the testid reference comment at the top of the file).
Recipe:
- `launchTauriApp({ recordingKey: 'permissions-stacked' })` — that recording raises two sequential permission gates in
  one run (existing `§gate queue-front` block, `gates.spec.ts:287-323`), so the transcript grows between them.
- `await page.setViewportSize({ width: 1200, height: 600 })` before sending (the Tauri minimum, fact 10) so the
  transcript overflows with one turn.
- Send, wait for `chat-permission-gate`, then assert the card is inside the pinned slot and the slot is inside the
  footer: `expect(page.getByTestId('chat-thread-gate-slot').locator('[data-testid="chat-permission-gate"]')).toBeVisible()`
  plus a `closest('[data-testid="chat-thread-footer"]')` evaluate.
- Assert the viewport actually overflows
  (`scrollHeight - clientHeight > 8` via `page.getByTestId('chat-thread-viewport').evaluate(...)`) — this is a
  precondition, and it must be an assertion, not an `if`. If it does not hold with one turn, answer gate 1 first and
  run the checks against gate 2, whose transcript is longer.
- **With the card collapsed** (Details closed, so the slot does not overflow), scroll the viewport to the top with
  the `scrollViewportToTop` recipe from `packages/e2e/tests-tauri/transcript.spec.ts:77-82`, then assert:
  `chat-permission-gate` is `toBeInViewport()`, `chat-permission-allow-once` is `toBeInViewport()` and clickable, and
  the viewport's `scrollTop` is still 0 after a short settle (the transcript offset was not moved). Order matters:
  run these before expanding Details. An expanded card can push the action row below the slot's fold, which would
  fail `toBeInViewport()` for a reason this phase is not testing.
- **Then force the slot to overflow and re-check parity** — this is the phase that guards the scrollbar suppression
  (Decisions; fact 8). Click `chat-permission-details-toggle`, wait for `chat-permission-details-pre`, and assert the
  **slot** actually scrolls — `page.getByTestId('chat-thread-gate-slot').evaluate((el) => el.scrollHeight - el.clientHeight > 0)`.
  This is a precondition and must be an assertion, not an `if`: without it the parity check that follows passes
  vacuously. If one turn does not overflow the slot at 1200×600, shrink the window height further or open the
  workspace strip (`surface-rail-workspace`, the narrowing trick `gates.spec.ts:79-85` already uses) rather than
  dropping the check. Then call `expectGateMatchesComposerWidth` in that scrolling state.
- Answer the gate and `waitForIdle`, so the block leaves the app idle like every neighbouring describe.
- Keep `expectGateMatchesComposerWidth` in the block. It now guards two things at once: the negative-margin/padding
  pair, and `[scrollbar-width:none]` — dropping the latter costs 8px on the right edge against a 1px tolerance, and
  only the overflowing phase above catches it. Note in the block's comment that the pre-existing
  `§permission gate details` test (`gates.spec.ts:59-90`) now exercises the same contract incidentally: its second
  parity call at `:81` runs with Details expanded and the workspace open, where the slot may already be scrolling.
  That coverage is intended, not luck — do not "simplify" it away.
Verify: `pnpm test:e2e -- gates.spec.ts` green (batch the e2e run at the end of the series, per house practice).

## Risks

- **The `:has()`-gated percentage cap is the one unproven mechanism.** Facts 7 and the flex reasoning make it likely,
  but only Task 7's live render settles it; two ordered fallbacks are written down so the implementer never has to
  re-derive the analysis.
- **`overflow-y-auto` clipping the accent ring** is the most likely cosmetic surprise; the padding/negative-margin
  pair is specified, and both the e2e width assertion and Task 7's case 2 catch a mistake.
- **E2E overflow is environment-sensitive.** The precondition assertion makes a non-overflowing window fail loudly
  rather than pass vacuously. The slot's own overflow is the marginal one — the expanded permission card clears the
  cap by only tens of pixels — so Task 9 asserts `scrollHeight > clientHeight` on the slot itself rather than
  inferring it from the viewport.
- **`scrollbar-width` support differs by engine.** Chromium honors it over `::-webkit-scrollbar` (and is what the
  e2e runs on, so Task 9's overflowing-phase parity check guards it); WKWebView needs Safari 18.2 or newer. The three
  shipped call sites in fact 8 are the in-app precedent, Task 7 case 1 is the explicit check, and fallback (a) is one
  class.
- **A scrolling slot has no visible scroll affordance.** The action row can sit below the fold on a tall gate with
  nothing pointing at it. Task 7 case 1 checks reachability; fallback (b) is a bottom fade mask. If it turns out to
  bite in practice, the larger follow-up — pinning the card's head and actions and scrolling only its body — is a
  separate change to `GateShell` plus all three gates, deliberately out of this plan's scope.
