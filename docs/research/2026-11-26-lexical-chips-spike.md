# Spike: atomic composer chips with `@assistant-ui/react-lexical` (26 November 2026)

Todo #482. Follows section 7.3 of the [composer study](2026-11-26-composer-shadcn-study.md) (PR #978), and runs on the assistant-ui 0.15.38 set from PR #979.

**Status, 27 November:** shipped behind a setting, off by default (todo #493): Settings › Chat › "Mentions and commands as chips (preview)". The dev flag in section 2 is gone, typed tokens chip once finished, edit mode and quote segments use a chip editor, and the harness below has four more checks (32 in each engine). The owner's in-app check (section 5) gates making it the default.

## 1. Verdict

**Go, with one check first.** `@assistant-ui/react-lexical` 0.2.25 gives real atomic chips. The caret steps over a chip in one press, Backspace and Delete remove it whole, and undo, copy and paste, draft restore and session labels all keep it a chip. The text sent to the daemon is unchanged. Every composer behaviour the harness covers passes in WebKit and Chromium (28 of 28 in each).

The check is a half day in the Tauri app with the flag on, using a real input method (Japanese, Chinese pinyin, Korean), dictation and VoiceOver. Playwright cannot drive an IME in WebKit, so that is the one risk left unmeasured (section 5). If it passes, ship it. Shipping is **5–7 days** (section 6).

The prototype is not ready to merge as code. It is behind a dev flag, and the textarea tests and e2e selectors have not been moved over.

Two things the package does not do on its own, both fixed in the prototype:

- **WebKit's caret stops at a chip.** Lexical leaves isolated decorator nodes to the browser's native caret, and WebKit's native caret does not cross a `contenteditable="false"` span. The first WebKit run left the caret stuck after a chip, so ← and Delete acted on the wrong side. A 30-line arrow-key handler fixes it.
- **Paste loses chips.** Lexical's plain-text paste reads only `text/plain`, where a copied chip is its directive text, so a paste comes back as plain characters. A paste plugin re-parses the text with our formatter.

## 2. What was built

Behind `isLexicalComposerEnabled()`: set `VITE_MF_LEXICAL_COMPOSER=1` at build time, or run `localStorage.setItem('mf:dev:lexical-composer', '1')` and reload. With the flag off, nothing changes.

| Piece | Path (under `packages/ui/src/`) | Lines |
| --- | --- | ---: |
| Field: `LexicalComposerInput` with our chip, formatter and plugins | `features/chat/composer/lexical/ComposerLexicalField.tsx` | 71 |
| Chip, the transcript's session-chip shape with a kind icon | `lexical/ComposerChip.tsx` | 45 |
| Chip formatter: session labels first, then the transcript grammar | `lexical/composer-chip-formatter.ts` | 39 |
| Plugins: ↵, ⌥↵, ⇧↵, Esc, ⇧⇥, ← and → over chips, paste, bridge to the trigger engine, history clear after a send | `lexical/composer-lexical-plugins.tsx` | ~190 |
| Edits: insert a pick as a chip, `+` Mention, masked text, pasted nodes | `lexical/lexical-edits.ts` | 170 |
| Bridge and flag | `lexical/lexical-bridge.ts`, `lexical/lexical-composer-flag.ts` | 79 |
| Wiring | `Composer.tsx` (+28), `triggers/ComposerTriggers.tsx` (+11), `attachments/ComposerAddMenu.tsx` (+10), `components/trigger-engine/use-trigger-field.ts` (+35, an optional `insert` hook) | ~85 |

Dependencies added, exact: `@assistant-ui/react-lexical` 0.2.25 and `lexical`, `@lexical/react`, `@lexical/utils`, `@lexical/history` and `@lexical/plain-text` at 0.53.0, the version the package is built and tested against.

### 2.1 How it fits together

- **The text stays in assistant-ui's composer.** react-lexical's `SyncPlugin` writes the editor's text into `composer.text` on every change. A chip contributes its directive text (`/review`, `@src/app.ts`, `@"a b.md"`, `@Fix login bug`). So drafts per thread, the attachment adapter and `use-submit-composition.ts` see the same string as today.
- **The trigger engine is unchanged.** react-lexical sends ↵, Esc, ↑, ↓, ⇥ and Backspace to the composer-input plugin registry before anything else, and reports the caret through it. Our engine was already registered there.
- **Picks become chips.** The engine gains an optional `insert` hook. In Lexical mode it replaces the token before the caret with a `DirectiveNode` and a space, instead of splicing text and calling `setText`. A directory pick (`@dir/`) stays plain text, so the token stays open for drill-down.
- **Chips are masked from detection.** The engine detects tokens in the composer text with each chip blanked to spaces of the same length. Without this, a caret just after `@src/app.ts` reopens the menu with that chip's text as the query.
- **Text from outside becomes chips.** When `composer.text` changes from outside the editor (a thread switch, a restored unsent message, a quote taking the text), `SyncPlugin` rebuilds the editor using our formatter's `parse`. Recorded session labels match first, because a title has spaces no pattern can find (#240).
- **Send goes through our path.** The field runs with `submitMode="none"`. react-lexical's own Enter calls `composer.send()` directly, which would skip quotes, session references and captures. Our Enter calls the card's `submit()`, which is the same function the textarea path uses.

## 3. How it was measured

`packages/ui/benchmarks/lexical-chips/` is a Vite fixture with a Playwright runner, in the same pattern as the transcript list rig (`benchmarks/transcript-list`). It mounts the real trigger engine, formatters, popover, chip field and plugins over a synthetic external-store runtime with an image attachment adapter. There is no daemon and no provider. `?textarea` mounts `ComposerPrimitive.Input` with the same engine, for a before/after comparison.

```sh
node packages/ui/benchmarks/lexical-chips/run.mjs              # WebKit, Lexical field
node packages/ui/benchmarks/lexical-chips/run.mjs --chromium   # Chromium, adds a CDP IME check
node packages/ui/benchmarks/lexical-chips/run.mjs --textarea   # WebKit, today's textarea
```

Playwright's WebKit is the engine behind Tauri's WKWebView on macOS, but not the same build, and it has no input-method driver. The fixture does not mount `Composer.tsx` itself, so the card's wiring of the same handlers (`handleLexicalEnter`, the `+` menu's mention) is covered by typecheck, not by a run.

