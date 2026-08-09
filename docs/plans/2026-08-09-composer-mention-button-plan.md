# Composer `@` button — open the picker, never submit (todo #316)

## Goal

The composer's add-mention button (`composer-add-mention`) currently appends `@` to the draft and sends the
message. Two independent defects cause it: the shared `Button` primitive sets no `type`, so inside
`ComposerPrimitive.Root`'s real `<form>` the DOM button defaults to `type="submit"`; and the click handler
writes the draft with a programmatic `composer.setText`, which fires no DOM event, so the trigger engine's
tracked `cursor` never moves and detection finds no token ending at the caret. This plan fixes both: default
the primitive to `type="button"` (non-`asChild` branch only) and set it explicitly at the call site, and
rewrite the handler to drive the composer textarea through its real change path — focus, native value write,
caret to the end, bubbling `input` event — so assistant-ui's `ComposerPrimitive.Input` runs the same
`setText` + `setCursorPosition` it runs for a typed `@`. The existing test that asserts `setText` was called
with `@` is rewritten, since it enshrines the defect and would read as a regression once the fix lands.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file, 50/function; `data-testid` on every interactive element; no
  `@ts-ignore`; no leftovers; changeset required before commit; tests required.
- `packages/ui/CLAUDE.md`: assistant-ui owns behavior, shadcn owns pixels — no new picker UI, no re-implemented
  detection, no fork of `ComposerPrimitive.Input`. `@assistant-ui/*` stays exact-pinned at `react@0.14.27`.
