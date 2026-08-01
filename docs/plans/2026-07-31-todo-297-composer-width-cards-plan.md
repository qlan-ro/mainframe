# Todo #297 — Gate cards should be composer width (implementation plan)

**Route:** no-spec (plan works from the approved Agent Brief)
**Branch:** `todo/297-composer-width-cards` · **Worktree:** `.worktrees/todo-297-composer-width-cards`

## Goal

The three inline gate cards (plan approval, tool permission, ask-a-question) render narrower than every other element in the chat transcript column, so the plan gate's right edge visibly stops short of the composer card directly below it. The transcript column and the composer footer are the same wrapper geometry — `mx-auto w-full max-w-3xl px-5` on both, in `ChatThread.tsx` — and the composer, assistant messages, and tool cards all fill that column because none of them declares a width. The shared gate shell, `GateCardShell` in `features/chat/gates/shared/GateShell.tsx`, is the sole outlier: it declares `max-w-[680px]`, roughly 64px narrower than the column's content width. This plan deletes that single class so the gate inherits the column, gives the shell a stable `data-testid` so the width can be asserted from an E2E spec (jsdom computes no layout), flips the jsdom test that currently pins the 680px cap, and verifies edge parity live at a wide window, at a narrow chat surface, in light and dark, and in a non-`glass` window style.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file, 50 lines/function; `data-testid` on every interactive element as `<surface>-<element>` kebab-case; changeset required on every PR; no leftovers.
- `packages/ui/CLAUDE.md`: read the `mainframe-design-system` skill before writing markup or class names; only `mf-*` tokens that `@theme inline` actually maps.
- The brief forbids a per-gate width override — the fix must live in `GateCardShell` and nowhere else.
- The brief forbids touching the column's own `max-w-3xl`/`px-5`, the composer's `min-w-[240px]`, the right-aligned user bubbles (`UserMessage.tsx` `max-w-[470px]`, `QueuedUserTurn.tsx` `max-w-[470px]`, `PlanBubble.tsx` `max-w-[530px]`, `ReviewCommentCard.tsx` `max-w-[75%]`), and the gates' internal padding, typography, controls, and accent chrome.
- Acceptance criterion: a width assertion must be made against the live app or an E2E spec, never a jsdom component test. The jsdom test may only assert that the shell no longer carries a width class.
- `packages/core-rs` is not an npm package and is untouched here; the changeset bumps `@qlan-ro/mainframe-ui` only (precedent: `.changeset/automations-v2-rust-engine.md`).
- UI tests run one file at a time — large multi-suite runs hit cross-file `React.act` failures.

## Facts established by reading the code

- `packages/ui/src/features/chat/thread/ChatThread.tsx:108` — transcript column: `mx-auto w-full max-w-3xl flex-1 px-5 py-4`.
- `packages/ui/src/features/chat/thread/ChatThread.tsx:131` — footer column: `mx-auto w-full max-w-3xl px-5 pb-4`, `data-testid="chat-thread-footer"`. Identical width geometry to the transcript column.
- `packages/ui/src/features/chat/composer/Composer.tsx:114` — `ComposerPrimitive.Root`, `data-testid="chat-composer"`, `min-w-[240px]` and **no** `max-w`. It fills the footer column: this is the reference.
- `packages/ui/src/features/chat/gates/shared/GateShell.tsx:28` — `'max-w-[680px] overflow-hidden rounded-xl border bg-card'`. The only width declaration in the gate stack.
- `GateCardShell` is used by exactly three callers, none of which passes a width: `PlanGate.tsx:198`, `PermissionGate.tsx:96` (`accent="warning"`), `AskUserQuestionGate.tsx:154`. Each wraps it in a plain block `div` carrying the gate testid (`chat-plan-gate` / `chat-permission-gate` / `chat-question-gate`).
- `ChatGateMount.tsx` renders at most one gate at a time, inline at the transcript tail inside the column div.
- `680` appears in exactly two places in the repo: `GateShell.tsx:28` and the assertion at `packages/ui/src/features/chat/gates/__tests__/gate-kit.test.tsx:112-115` (`'caps width at the design maxWidth (680px)'`). No E2E spec and no CSS references it.
- `packages/e2e/tests-tauri/gates.spec.ts` already mounts all three gates in mock mode: `§permission gate details` (permission), `§ask-question wizard extras` (question), `§plan gate exec-mode` (plan). Each `describe` owns its own app launch and recording, so the width checks fold into the existing tests rather than adding new sessions.
- Surface toggles carry `surface-rail-files` / `surface-rail-run`; appearance controls carry `settings-appearance-mode-*` and `settings-appearance-window-style-{unified,split,glass}`.

## Decisions

