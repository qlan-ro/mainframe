# Todo #353 — Enter must send after an unrecognized slash command

## Goal

Typing a slash or `@` token that matches nothing (e.g. `/compact`, `/zzz`) leaves the composer's trigger engine armed but with an empty entry list. The engine's key handler gates on "a token is detected" rather than "there are entries to navigate", so it `preventDefault()`s Enter and the arrows and reports them handled; assistant-ui's composer input runs plugins first and returns early, so the form never submits. Escape disarms the engine but the composer's own Escape branch — which only knows about `aria-expanded` — sees a closed popover and parks focus on the transcript, leaving the Send button as the only route. The fix is one condition in the hook (navigation keys need a non-empty entry list) plus one signal in the composer (Escape must not steal focus while a token is armed, expanded or not). An unmatched token keeps being sent as plain text with no command metadata, and keeps rendering as a text-driven command chip in the transcript — pinned by a regression test, not by new behavior.

## Changes

1. `packages/ui/src/components/trigger-engine/use-trigger-field.ts` — in `handleKeyDown`, make `ArrowDown`, `ArrowUp`, `Enter` and `Tab` return `false` **without** calling `preventDefault()` when `current.entries.length === 0`. `Escape` stays consumed while a token is detected (it must still disarm), and `Backspace` keeps its own guard — a drilled-into category may legitimately list nothing. Keep the function under 50 lines.
2. `packages/ui/src/features/chat/composer/triggers/trigger-field-aria-context.tsx` — carry an "armed" boolean beside the ARIA props: a sibling context (default `false`) exported through the existing provider (extra prop) plus a new hook. Do **not** put it on `TriggerFieldAriaProps`: that object is spread onto the textarea and a non-ARIA key becomes a bogus DOM attribute.
3. `packages/ui/src/features/chat/composer/triggers/ComposerTriggers.tsx` — feed the provider `field.trigger !== null` as the armed value (that field already is the signal; no change to the hook's public shape). Memoize whatever object the provider receives so the context value does not churn identity on unrelated renders.
4. `packages/ui/src/features/chat/composer/Composer.tsx` — in `ComposerInputField`, the Escape focus-park branch tests `!armed` instead of `triggerAria['aria-expanded'] !== true`. Armed is a superset of expanded, so the existing open-menu behavior is unchanged and the unmatched-token case stops moving focus.
5. `packages/ui/src/components/trigger-engine/__tests__/use-trigger-field.test.tsx` — extend the existing "renders no popover when the query matches nothing" setup: `Enter` and `ArrowDown` report **not handled** and do not prevent default while a token is detected with an empty entry list; `Escape` still reports handled and still disarms.
6. `packages/ui/src/features/chat/composer/triggers/__tests__/ComposerTriggers.test.tsx` — the load-bearing pin for AC 1: this suite mounts the real `Unstable_TriggerPopoverRoot` and plugin registry, which is the only place aui's early-return is exercised. Type `/zzz`, press Enter, observe the composer form submits. Keep a companion assertion that with matching results Enter still inserts the highlighted entry and does not submit.
7. `packages/ui/src/features/chat/composer/__tests__/focus-composer.test.tsx` — its `vi.mock` factory (around line 96) returns only `useTriggerFieldAria`; it must be extended for the new export or the suite breaks. Add the Composer-level case: armed-but-not-expanded Escape leaves focus in the textarea, and a following Enter submits.
8. `packages/ui/src/features/chat/messages/__tests__/UserMessage.test.tsx` — positive twin of the existing non-leading-slash negative at line 673: a message whose text is a leading unmatched `/zzz …` with `mainframe: undefined` renders the `command` directive chip (`[data-directive-type="command"]`).
9. `packages/ui/src/features/automations/fields/__tests__/TriggerTextField.test.tsx` — the second consumer of the same hook: after an unmatched token, Enter inserts a newline instead of being swallowed, making the existing comment at `TriggerTextField.tsx:85-88` true. `@testing-library/user-event` ^14.6.1 is available, which drives the textarea's default insertion; if that proves unreliable in jsdom, fall back to asserting the keydown was not default-prevented (jsdom performs no default action for a raw `fireEvent.keyDown`).

## Established facts

- assistant-ui runs registered composer-input plugins first and returns early when one reports the key handled, so a consumed Enter never reaches the submit branch — `node_modules/@assistant-ui/react/dist/primitives/composer/ComposerInput.js:80-82` (Enter/submit logic follows at :83-100).
- The same plugin loop runs again from aui's document-level Escape handler, before the `cancelOnEscape` early-out — `ComposerInput.js:64-70`. `close()` is idempotent, so the double Escape delivery is harmless, but it means the plugin cannot be the thing that decides the composer's focus-park.
- The composer's own `onKeyDown` prop runs **before** aui's internal handler, and the internal handler is skipped when the prop prevented default — `ComposerInput.js:174` (`composeEventHandlers(onKeyDown, handleKeyPress)`) with `node_modules/@radix-ui/primitive/dist/index.mjs:6-12`. This is exactly why mid-run Enter-to-queue (`Composer.tsx:150-162`, which calls `preventDefault()` then `submit()`) works today and is untouched by this change, and why the Composer cannot learn "armed" from the plugin's return value.
- The popover's open state is `entries.length > 0` (`use-trigger-field.ts:94`) while the key handler's early-out is `if (!current.active) return false` (`use-trigger-field.ts:140`) — the exact mismatch this todo reports.
- `field.trigger` is already `active?.config ?? null` (`use-trigger-field.ts:187`), so the armed signal needs plumbing, not a new hook API.
- The composer's Escape branch currently keys on the ARIA expanded flag (`Composer.tsx:111`) and the ARIA object is spread straight onto the textarea (`Composer.tsx:130`).
- A non-matching token produces no send metadata: `matchCommandInvocation(text)` returns null → `sendMeta = {}` → `buildPendingMessage(..., sendMeta)` — `packages/ui/src/features/chat/controller/chat-actions.ts:54-56`. Both the optimistic pending and the reconciled turn therefore carry no `command` meta. Unchanged by this work.
- Transcript chip rendering is text-driven: `mainframeUserFormatter = createUserFormatter({ recognizeCommand: true })` recognizes a leading `/token` by shape with no registry lookup — `packages/ui/src/features/chat/messages/user-directives.ts:75, 100-125`. So `/zzz` already chips today; task 8 pins it.
- `VariablePickerButton.tsx` is a third file that mentions the hook but only uses `selectEntry` (see its header comment, lines 11-12) — it never calls `handleKeyDown`, so it is unaffected.
- `docs/plans/` is gitignored in this repo, so this plan file is committed with `git add -f`.

## Risks

- **Async `@` sources.** While a file/session search is in flight the entry list is empty, so Enter now sends the draft instead of being silently swallowed. That is literally what "behave as if no trigger were in play" means, but it is a visible behavior change on a path the brief lists as out of scope. Accepted.
- **Escape stays consumed while armed.** The hook still calls `preventDefault()` on Escape whenever a token is detected, so the session/files panels' document-level Escape listeners (gated on `!defaultPrevented`) do not fire on that press — identical to today's open-menu behavior, ratified in the brief's decisions.
- **Mock drift.** `focus-composer.test.tsx` mocks the aria-context module with an object literal; any export added in task 2 must be mirrored there or the suite fails for an unrelated-looking reason.

## Exit gates

- Every acceptance criterion in the todo brief is covered by a test in tasks 5-9, and the new tests fail before the source change and pass after (write each failing test and its fix in the same turn).
- `packages/ui` unit tests, typecheck and lint pass. Typecheck includes test files, so run it, not just the build.
- A patch changeset for `@qlan-ro/mainframe-ui` describing the Enter-after-unmatched-token fix accompanies the branch.
- No leftovers: the stale `TriggerTextField.tsx:85-88` comment is now accurate — if its wording no longer matches the code, correct it in the same pass.