Also run: `pnpm --filter @qlan-ro/mainframe-ui typecheck` (clean), the trigger-engine and composer unit suites with the flag off (74 files, 945 tests, all pass), and a new formatter test (4 tests).

## 4. Behaviour by behaviour

"Harness" means a measured row in WebKit and Chromium. "Construction" means the behaviour lives outside the field and the prototype does not change it.

### 4.1 Atomic chips

| Behaviour | Lexical | Textarea today | Evidence |
| --- | --- | --- | --- |
| A pick becomes one chip; text unchanged | **Pass** | Pass (coloured text) | Harness: `"see @src/app.ts "` in both |
| ← and → step over a chip in one press | **Pass** (with our arrow handler) | Fail: `@src/app.tXs` | Harness. Without the handler WebKit's caret stuck at the chip |
| A click can't put the caret inside a chip | **Pass** | Fail | Harness |
| Backspace removes a chip whole | **Pass** | Fail: `@src/app.t` | Harness |
| Delete (forward) removes a chip whole | **Pass** | Fail | Harness |
| Undo restores a deleted chip; redo removes it | **Pass** | Fail: redo garbles the text | Harness |
| Undo steps back over a pick | **Pass** | Fail: ⌘Z doesn't undo it | Harness. Confirms the study's untested suspicion |
| Copy and paste inside the field keeps chips | **Pass** (with our paste plugin) | Fail | Harness, real ⌘C/⌘V in both engines |
| Pasted text with tokens (from the transcript, say) becomes chips | **Pass** | Fail | Harness |
| No menu reopens with the caret against a chip | **Pass** | Reopens: the token is text | Harness |
| A path with spaces is one chip, `@"docs/my notes.md"` | **Pass** | Pass (text) | Harness |
| A session mention is one chip and survives a remount | **Pass** | Fail (no chip) | Harness |
| A token typed by hand, without the menu, becomes a chip | **Needs work** | Pass (coloured as you type) | It stays plain text until the next rebuild from outside. It still sends correctly. A Lexical text transform on space would close the gap (½ day) |

### 4.2 The rest of the composer