- **D1 — Delete the cap; add no replacement max-width and no min-width.** The column's own `max-w-3xl` already provides the wide-window ceiling (brief decision 5). The brief's parenthetical "the composer's own minimum width is the floor" describes what already keeps the chat surface from getting arbitrarily narrow; it is not a request to copy `min-w-[240px]` onto the gate. Copying it would make the gate overflow the column below 240px + gutters, which the acceptance criteria explicitly forbid ("never overflow it horizontally"). The gate therefore declares neither bound.
- **D2 — Give `GateCardShell` a default `data-testid="chat-gate-card"`.** The E2E width assertion needs a handle on the shell itself; the existing `chat-*-gate` testids sit on the plain wrapper `div`, which fills the column whether or not the bug is fixed, so asserting on it would pass even unfixed. The alternative — a positional `> div` child selector — is brittle and violates the repo's testid rule. The default is placed *before* `{...props}` so the three `gate-kit` tests that pass their own `data-testid` keep overriding it. This is the only product change beyond the class deletion.
- **D3 — The jsdom test asserts absence of a width class, not a number.** Per the acceptance criteria, `gate-kit.test.tsx` flips from `toHaveClass('max-w-[680px]')` to asserting the shell's `className` contains no `max-w-` token at all. That is the strongest claim jsdom can honestly make, and it fails today (red phase).
- **D4 — Narrow-width E2E coverage uses the Files surface toggle, not window resizing.** The Tauri window is not resizable from Playwright's page API, and the brief itself names "with the Files or Run surface lit alongside chat" as the narrow case. Clicking `surface-rail-files` shrinks the chat column inside the same window, which is the reachable narrow state.
- **D5 — Tool-card edge alignment is verified live, not in E2E.** Tool cards declare no width (verified by grep: only inner tooltip/label caps exist), so once the gate declares none either, both are the same block-level fill of the same column. Asserting a tool card's box in the recorded gate flows would couple the test to which tool the recording happens to run. The criterion is met by the live check in Task D1.

## Out of scope (from the brief)

