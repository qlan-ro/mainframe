# Todo #298 — Long lines escape the user bubble (implementation plan)

**Route:** no-spec (plan works from the approved Agent Brief)
**Branch:** `todo/298-user-bubble-long-lines` · **Worktree:** `.worktrees/todo-298-user-bubble-long-lines`

## Goal

A user turn renders inside a card capped at `max-w-[470px]`, but nothing in that card's subtree opts into word breaking: `CoolCard` (`UserMessage.tsx`), the queued bubble (`QueuedUserTurn.tsx`), and `PlanBubble.tsx` set no `overflow-wrap`, the shared markdown map sets none, and `globals.css` sets no global default (verified: the only `break-words`/`break-all` declarations in `packages/ui` live in tool cards, the settings pane, and the files tab strip). A token longer than the card — a URL, an absolute path, a long inline-code span, a hash — therefore cannot wrap, and the line box paints past the card border across the transcript. The plan bubble hides the same defect behind `overflow-hidden`, clipping the content instead. This plan adds `break-words` (`overflow-wrap: break-word`) to the three card shells so a word that cannot fit is broken and only such a word, drops the plan bubble's `overflow-hidden` so a future containment bug surfaces instead of being clipped, and proves containment with a real-layout Playwright measurement, since jsdom computes no layout.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file, 50/function; `data-testid` as `<surface>-<element>` kebab-case; changeset required; tests required.
- `packages/ui/src/features/chat/messages/UserMessage.tsx` is **280 lines** — the change must stay a class edit plus one attribute, not a new block.
- `packages/ui/CLAUDE.md`: use only `mf-*` tokens that `@theme inline` maps. `break-words` is a stock Tailwind utility (present in the installed `tailwindcss@4.3.3` — verified alongside `wrap-break-word`/`wrap-anywhere`), and the repo already uses `break-words` in `ToolResultExpand.tsx`, `SearchCard.tsx`, and `PushNotificationCard.tsx`, so it is the consistent spelling.
- The mock adapter replays one recording per session and consumes it **by cursor**: a send with no remaining `in` marker fails the turn with a "Re-record" desync error (`packages/core-rs/crates/mainframe-adapter-mock/src/session.rs`). `thread.0.ndjson` currently holds exactly 2 `in` markers and `tests-tauri/transcript.spec.ts` spends both, so a third e2e send requires a third recorded turn.
- Recorded `delayMs` is absolute per file; the replayer subtracts the turn's own `in`-marker delay as the base, so an appended turn's out-events must carry delays *relative to that new marker's* value.
- `packages/e2e/fixtures/recordings/thread.0.ndjson` is shared with `review-panel.spec.ts` and `editor-comments-review.spec.ts`. Appending is safe because both stop before the new events, but nothing existing in the file may be edited.

## Decisions