| Behaviour | Status | Evidence and notes |
| --- | --- | --- |
| ↵ sends; the field clears | **Pass** | Harness. Sent text `"hello @src/app.ts "` |
| ⇧↵ adds a new line | **Pass** | Harness. `"a\nb"` |
| Queue and steer: ↵ steers mid-run, ⌥↵ queues | **Pass** | Harness. The card's `handleLexicalEnter` uses the same rule and `submit()` as the textarea path |
| ⌘Z after a send leaves the field empty | **Pass** (fixed) | react-lexical records its runtime sync as a normal history step, so ⌘Z brought the sent text back. The prototype clears history when the runtime empties the field |
| `/` menu: commands and skills | **Pass** | Harness. `/review` chips |
| `@` menu: files, quoted paths, sessions, drill-down | **Pass** | Harness. `@src` → `src` → `@src/app.ts` |
| Menu keys: ↑ ↓, ↵ picks rather than sends, Esc closes | **Pass** | Harness |
| Esc order: menu first, then focus moves to the transcript | **Pass** | Harness |
| ⇧⇥ cycles the permission mode | **Pass** | Harness |
| `+` → Mention opens the `@` menu | **Pass** | Harness. The native-setter workaround (`open-mention-trigger.ts`) is not needed |
| Paste a file → attachment | **Pass** | Harness. A small plugin replaces the textarea's `addAttachmentOnPaste` |
| Drop zone and `+` → Attach | **Pass** (construction) | Outside the field, unchanged |
| ⌘L and the focus helpers find the field | **Pass** | Harness. `data-testid="chat-composer-input"` and `data-mf-composer-input` moved onto the contenteditable |
| Shortcuts and gate keys don't fire while typing | **Pass** (construction) | `shortcuts/eligibility.ts` and `GateGuard.tsx` already treat contenteditable as a text field |
| Combobox ARIA on the field | **Pass** | Harness. `role`, `aria-expanded` and `aria-activedescendant` are set on the contenteditable |
| Screen reader reads chips sensibly | **Needs work** | Each chip has `aria-label` set to its text. Not tried with VoiceOver |
| IME: ↵ during composition doesn't send | **Needs work** | Chromium: pass, with a real CDP composition (`日本`). WebKit: pass on a replayed event sequence only. Real WKWebView IME not tried (section 5) |
| Draft persistence | **Pass**, needs an in-app check | Harness: a remount and a runtime `setText` both rebuild the chips. react-lexical clears history and rebuilds on a thread switch, and ships its own thread-switch tests. Not run in the app, nor the `__LOCALID_*` slot reuse |
| Restore an unsent message | **Pass** | It goes through `setText`, the same path as a draft restore |
| Quoting | **Needs work** | The live field is fine: focus and `setText('')` on quote commit behave. Earlier quotes' text (`ComposerSegments`) stays in plain textareas, so a chip that moves into a committed segment shows as its text. The wire text is unchanged |
| Edit a queued message | **Needs work** | Unchanged: `ComposerEditMode` keeps its own textarea, with no chips and no regressions. Porting it to the Lexical field is about ½ day |
| Wire text sent to the daemon | **Pass** | `composer.text` is character for character what the textarea produces. `use-submit-composition.ts` and the mobile contract are untouched |
| Look | **Needs a design call** | Screenshots in the PR. The chip borrows the transcript's session-chip shape. The transcript shows `@path` as plain accent text, so whether the two should match is the owner's call |

## 5. Risks

- **IME in WKWebView.** Lexical handles composition itself, and our ↵ handler checks `isComposing` and keyCode 229. That held in Chromium with a real composition. WebKit composition events have a history of ordering quirks, and Playwright can't drive them. This is the go gate.
- **Contenteditable in WebKit in general.** The caret bug in section 1 is the kind of thing that turns up here. Word moves (⌥←) and line moves still use the native caret and were not measured across chips. Spellcheck, autocorrect and dictation were not tried.
- **Bundle.** react-lexical plus Lexical adds about 313 KB minified, 85 KB gzipped. That is local in Tauri, so the cost is parse time, not download.
- **Coupling.** The prototype keys one behaviour on react-lexical's internal sync tag (`'aui-sync'`, not exported). An upstream rename would bring back ⌘Z-after-send, and nothing else. It belongs in the exact-pinned assistant-ui set.
- **PR #980.** No overlap. #980 doesn't touch `use-submit-composition.ts` or any file here, and its scroll-key guards already skip `[contenteditable="true"]`. The prototype calls `useSubmitComposition` and doesn't change it, so it needs no submit hook of its own.

## 6. Effort to ship

| Work | Days |
| --- | ---: |
| The in-app check: IME (ja, zh, ko), dictation, VoiceOver, spellcheck, ⌥← over chips, compact scale, narrow widths | ½ |
| Make the field the default: drop the flag, delete `highlight/` (126 + 157 test lines) and `open-mention-trigger.ts`, tidy the plugins into files under 300 lines | ½–1 |
| Typed tokens become chips (a Lexical text transform on the formatter) | ½ |
| Edit mode on the Lexical field; chips in committed quote segments, or a decision to leave them as text | ½–1 |
| Tests: move the composer shell and trigger suites off textarea assumptions, keep this harness as a regression check, update the e2e selectors that `fill` the composer | 2 |
| Design: chip look agreed, and the composer artboard on the canvas (Proposals, then the product page) | ½ |
| Review and fixes | ½–1 |
| **Total** | **5–7** |

Net code: about 500 source lines added (the prototype, minus `open-mention-trigger.ts`), and the overlay and its caret-drift bug class (#99, #140, #93) removed. That is more than the study's "50–150 removed": the paste, arrow-key and history fixes in section 1 weren't foreseen, and the bridge between our engine and the editor is bigger than one insertion path.

## 7. Recommendation

**Go**, after the half-day in-app check in section 6 passes. The package does what the study hoped. With the two fixes in section 1 it removes the overlay and the "tokens are just text" problem, and every composer behaviour that matters keeps working. The open items are ordinary work (typed tokens, edit mode, tests), not unknowns. The one unknown is IME in WKWebView, and it can be settled in half a day before anything else is spent.

If the IME check fails, the fallback is to keep the textarea and give the overlay its alignment regression test, as the study suggested.