- Single-file vitest runs (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`); batched runs hit the
  cross-file `React.act` failure.
- No visual change: this restores intended behavior on an existing surface, so no `needs-ui` gate.

## Verified facts this plan rests on

Read on branch `todo/316-composer-mention-button` (base `c470bb1f`):

- `packages/ui/src/components/ui/button.tsx` — `Button` spreads props onto `'button'` (or `Slot.Root` when
  `asChild`) and never sets `type`.
- `.../@assistant-ui/react/dist/primitives/composer/ComposerRoot.js` — `ComposerPrimitive.Root` renders
  `Primitive.form` and composes our `onSubmit` with its own `send()` handler.
- `.../composer/ComposerInput.js` — the textarea is controlled; its `onChange` calls
  `aui.composer().setText(e.target.value)` and then `plugin.setCursorPosition(e.target.selectionStart)` for
  every plugin in the composer-input registry. `onSelect` also pushes `setCursorPosition`, but React does not
  fire `select` for a programmatic `setSelectionRange`, so the `input` event is the only reliable seam.
- `packages/ui/src/components/trigger-engine/use-trigger-field.ts` — `setCursorPosition` is the exported
  setter for the `cursor` state that `detectTrigger` reads; `ComposerTriggers.tsx` registers it into the
  assistant-ui plugin registry.
- `packages/ui/src/components/trigger-engine/detect.ts` — a trigger char is only detected at index 0 or after
  whitespace, which is why the button's leading-space rule exists.
- `packages/ui/src/features/chat/composer/read-live-composer-state.ts` — `readLiveComposerState` already
  exists for exactly the stale-snapshot problem in Decision Q3.
- `ComposerAddMention` has one call site (`Composer.tsx:153`), inside `<ComposerTriggers>` and inside
  `ComposerPrimitive.Root`. `Composer.tsx` already holds `textareaRef` and passes it to both `ComposerTriggers`
  and `ComposerPrimitive.Input`.
- In-form `Button` audit (every file containing `<form`, plus `ComposerPrimitive.Root`): no call site relies on
  implicit submit — `tasks-edit-save`, `review-comment-submit`, `git-new-branch-create` and `chat-composer-send`
  all pass `type="submit"` explicitly. Two in-form buttons currently submit by accident:
  `features/tasks/TaskEditModal.tsx` `tasks-edit-cancel` (line 264) and `tasks-edit-start` (line 251). The
  primitive default fixes both. `ComposerEditMode`'s buttons have no form ancestor.

## Decisions taken while planning

1. **Brief typo.** The brief's "Out of scope" and "Sequencing" paragraphs cite "#316" for the suggestion list's
   mispositioning; #316 is this todo. The pipeline note names **#304**. This plan reads those references as
   **#304** and keeps the positioning defect out of scope.
2. **Helper placement.** The DOM write lives in a feature-local
   `features/chat/composer/triggers/open-mention-trigger.ts`, not in `components/trigger-engine/`. One consumer;
   the project extracts shared helpers at three duplications, not one.
3. **Whitespace rule widened.** Today's guard is `!text.endsWith(' ')`. The acceptance criterion says "does not
   already end in whitespace", and `detect.ts` accepts any `\s`, so the helper tests `/\s$/`. A draft ending in
   a newline no longer gets a redundant space.
4. **Append at end, not at the caret.** The button keeps its current semantics (append to the end of the
   draft). Caret-position insertion is a behavior change and is not in the brief.
5. **Live text, not the render snapshot.** The handler computes the next draft from
   `readLiveComposerState(aui.composer()).text` (Decision Q3), not `composer.getState().text`.
6. **Primitive default is scoped to the non-`asChild` branch.** With `asChild`, `Button` renders `Slot.Root`
   and the child element owns its own tag; injecting `type` there would push a `type` attribute onto anchors
   and divs. An explicit `type` prop always wins.
7. **Fallback if the real input path cannot be driven.** If task 2's integration test cannot be made green
   through the `input`-event path, the sanctioned alternative is to expose `field.setCursorPosition` from
   `ComposerTriggers` through a small context that `ComposerAddMention` consumes, and call it right after the
   text write. Do not reimplement detection, and do not add a public "open trigger" API to the trigger engine.
   Record the reason in the PR if this branch is taken.

## Acceptance criteria → test map

| Brief criterion | Covered by |
| --- | --- |
| Click does not submit (empty and non-empty draft) | Task 1 (`ComposerAttachmentStrip.test.tsx`, form-wrapped submit spy) and Task 2 (`onNew` never called) |
| Click opens the picker with entries | Task 2 (`composer-trigger-popover` + a `composer-mention-session-*` row) |
| Draft text matches the typed-`@` case, incl. the leading-space rule | Task 1 (textarea value after a click, across the four whitespace cases) and Task 2 |
| Focus retained, caret after the `@` | Task 2 (`document.activeElement`, `selectionStart`) |
| Escape leaves draft and caret intact, still no submit | Task 2 |
| Typing `@` by hand unchanged | Task 2's pre-existing typed-`@` suites, run unmodified |
| Button carries `type="button"`, proven inside a form | Task 1 |
| Picker opens on click — not merely "a setter was called" | Task 2 (the old setText-spy assertion is deleted) |
| Files < 300 lines, functions < 50, testids preserved | Task 7 |
| UI typecheck passes, PR includes a changeset | Task 7, Task 8 |

No other in-form call site relies on implicit submit (see the audit above), so the primitive default is
covered by Task 3 plus the TaskEditModal run in Task 4.

## Tasks

TDD order: tasks 1, 2 and 3 are written and observed failing before tasks 4–6 exist.

**Typecheck is red between tasks 1 and 6 — expected, do not "fix" it.** `packages/ui/tsconfig.json` sets
`"include": ["src"]`, so `pnpm --filter @qlan-ro/mainframe-ui typecheck` covers the test files. Tasks 1 and 2
render `<ComposerAddMention textareaRef={ref} />`, and the component takes no props until task 6, so the
package typecheck reports TS2322 (`Property 'textareaRef' does not exist on type 'IntrinsicAttributes'`) in
those two test files for the whole red window. Do not suppress it: an `@ts-expect-error` turns into an
unused-directive error the moment task 6 lands. The red tasks gate on their own single-file vitest runs; the
package typecheck is task 7's gate, after task 6 adds the prop.

### Task 1 — (test, red) Rewrite `ComposerAttachmentStrip.test.tsx` for the submit defect

File: `packages/ui/src/features/chat/composer/attachments/__tests__/ComposerAttachmentStrip.test.tsx`

- Delete the `clicking it appends "@" to the composer text via setText` case — it asserts the defect.
- Keep the two `ComposerAddAttachment` cases and the two `data-size`/`size-6` cases unchanged.
- Add a `renderInForm(children)` helper that wraps the subject in `<TooltipProvider><form onSubmit={submitSpy}>`.
  `submitSpy` calls `e.preventDefault()` so jsdom does not warn about unimplemented navigation.
- New cases:
  - `composer-add-mention` has attribute `type="button"`.
  - `composer-add-attachment` has attribute `type="button"` (it inherits the primitive default through
    `ComposerPrimitive.AddAttachment asChild`).
  - Clicking `composer-add-mention` inside the form with an EMPTY draft does not call `submitSpy`.
  - Same with a NON-EMPTY draft (`'hello'` from the mocked live composer state).
  - Existing mousedown-preventDefault cases stay.
- The module mock for `@assistant-ui/react` gains `__internal_getRuntime` on the composer stub so
  `readLiveComposerState` resolves the live path; let the mocked text be settable per test.
- The subject now takes a `textareaRef` prop: render it with a ref to a real `<textarea>` mounted in the same
  form so the handler has a node to write to. Assert the textarea's value after a click matches the
  `mentionDraft` rule (`''` → `'@'`, `'hello'` → `'hello @'`, `'hello '` → `'hello @'`, `'hello\n'` → `'hello\n@'`).

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/attachments/__tests__/ComposerAttachmentStrip.test.tsx`
— expect failures on the new cases (no `type` attribute, submit fires) and no failures in the untouched cases.

### Task 2 — (test, red) Extend `ComposerTriggers.test.tsx` to prove the picker opens on click

File: `packages/ui/src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx`

- Leave every existing suite untouched; they are the "typing `@` by hand is unchanged" guard. Say so in a
  comment on the new describe block.
- Extend `Harness` (or add a second harness beside it) so it holds a `textareaRef`, passes it to
  `ComposerPrimitive.Input` and to a `<ComposerAddMention textareaRef={ref} />` rendered as a sibling inside the
  same `ComposerPrimitive.Root`. Give the harness's `useExternalStoreRuntime` an `onNew` spy.
- New describe — `ComposerAddMention — click opens the picker without submitting`:
  - With `__sessionItems` seeded (as the existing session suite does), clicking `composer-add-mention` renders
    `composer-trigger-popover` and a `composer-mention-session-chat-2` row.
  - `onNew` was never called (no submit reached the runtime).
  - The textarea's value is `'@'`, `document.activeElement` is the textarea, and `selectionStart === 1`.
  - With the draft pre-typed to `'hello'`, clicking yields `'hello @'` and the popover opens
    (`selectionStart === 7`).
  - `fireEvent.keyDown(textarea, { key: 'Escape' })` closes `composer-trigger-popover`, leaves the value at
    `'@'`, and still never calls `onNew`.
- Wrap the harness in `TooltipProvider` — `ComposerAddMention` renders a `Hint`.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx`
— expect the new describe to fail (popover never appears, `onNew` called) and all pre-existing suites to pass.

### Task 3 — (test, red) Cover the `Button` primitive's default `type`

File (new): `packages/ui/src/components/ui/__tests__/button.test.tsx` (the directory already holds
`hint.test.tsx` and friends — follow their shape).

- A plain `<Button>` renders `type="button"`.
- An explicit `<Button type="submit">` still renders `type="submit"`.
- `<Button asChild><a href="#">x</a></Button>` renders an anchor with NO `type` attribute — the default must
  not leak onto a slotted non-button element.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/button.test.tsx`
— expect the first case to fail before task 4 lands.

### Task 4 — (ui) Default the `Button` primitive to `type="button"`

File: `packages/ui/src/components/ui/button.tsx`

- Destructure `type` out of props. Compute `const typeProps = asChild ? (type ? { type } : {}) : { type: type ?? 'button' };`
  and spread it before `{...props}` (props no longer carries `type`).
- No variant, class, or `data-*` change. The function stays well under 50 lines.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/button.test.tsx` (now
green) and `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/TaskEditModal.test.tsx`.
`tasks-edit-cancel` and `tasks-edit-start` stop submitting the form; if any existing case asserted the
accidental submit, it goes red — that is the intended fix, and the case is rewritten in the same pass, not
skipped.

### Task 5 — (ui) Add `open-mention-trigger.ts`

File (new): `packages/ui/src/features/chat/composer/triggers/open-mention-trigger.ts`

Two exports, no React:

- `export function mentionDraft(text: string): string` — returns `text.length > 0 && !/\s$/u.test(text) ? \`${text} @\` : \`${text}@\``.
- `export function writeComposerDraft(el: HTMLTextAreaElement, next: string): void` — focuses `el`, writes
  `next` through the `HTMLTextAreaElement.prototype` `value` setter (so React's value tracker sees a change),
  calls `el.setSelectionRange(next.length, next.length)`, then dispatches `new Event('input', { bubbles: true })`.
  A one-line comment states the why: assistant-ui's `ComposerPrimitive.Input` derives both `setText` and the
  trigger engine's `setCursorPosition` from that event, and a programmatic `setText` fires neither.

Verify: no gate of its own. The two exports are pure and unreferenced until task 6, and the package typecheck
cannot pass here — see "Typecheck is red between tasks 1 and 6" above. Behavior is asserted by tasks 1 and 2
once task 6 wires the helper in; the package typecheck runs in task 7.

### Task 6 — (ui) Rewrite `ComposerAddMention` and wire the ref

Files:
- `packages/ui/src/features/chat/composer/attachments/ComposerAttachmentStrip.tsx`
- `packages/ui/src/features/chat/composer/Composer.tsx`

- `ComposerAddMention` takes `{ textareaRef }: { textareaRef: RefObject<HTMLTextAreaElement | null> }`.
- Handler: read `readLiveComposerState(aui.composer()).text`, compute `mentionDraft(text)`, and when
  `textareaRef.current` is non-null call `writeComposerDraft`. When it is null, `console.warn('[composer] add-mention: no textarea ref — picker cannot open')`
  and fall back to `aui.composer().setText(next)` so the draft still updates.
- Add `type="button"` explicitly on the `Button` (belt and braces with task 4, and it documents the intent at
  the call site). Keep `data-testid`, `variant`, `size`, `aria-label`, the `AtSignIcon`, and the
  `onMouseDown` focus guard exactly as they are.
- Update the component's doc comment: it no longer "appends @ via setText" — it drives the textarea's real
  change path. Delete the now-wrong sentence rather than layering onto it.
- `Composer.tsx`: pass `<ComposerAddMention textareaRef={textareaRef} />` (the ref already exists at line 76).
- Keep `ComposerAttachmentStrip.tsx` under 300 lines (currently 135).

Verify: both single-file vitest runs from tasks 1 and 2 now pass, including the previously untouched suites.

### Task 7 — Full verification pass

- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/attachments/__tests__/ComposerAttachmentStrip.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/composer/__tests__/Composer.test.tsx`
  (its `ComposerAddMention: () => null` mock must still typecheck against the new prop) and
  `.../composer/__tests__/composer-states.test.tsx` (same stub)
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/components/ui/__tests__/button.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/tasks/__tests__/TaskEditModal.test.tsx`
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `wc -l` on every touched file (<300) and eyeball the handler (<50 lines); confirm `composer-add-mention` and
  `composer-add-attachment` testids are unchanged.

### Task 8 — Changeset

- `pnpm changeset` → patch bump for `@qlan-ro/mainframe-ui`. One line, plain: the composer's `@` button opens
  the mention picker instead of sending the message.

## Out of scope

- The suggestion list's position inside the sticky footer (todo #304). This fix makes that defect reachable
  from the button too; landing order is the orchestrator's call, and the brief asks for #304 first or alongside.
- A `/` slash-command button. None exists.
- Any change to `detect.ts`, `selection.ts`, the plugin registry, or the mention adapters.