- **D1 — `break-words`, not `break-all`/`wrap-anywhere`.** The brief calls for breaking only words that cannot fit. `overflow-wrap: break-word` breaks a word only when it alone overflows the line box; `word-break: break-all` would rewrap ordinary prose and change every bubble's shape. `wrap-anywhere` additionally shrinks the intrinsic min-content size, which is not needed here and has the same rewrap risk.
- **D2 — The class goes on the three card shells, per the brief.** `overflow-wrap` is inherited, so one class per shell covers prose, links, inline code, the `SlashPill` branch, and the read-more clamp's `-webkit-box` content div. The shared markdown map (`parts/markdown-text.tsx`) is **not** touched, so assistant rendering is byte-identical and the brief's "check assistant messages" clause does not apply.
- **D3 — The clamp is unaffected.** `ReadMore` clamps by character count (`measureText.length > 600`), not by measured lines, and the collapsed box is `-webkit-line-clamp: 4`. Breaking a word changes neither the threshold nor the line count for ordinary messages, whose words already fit.
- **D4 — The brief's fenced-code claim does not hold for user turns; the AC is satisfied by *assistant* messages, which we do not touch.** `markdownComponents.pre` is `({children}) => <>{children}</>` and `Code` branches on `useIsMarkdownCodeBlock()`, whose context (`PreContext`, `@assistant-ui/react-markdown@0.14.6`) is provided **only** by `MarkdownTextPrimitive`. `UserMessage` and `PlanBubble` render plain `react-markdown`, so a fence in a user turn or a plan body already renders as an *inline* code span with normal white space — it never scrolled horizontally there. `break-words` therefore wraps a long token inside it, which is exactly what AC "a long inline code span" demands. Assistant fences keep `SyntaxHighlighter`'s `overflow-x-auto` `<pre>` (`white-space: pre` suppresses `overflow-wrap` anyway) and are covered by the untouched `§transcript — code block` spec. The user-side fence-renders-as-inline-code mismatch is a **separate rendering bug — report it, do not fix it here.**
- **D5 — Two new `data-testid`s.** `chat-user-bubble` on `CoolCard` and `chat-queued-bubble` on the queued card. The e2e measurement needs a stable handle on the card box (today the only handle is `chat-user-message` on the flex column wrapper, whose width is the whole transcript), and the component tests need one that does not depend on `container.querySelector('.border-dashed')`. Both are consumed by tests added here, so neither lands in `UNUSED-TESTIDS.md`.
- **D6 — E2E measures the sent user bubble only; the queued bubble and the plan bubble are covered by class assertions.** All three share one inherited mechanism; producing a queued turn or an approved-plan turn in the harness costs additional recorded turns for no additional information about whether `overflow-wrap` works. The AC's "verified live or in an E2E spec" is met by the measured case.
- **D7 — `min-w-0` is deliberately not added.** The queued bubble is a flex item on the main axis, where `min-width: auto` normally lets an item exceed its `max-width`; per CSS Flexbox §4.5 the content-based minimum is capped by a definite max main size, so `max-w-[470px]` holds. If Task 10's negative control ever shows the queued card wider than 470px, add `min-w-0` there and record it — do not add it speculatively.
- **D8 — The send-failure paragraph gets the same class.** `chat-user-message-send-error` is a `max-w-[470px]` paragraph in the same component carrying daemon text that routinely contains long paths. It is the same defect in the same file; leaving it is a leftover.

## Out of scope (from the brief)