The column's `max-w-3xl`, its `px-5` gutters, and the composer's `min-w-[240px]` · the narrower caps on the user bubble, queued card, approved-plan bubble, and review-comment card · the gates' internal padding, typography, controls, and accent glow · the gate's post-approval retention and duplicate-plan behavior (#296) · long-line overflow inside bubbles (#298).

---

## Group A — red-phase jsdom test (`ui-test`)

### Task A1 — flip the width assertion to "no width class"

**File:** `packages/ui/src/features/chat/gates/__tests__/gate-kit.test.tsx`

1. Replace the test at lines 112–115:
   ```tsx
   it('declares no max-width of its own — width comes from the transcript column', () => {
     wrap(<GateCardShell data-testid="shell-width">content</GateCardShell>);
     const className = screen.getByTestId('shell-width').className;
     expect(className).not.toMatch(/(^|\s)max-w-/);
   });
   ```
   Keep it in the same position inside the `describe('GateCardShell')` block. Do not add a pixel assertion of any kind — jsdom computes no layout, and the real width check lives in Group C.
2. Add one test in the same `describe` block for the default testid (Group B introduces it, so this is red too):
   ```tsx
   it('carries a default data-testid the E2E width assertion can target', () => {
     render(
       <TooltipProvider>
         <GateCardShell>content</GateCardShell>
       </TooltipProvider>,
     );
     expect(screen.getByTestId('chat-gate-card')).toHaveTextContent('content');
   });
   ```
3. Update the file's header comment: the `GateCardShell` bullet currently reads "renders children, resolved/unresolved border classes" — extend it to "…, absence of a self-declared max-width, default testid".

**Verification:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/gate-kit.test.tsx` — exactly the two tests above fail (`max-w-[680px]` still present; `chat-gate-card` not found), every other test in the file passes. Record the two failure messages in the commit message.

---

## Group B — gate shell implementation (`ui-impl`, depends on Group A)

### Task B1 — remove the cap and add the default testid

**File:** `packages/ui/src/features/chat/gates/shared/GateShell.tsx`

1. Line 28: drop `max-w-[680px] ` from the `cn()` base string, leaving `'overflow-hidden rounded-xl border bg-card'`. Change nothing else in the string, and add no replacement width class in any form (no `max-w-full`, no `w-full` — a block `div` already fills its parent).
2. In the same `<div>`, add `data-testid="chat-gate-card"` as the **first** attribute, above `className`, so the existing `{...props}` spread on line 33 still lets a caller override it.
3. Add a one-line comment above the `<div>` explaining the *why* of the missing width, so nobody reinstates the cap:
   ```tsx
   // No width of its own: the gate matches the composer by inheriting the transcript column (#297).
   ```
   One line, no paragraph.
4. Touch no other file. In particular do not add a width to `PlanGate.tsx`, `PermissionGate.tsx`, or `AskUserQuestionGate.tsx` — the brief forbids per-gate overrides.

**Verification:**
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/gate-kit.test.tsx` — all green, including Group A's two new tests.
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/PlanGate.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/PermissionGate.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/AskUserQuestionGate.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/gates/__tests__/ChatGateMount.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `grep -rn "680" packages/ui/src packages/e2e` returns nothing under the gates tree — the number is gone from the repo, not merely unused.

### Task B2 — changeset

**File:** `.changeset/gate-cards-composer-width.md` (new)

```md
---
'@qlan-ro/mainframe-ui': patch
---

Inline gate cards (plan, permission, ask-a-question) now span the same width as the composer instead of stopping ~64px short of it.
```

**Verification:** `pnpm changeset status` runs clean; the file lists `@qlan-ro/mainframe-ui` and nothing else.

---

## Group C — E2E width parity (`e2e-test`, depends on Group B)

Runs against the built bundle, so it must follow Group B. All three additions fold into existing `describe` blocks in one file — no new app launches, no new recordings.

### Task C1 — shared edge-parity helper

**File:** `packages/e2e/tests-tauri/gates.spec.ts`

1. Add a module-level helper below the imports (keep it under 50 lines):
   ```ts
   /** The gate card and the composer sit in two wrappers with identical geometry
    *  (`mx-auto w-full max-w-3xl px-5`), so their outer edges must coincide. */
   async function expectGateMatchesComposerWidth(page: Page) {
     const gate = await page.getByTestId('chat-gate-card').boundingBox();
     const composer = await page.getByTestId('chat-composer').boundingBox();
     expect(gate, 'gate card must be mounted').not.toBeNull();
     expect(composer, 'composer must be mounted').not.toBeNull();
     expect(Math.abs(gate!.x - composer!.x)).toBeLessThanOrEqual(1);
     expect(Math.abs(gate!.x + gate!.width - (composer!.x + composer!.width))).toBeLessThanOrEqual(1);
   }
   ```
   Import `type Page` from `@playwright/test` alongside the existing `test, expect`.
2. Extend the file's "Testid reference" header block with `chat-gate-card — the shared gate card shell (width parity against chat-composer)`.

### Task C2 — assert parity on the permission gate, wide and narrow

**File:** `packages/e2e/tests-tauri/gates.spec.ts`, `test.describe('§permission gate details')`

1. In the existing test, immediately after `await page.locator('[data-testid="chat-permission-gate"]').waitFor(...)` on line 51, call `await expectGateMatchesComposerWidth(page);`.
2. After the details-disclosure and always-allow assertions and **before** the closing deny click, add the narrow-surface pass:
   ```ts
   await page.getByTestId('surface-rail-files').click();
   await expect(page.getByTestId('files-surface')).toBeVisible({ timeout: 10_000 });
   await expectGateMatchesComposerWidth(page);
   const column = await page.getByTestId('chat-thread-footer').boundingBox();
   const narrowGate = await page.getByTestId('chat-gate-card').boundingBox();
   expect(narrowGate!.width).toBeLessThanOrEqual(column!.width);
   await page.getByTestId('surface-rail-files').click();
   ```
   The footer wrapper is the column, so the gate must never be wider than it. Re-hide Files before the deny click so the describe's teardown state matches what it was.
3. Update the test title to name the new coverage: `'Details toggle reveals the raw tool input; always-allow shown when suggestions exist; the card matches the composer width at both surface widths'`.

`files-surface` is the Files surface root's testid (`packages/ui/src/layout/surfaces/FilesSurface.tsx:23`); `packages/e2e/tests-tauri/files-tree.spec.ts:56` already clicks the same rail button.

### Task C3 — assert parity on the question gate and the plan gate

**File:** `packages/e2e/tests-tauri/gates.spec.ts`

1. `test.describe('§ask-question wizard extras')` — after `await page.locator('[data-testid="chat-question-gate"]').waitFor(...)` on line 129, add `await expectGateMatchesComposerWidth(page);`.
2. `test.describe('§plan gate exec-mode')` — after `await page.locator('[data-testid="chat-plan-gate"]').waitFor(...)` on line 257, add `await expectGateMatchesComposerWidth(page);`. This lands **before** the `test.skip(true, ...)` at the end of that test, so the assertion runs and a regression fails the run even though the test is ultimately marked skipped. Do not touch the `test.skip` or its TODO(bug) comment — that gap belongs to the clear-context respawn flow, not to this change.

**Verification (Group C):**
```
cd packages/e2e
pnpm build:app:tauri
E2E_MODE=mock pnpm exec playwright test tests-tauri/gates.spec.ts
```
All five gate tests report their existing status (four pass, `§plan gate exec-mode` still reports skipped after its assertions run). Then confirm the assertions are real: temporarily re-add `max-w-[680px]` to `GateShell.tsx`, rebuild, re-run, and observe C2 and C3 fail on the x-edge comparison; revert the class before committing. Record that result in the commit message.

---

## Group D — live verification (`ui-verify`, depends on Group B)

No files change in this group. It discharges the acceptance criteria that jsdom and Playwright cannot: theme, window style, and alignment against the tool cards.

### Task D1 — render the three gates live and check the edges

1. Start the dev app isolated from production, per the repo's launch rule — never launch without pinning both the port and the data dir:
   `MAINFRAME_DATA_DIR=~/.mainframe_dev DAEMON_PORT=31500 pnpm tauri:dev` from `packages/app-tauri`, backgrounded with output to a log file.
2. Drive a session to each of the three gates (a permission gate from any write/bash tool, a plan-mode chat for the plan gate, an `AskUserQuestion` prompt for the question gate). For each, with a wide window:
   - The gate's left and right edges line up with the composer card below it.
   - The gate's edges line up with the tool cards stacked above it.
3. Narrow the chat surface — first by lighting Files alongside chat, then by dragging the window narrow — and confirm the gate tracks the column, never spills past it, and never scrolls horizontally.
4. Toggle Settings → Appearance → Mode between light and dark (`settings-appearance-mode-*`) and confirm the card chrome, border, and accent glow still read correctly at the wider size.
5. Switch Settings → Appearance → Window Style to `unified` (`settings-appearance-window-style-unified`) — a non-`glass` style — and repeat the wide-window edge check.
6. Confirm the right-aligned bubbles are visually unchanged: the plain user card, the queued card, the approved-plan bubble, and the review-comment card all still stop short of the column's right edge.

**Verification:** capture one screenshot per gate at the wide window and one narrow-surface screenshot, attach them to the PR, and report any edge mismatch as a finding rather than patching a per-gate width (which the brief forbids).

---

## Acceptance-criteria trace

| Criterion (brief) | Discharged by |
|---|---|
| Shell declares no max-width; width comes from the column | B1 + A1 |
| Wide window: plan/permission/question gates share edges with composer and tool cards | C2, C3 (composer), D1 (tool cards) |
| Narrow surface, Files/Run lit: gates track the column, no horizontal overflow | C2 (Files lit), D1 (drag-narrow) |
| Right-aligned user bubbles unchanged | D1 step 6; no file under `features/chat/messages/` is touched |
| Light + dark + one non-`glass` window style | D1 steps 4–5 |
| Width asserted live or in E2E, never jsdom | C1–C3 assert boxes; A1 asserts only class absence |
| Existing gate component tests stay green; changeset included | B1 verification list; B2 |

---

## Group D — live verification result (2026-07-31)

**Environment.** The worktree's UI served by Vite, talking to the Rust daemon in `E2E_MODE=mock`
replay on an isolated port and data dir, rendered in Chromium at 1600×1000. `pnpm tauri:dev` was
not used: the Tauri dev binary hard-codes `devUrl http://localhost:5174`, which another worktree's
dev server holds, and a `cargo` build here would strand a multi-GB `target/` (root CLAUDE.md, Disk
Hygiene). The change deletes a width class and introduces no compositing, sticky, or backdrop
surface, so nothing in it is engine-dependent; WKWebView was not exercised.

**Coverage.** Each gate was driven to its live state — permission (`permissions-interactive`),
ask-question (`ask-question`), plan (`plan-approval`) — and measured in seven configurations: wide
light/glass, wide dark/glass, wide dark/unified, wide light/unified, narrow with the Files surface
lit alongside chat, and window widths 900 and 760.

**Result.** In all 21 combinations the gate card's left and right edges equal the composer's
exactly, the gate stays inside the transcript column, and the thread viewport never scrolls
horizontally. Box measurements at 1600px, glass, plan gate:

| element | x | right | width |
|---|---|---|---|
| `chat-thread-footer` (column) | 559.5 | 1327.5 | 768 |
| `read-card-root` / `chat-write-card` / `chat-plan-card` | 571.5 | 1315.5 | 744 |
| `chat-gate-card` | 571.5 | 1315.5 | 744 |
| `chat-composer` | 571.5 | 1315.5 | 744 |

The card's border and accent chrome read correctly at the wider size in light and dark and in the
non-`glass` `unified` style. The right-aligned bubbles are unchanged: `chat-user-message` is the
full-column flex wrapper, and the bubble inside it still stops well short of the column's right
edge. No findings; this group changed no product code.

**Evidence.** Screenshots (`<gate>-<config>.png`, one per gate per configuration) in
`~/Documents/mf-verification/todo-297-gate-width/`.