Bubble/transcript widths (#297) · truncating, ellipsising, or linkifying long tokens · read-more thresholds and clamp line count · tool-card and diff internals · the plan gate's duplicate rendering and approval propagation (#296) · fixing how user-message fences render (D4).

---

## Group A — red-phase component tests (`test`)

These run before any source edit and must be **observed failing**. Each asserts only class/attribute presence — never layout (jsdom has no layout engine).

### Task 1 — user bubble: containment class + testid

**File:** `packages/ui/src/features/chat/messages/__tests__/UserMessage.test.tsx` (617 lines — append to the existing describe; the file's mocks already render the real `CoolCard`)

1. Add a test `the user bubble opts into word breaking` that renders a plain text message with the existing fixture helper, then:
   - `expect(screen.getByTestId('chat-user-bubble').className).toContain('break-words');`
   - `expect(screen.getByTestId('chat-user-bubble').className).toContain('max-w-[470px]');` — pins that containment was added to the capped shell, not somewhere else.
2. Add a test `the send-failure detail wraps long tokens`: render the existing send-failure fixture (`metadata.custom.mainframe.error`), then assert `screen.getByTestId('chat-user-message-send-error').className` contains `break-words`.
3. Extend the file's header comment block with the new behavior codes, matching its existing `H5/H6/MD/PB` style.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/UserMessage.test.tsx` — both new tests fail (`chat-user-bubble` not found; no `break-words`). Every pre-existing test in the file still passes. Paste the failure output into the commit message.

### Task 2 — queued bubble: containment class + testid

**File:** `packages/ui/src/features/chat/messages/__tests__/QueuedUserTurn.test.tsx` (192 lines)

1. In the S1 block, replace `container.querySelector('.border-dashed')` with `screen.getByTestId('chat-queued-bubble')` and keep both existing assertions (`border-dashed`, `opacity-[0.82]`) against it.
2. Add to the same block: `expect(bubble.className).toContain('break-words')`.
3. Update the header comment's `S1` line to name the testid and the wrap class.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/QueuedUserTurn.test.tsx` — S1 fails on the missing testid. The other 7 behaviors pass.

### Task 3 — plan bubble: containment class, no clipping

**File:** `packages/ui/src/features/chat/messages/__tests__/PlanBubble.test.tsx` (27 lines)

1. Add a test `the plan card wraps long tokens instead of clipping them`:
   ```ts
   render(<PlanBubble plan="Some plan text" />);
   const card = screen.getByTestId('chat-plan-bubble');
   expect(card.className).toContain('break-words');
   expect(card.className).not.toContain('overflow-hidden');
   ```
2. Add a test `a long unbreakable token stays in the DOM` rendering `plan={'x'.repeat(200)}` and asserting the text node is present via `screen.getByText('x'.repeat(200))` — the clipping regression this replaces was invisible in the DOM, so this pins that containment never became truncation.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/PlanBubble.test.tsx` — the first new test fails on both assertions; the second passes already (it guards the fix, not the bug).

---

## Group B — containment on the card shells (`ui`, depends on Group A)

### Task 4 — `CoolCard` and the send-failure detail

**File:** `packages/ui/src/features/chat/messages/UserMessage.tsx`

1. In `CoolCard` (line ~75), add the testid and the class:
   ```tsx
   <div
     data-testid="chat-user-bubble"
     style={CARD_STYLE}
     className={cn(
       'relative max-w-[470px] rounded-xl border-[0.5px] px-[15px] py-[10px]',
       'border-mf-um-edge text-mf-um-ink',
       'text-body leading-loose tracking-tight break-words',
       className,
     )}
   >
   ```
   `break-words` joins the typography line so the shell's contract stays in one place. Do not add `overflow-hidden`.
2. On the send-error paragraph (line ~267), the class becomes `max-w-[470px] break-words text-right text-label text-muted-foreground` (D8).
3. In the file's header docblock, extend the "Visual contract" list with one line: `- long unbreakable tokens wrap (overflow-wrap) — the card is the containment boundary`.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/UserMessage.test.tsx` — green, including Task 1's two tests. File stays under 300 lines (`wc -l`).

### Task 5 — queued bubble

**File:** `packages/ui/src/features/chat/messages/QueuedUserTurn.tsx`

1. On the inner card `div` (line ~148), add `data-testid="chat-queued-bubble"` and append `break-words` to the first `cn` string, next to `text-body leading-loose tracking-tight`.

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/QueuedUserTurn.test.tsx` — green.

### Task 6 — plan bubble

**File:** `packages/ui/src/features/chat/messages/PlanBubble.tsx`

1. The root class becomes `max-w-[530px] break-words rounded-xl border-[0.5px] border-mf-um-edge text-mf-um-ink` — `overflow-hidden` is removed — the brief's call: keeping it would hide the next containment bug. Nothing in the card paints to its edge (the header has no background of its own, the body is divided by a `border-t`), and a markdown table inside the body is already clipped by its own wrapper's `overflow-hidden`, so removal cannot leak content past the corners.
2. Add one `why` comment above the class, one line: `// No overflow-hidden: clipping would hide containment bugs instead of surfacing them.`

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/messages/__tests__/PlanBubble.test.tsx` — green. Then confirm no other spec asserted the removed class: `grep -rn "overflow-hidden" packages/ui/src/features/chat/messages packages/e2e/tests-tauri` returns no `chat-plan-bubble` hit.

### Task 7 — changeset and the full message-suite run

**Files:** `.changeset/user-bubble-long-line-containment.md` (new)

1. Write the changeset by hand, matching `.changeset/always-show-branch-chip.md`'s shape:
   ```md
   ---
   '@qlan-ro/mainframe-ui': patch
   ---

   Keep long unbreakable text inside the user bubble.

   A message containing a token longer than the bubble — a URL, an absolute path, a long inline-code span — used to paint past the card's border and over the transcript, because neither the user card, the queued card, nor the approved-plan card opted into word breaking. All three now break a word that cannot fit, and only such a word: ordinary messages wrap exactly where they did before. The plan card no longer sets `overflow-hidden`, which was silently clipping the same content instead of showing it.
   ```
2. Run the message-folder suites one file at a time (`CLAUDE.md`: batch runs hit cross-file `React.act` failures):
   `UserMessage.test.tsx`, `UserMessage.session-chip.test.tsx`, `UserMessage-send-failure.test.tsx`, `QueuedUserTurn.test.tsx`, `PlanBubble.test.tsx`, `ReadMoreBubble.test.tsx`, `ReviewCommentCard.test.tsx`.
3. `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

**Verification:** all seven suites green; typecheck clean; `git status` shows only the six files this group and Group A own.

---

## Group C — real-layout containment proof (`test`, depends on Group B)

Harness cost, know it before starting: `fixtures/global-setup.ts` rebuilds `packages/ui` on every run unless `MF_E2E_SKIP_BUILD=1`, and `fixtures/daemon.ts` builds `mainframe-daemon` with `cargo build --release` if `packages/core-rs/target/release/mainframe-daemon` is missing — in a fresh worktree that is a multi-GB, multi-minute first build (root `CLAUDE.md`, Disk Hygiene). Build the daemon once up front, then keep the default (rebuilding) UI path so each run picks up the source edits Task 10 makes.

### Task 8 — a third recorded turn for the `thread` fixture

**File:** `packages/e2e/fixtures/recordings/thread.0.ndjson` (17 lines — **append only**, never edit lines 0–16)

1. Append four NDJSON lines modelled on the existing turn-2 events (lines 6, 8, 9, 14, 15). Copy the `onResult` args object verbatim from line 15 so its shape cannot drift; only `delayMs` and the message text change:
   - `{"dir":"in","method":"sendMessage","args":["<any text>","undefined","undefined"],"delayMs":18500}`
   - `{"dir":"out","method":"onInit","args":["b661e07b-021e-4254-9ed1-ea9987d94057"],"delayMs":18600}` (reuse the file's session id)
   - `{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"Noted."}]],"delayMs":18800}`
   - `{"dir":"out","method":"onResult","args":[<copy of line 15's object>],"delayMs":18900}`
   The `in` marker's text is never matched against what the test sends (the replayer only checks direction and method), so it may read as documentation of the turn's purpose.
2. Do **not** add an `onQueuedProcessed` event: the send happens while idle, so no queued ref exists to acknowledge, and a fabricated id would be meaningless. If Task 9's `waitForIdle` never settles, add one with a fresh UUID at `delayMs: 18700` and note it in the commit message.

**Verification:** `node -e "require('fs').readFileSync('packages/e2e/fixtures/recordings/thread.0.ndjson','utf8').trim().split('\n').forEach(l=>JSON.parse(l))"` parses all 21 lines; `git diff` shows additions only.

### Task 9 — the containment spec

**File:** `packages/e2e/tests-tauri/transcript.spec.ts` (append inside the existing `§transcript — thread turn` describe, after the last test that sends, so the recording is consumed in order)

1. Add the fixture text next to `LONG_TEXT`, documenting why each fragment is there:
   ```ts
   /** One ~200-char token, a long bare URL, a long absolute path and a long inline-code
    *  span — the four AC cases, all under ReadMoreBubble's 600-char threshold so the
    *  bubble renders UNCLAMPED (a collapsed clamp sets overflow:hidden and would hide
    *  the very spill this measures). */
   const UNBREAKABLE = 'A'.repeat(200);
   const OVERFLOW_TEXT = [
     UNBREAKABLE,
     `https://example.com/${'segment'.repeat(10)}`,
     `/Users/dev/${'deeply-nested-directory/'.repeat(4)}file.ts`,
     `\`${'x'.repeat(80)}\``,
   ].join(' ');
   ```
   The four fragments are 200 + 90 + 114 + 82 characters plus 3 join spaces = **489**, which leaves 111 characters of headroom under the 600 threshold. Keep it that way: the repeat counts are load-bearing, not decorative. Assert the bound in the test body (`expect(OVERFLOW_TEXT.length).toBeLessThan(600)`) so a later edit cannot silently re-enable the clamp and neuter the measurement — a clamped bubble puts `overflow: hidden` on the content div, which pins `scrollWidth` to `clientWidth` and makes both the containment assertion and Task 10's negative control vacuous.
2. Add the test:
   ```ts
   test('a long unbreakable token wraps inside the user bubble instead of painting outside it', async () => {
     const { page } = app;
     await sendMessage(page, OVERFLOW_TEXT);
     const bubble = page.getByTestId('chat-user-bubble').last();
     await expect(bubble).toBeVisible();
     const box = await bubble.evaluate((el) => ({
       scrollWidth: el.scrollWidth,
       clientWidth: el.clientWidth,
       width: el.getBoundingClientRect().width,
       clamped: el.querySelector('[data-clamp]') !== null,
     }));
     expect(box.clamped).toBe(false);
     expect(box.width).toBeLessThanOrEqual(471);
     expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
     await waitForIdle(page, 60_000);
   });
   ```
   `scrollWidth` includes content painted past the padding box, so `scrollWidth <= clientWidth` is the containment assertion; `width <= 471` pins that the card itself did not grow past its cap (470px + the 0.5px hairlines).
3. Extend the spec's header docblock: add `chat-user-bubble` to the testid reference list and note that the `thread` recording now carries three turns, the third being this containment send.

**Verification:** `pnpm --filter @qlan-ro/mainframe-e2e exec playwright test tests-tauri/transcript.spec.ts -g "§transcript — thread turn"` — the whole describe passes, including the five pre-existing tests that share the app fixture.

### Task 10 — negative control (the repro the PR attaches)

**No committed file changes.**

1. With Task 9 green, temporarily delete `break-words` from `CoolCard` in `packages/ui/src/features/chat/messages/UserMessage.tsx` and re-run the same command. Do **not** set `MF_E2E_SKIP_BUILD=1` for this step — global setup's rebuild is what carries the edit into the bundle the harness serves.
2. Confirm the new test **fails** on `scrollWidth <= clientWidth` (the recorded numbers are the repro evidence), then `git checkout -- packages/ui/src/features/chat/messages/UserMessage.tsx` and re-run to confirm green again.
3. Record both numbers (failing `scrollWidth`/`clientWidth`, passing pair) in the PR description alongside the reproduction recipe: a user message containing a single 200-character token.

**Verification:** the working tree is clean apart from Group C's two files; the fail-then-pass numbers are captured in the PR body. If the removal does **not** make the test fail, stop and report — the measurement is not proving containment and the spec needs rethinking before merge.

---

## Definition of done

- Seven UI suites and the `§transcript — thread turn` describe pass; `pnpm --filter @qlan-ro/mainframe-ui typecheck` is clean.
- The negative control failed before the fix and passes after it, with numbers in the PR.
- A changeset exists; `UserMessage.tsx` is still under 300 lines; the shared markdown map and `globals.css` are untouched.
- Follow-up filed, not fixed: a fenced code block in a user turn or a plan body renders as an inline code span, because `markdownComponents.pre` is a Fragment and `useIsMarkdownCodeBlock()` is false outside `MarkdownTextPrimitive` (D4).
