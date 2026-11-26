# Composer: shadcn's pieces versus Mainframe's (26 November 2026)

Follow-up to the [shadcn agent components study](2026-11-26-shadcn-agent-components.md) (todo #469, PR #977). That study kept Mainframe's composer because theirs lacks queue and steer, the `/` and `@` triggers, and provider tabs. This report looks again, more closely, with special attention to the inline tokens for `@` mentions and `/` commands, and to attachments.

**The rule this report applies:** shadcn's components are more polished, so adopt theirs by default and extend them where something is missing. Keep Mainframe's only where theirs lacks something we need, and name it. Their look is acceptable.

## 1. What was studied

| Source | Version |
| --- | --- |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | commit [`0e5b2e6`](https://github.com/shadcn-ui/ui/commit/0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4) (25 Nov 2026), the same commit as #469 |
| AI Elements Prompt Input | [docs](https://ui.shadcn.com/docs/ai-elements/radix/prompt-input), [`apps/v4/examples/radix/prompt-input-demo.tsx`](https://github.com/shadcn-ui/ui/blob/0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4/apps/v4/examples/radix/prompt-input-demo.tsx) (237 lines), and the `preview-03` block's `prompt-input.tsx` (227 lines) |
| Core components | [Input Group](https://ui.shadcn.com/docs/components/radix/input-group) (147 lines), [Attachment](https://ui.shadcn.com/docs/components/radix/attachment) (206), [Textarea](https://ui.shadcn.com/docs/components/radix/textarea) (17), [Command](https://ui.shadcn.com/docs/components/radix/command) (203), [Combobox](https://ui.shadcn.com/docs/components/radix/combobox) (325, on `@base-ui/react`), plus the Base and Aria variants of each |
| [`@assistant-ui/react-lexical`](https://www.npmjs.com/package/@assistant-ui/react-lexical) | 0.2.25 (22 Nov 2026). Not shadcn, but the only inline-chip editor in Mainframe's stack (section 5.4) |
| Mainframe | `origin/main` at `03463ac4`; `packages/ui` pins `@assistant-ui/react` 0.15.13, `store` 0.3.8, `core` 0.3.12; `cmdk` 1.1.1; `react-textarea-autosize` 8.5.9 |

Line counts are `wc -l` of source files under `packages/ui/src`, with test files counted separately.

## 2. Short answer

**Adopt parts of it.** Take Prompt Input's layout: Input Group as the card, Attachment for every tile in the draft, and Input Group buttons for the toolbar. Keep the editing layer, which is assistant-ui's `ComposerPrimitive` plus Mainframe's trigger engine, and keep the model menu.

The reason is narrower than "theirs lacks queue and triggers". **shadcn has no editing layer at all.** Prompt Input is a docs example, not a component: a plain `<textarea>` in an Input Group, holding its text in `useState`, with Attachment chips above it, two dropdown menus and a send button. There is nothing in it for `@` or `/`, no inline tokens, no paste or drop handling, no drafts per thread, and its Enter handler doesn't check for IME composition. No shadcn component anywhere renders atomic tokens inside text. Combobox's chips are a tag field, with chips placed before a one-line input.

So "adopt their Prompt Input and extend it" would mean writing, on top of a plain textarea, everything `ComposerPrimitive` already does for us. That is roughly 300–500 lines, and it would reopen bugs assistant-ui has already fixed. It goes against the package's layering rule: assistant-ui owns state and behaviour, shadcn owns pixels.

**Inline chips are a separate decision.** Neither side has real chips today. Mainframe's "chips" are coloured text drawn behind a transparent textarea. If the owner wants atomic chips (one Backspace removes one, the caret steps over a chip in one move, undo restores it), the route in our stack is assistant-ui's own `@assistant-ui/react-lexical`, not shadcn. It needs an assistant-ui upgrade first. That is a spike for the owner to decide (section 7.3).

## 3. Our composer, end to end

### 3.1 Size

`packages/ui/src/features/chat/composer/` is 93 source files with 8,363 lines, and its tests add 13,717 lines. The trigger engine it uses lives in `components/trigger-engine/` (6 files, 499 source lines, 876 test lines), and `features/chat/session-references/` adds 154 more.

| Area | Path (under `features/chat/composer/` unless noted) | Src files | Src lines | Test lines |
| --- | --- | ---: | ---: | ---: |
| Shell, adapter, focus, card context | `Composer.tsx`, `attachment-adapter.ts`, `focus-composer.ts`, `read-live-composer-state.ts`, `thread-composer.tsx`, `composer-card-context.tsx`, `WorktreeSwitchBanner.tsx` | 7 | 735 | 1,567 |
| Text field overlay (token colours) | `highlight/` | 2 | 126 | 157 |
| `/` and `@` wiring | `triggers/` | 11 | 692 | 1,736 |
| Trigger engine | `components/trigger-engine/` | 6 | 499 | 876 |
| Session mentions | `sessions/`, `features/chat/session-references/` | 7 | 429 | 750 + |
| Quotes as segments | `segments/` | 7 | 483 | 830 |
| Attachment tiles | `attachments/` | 2 | 196 | 192 |
| Captures and code notes (C14) | `draft-content/` | 8 | 588 | 453 |
| Send, Stop, Queue/Steer | `send/` | 4 | 359 | 920 |
| Queued rows | `queue/` | 4 | 649 | 876 |
| Edit a queued message | `edit/` | 2 | 182 | 177 |
| Unsent first message | `unsent/` | 4 | 360 | 35 |
| Model, permissions, worktree, context | `config-toolbar/` | 28 | 2,542 | 4,673 |
| Strips above and below the card | `strips/` | 10 | 1,176 | 1,351 |

The parts a Prompt Input would replace are the shell, the attachment tiles, the draft-content tiles and the send buttons, about 1,900 source lines. The parts it says nothing about are the editing layer (overlay, triggers, engine, mentions, segments), about 2,200 lines.

### 3.2 The editor

- **What it is built on.** The field is `ComposerPrimitive.Input` from assistant-ui, which renders a `react-textarea-autosize` textarea (`Composer.tsx:97`). There is no contenteditable and no rich-text library. assistant-ui holds the text for each thread, sends it, and handles the Enter key, IME composition, pasting files, focus on run start and focus after a thread switch.
- **Tokens are text, coloured from behind.** The textarea's text is transparent (`text-transparent caret-foreground`). `highlight/ComposerHighlight.tsx` renders the same text in an absolutely positioned `div` behind it, with each recognised token wrapped in a coloured span (`render-highlights.tsx`): `/command` and `@path` in the primary colour, skills and sessions in their directive colours. The overlay may change only colour and weight, because any change in padding, font or wrapping moves the caret away from the glyphs. The two share one scroll wrapper (`Composer.tsx:228`), and a trailing zero-width space keeps the last empty line in step.
- **Triggers.** `triggers/ComposerTriggers.tsx` feeds Mainframe's own engine (`components/trigger-engine/use-trigger-field.ts`). It looks for `/` or `@` at the start of a word before the cursor (`detect.ts`), filters the adapters, and shows a cmdk list in a portalled Popover (`TriggerFieldPopover.tsx`). It owns ↑, ↓, Enter, Tab and Escape while a token is armed, plus Backspace to leave a category. The keys reach it through assistant-ui's internal composer-input plugin registry (`INTERNAL.useComposerInputPluginRegistryOptional`). `Unstable_TriggerPopoverRoot` stays mounted only so that registry exists. `/` lists daemon commands first, then skills. `@` lists agents, sessions and project files, and supports `@dir/` drill-down and `@/` or `@~` filesystem browsing through an async cache.
- **Insertion.** A pick replaces the token with literal text (`directive-formatter.ts`): `/skill`, `@path`, `@"path with spaces"`, `@dir/` (left open for drill-down) or `@<session label>`. It goes through `composer.setText`, and the engine then puts the caret back with `setSelectionRange`. The `+` menu's "Mention" writes `@` through the textarea's native value setter and dispatches an `input` event (`open-mention-trigger.ts`). A plain `setText` fires no DOM event, so the engine's tracked cursor would not move.
- **Caret and deletion.** A token is ordinary characters. The arrow keys step through it one character at a time, and Backspace removes one character, so `@src/app.ts` becomes `@src/app.t` and the overlay recolours whatever still parses. Nothing is atomic.
- **Undo.** Typing uses the textarea's native undo. A picked item arrives by setting the value programmatically, and browsers don't record that in the native undo stack. So ⌘Z probably can't step back over a pick. This comes from reading the code and was not checked in the app.
- **Paste.** assistant-ui's `addAttachmentOnPaste` (on by default) turns pasted files and images into attachments. Pasted text goes in as typed text, however long it is. Turning a long paste into an attachment is todo #440, still open.
- **IME.** assistant-ui ignores Enter during composition, and the composer's own handler for Enter during a turn checks `nativeEvent.isComposing` (`Composer.tsx:169`).
- **What is sent to the daemon.** Text is the only model, so tokens are found again by parsing at every step. `segments/use-submit-composition.ts` does the following:
  1. serializes the committed quote and text segments plus the field (`serialize-composition.ts`, with quotes as `> ` lines);
  2. expands each bare `@<label>` into `@session[<label>]` (`session-mention.ts`);
  3. adds the session reference lines (`reference-line.ts`);
  4. calls `thread.append` with the attachments marked complete. Captures and code notes are encoded by `draft-content/compose-message.ts`.

  The wire body is the plain `/skill`, `@path` and `@session[…]` text that the CLIs parse. That format is the contract with the daemon and with mobile.

### 3.3 Everything else

- **Attachments.** The adapter is assistant-ui's `AttachmentAdapter` (`attachment-adapter.ts`). It accepts any type, limits each file to 5 MB (with a toast when it refuses one), and reads the file into a data URL as an `image` or `document` part. The daemon upload happens when the message is sent. Files are dropped onto `ComposerPrimitive.AttachmentDropzone` and pasted through assistant-ui. The `+` menu clicks a hidden `ComposerPrimitive.AddAttachment`. Tiles (`attachments/ComposerAttachmentStrip.tsx`, `draft-content/DraftTile.tsx`) are 172 × 40 and show the extension square or thumbnail, the name, the dimensions and size, and a remove ×. An image tile opens a preview dialog. Captures and code annotations use the same tile with a note (`NoteTile.tsx`). The composer tiles **do not use** the Attachment component, although Mainframe has a copy of it in `components/ui/attachment.tsx` that the transcript uses (`UserAttachments.tsx`, `ToolResultImageThumbs.tsx`, `PanelAttachmentsGrid.tsx`).
- **Quotes.** Several quotes, each followed by the text written for it (`segments/`). The newest quote's text is the live field, and earlier ones are plain textareas with no triggers. Quotes are added from the selection toolbar, from "Quote in reply" and from the editor's "Add Agent Context".
- **Edit mode.** Edits a queued message in the same card, content only (`edit/ComposerEditMode.tsx`, `PATCH /queue/:id`).
- **Queue and steer.** During a turn, Enter queues or steers, depending on the "Enter while running" setting, and ⌥↵ does the other (`Composer.tsx:161`, `send/use-enter-mode.ts`). Send becomes a split Queue/Steer button beside a separate Stop (`send/SendControls.tsx`). Queued rows sit inside the card, and rows taken back by a Stop are kept on disk (`queue/held-queue-store.ts`). The full contract is C9 and C10 in `design/redesign/DECISIONS.md`.
- **Toolbar.** `+` (attach, mention), then the model with its effort, then permissions, a spacer, the context ring and Send/Stop (`config-toolbar/`). Every control is already a shadcn `DropdownMenu`, `Tabs` or `Collapsible`. The configuration belongs to the daemon and is never edited optimistically.
- **Provider tabs.** `ProviderTabs.tsx` sits at the top of `ModelMenu.tsx`. Browsing a tab changes nothing, and picking another provider's model switches the chat in place (C5).
- **Drafts.** Kept in memory only. assistant-ui keeps the text of each thread, and the thread's controllers stay alive in a registry, so a draft survives switching sessions but not a reload. Segments, draft content and session references are side stores keyed by thread id. They are cleared together on send and when the shared `__LOCALID_*` new-session slot is reused. A first message that failed is kept until it is restored or discarded (`unsent/`). Only held queue rows are written to disk.
- **Keyboard.**
  - ↵ sends, and ⇧↵ adds a new line.
  - During a turn, ↵ queues or steers and ⌥↵ does the other.
  - ⇧⇥ switches between Interactive and Auto-Edits.
  - Esc moves focus to the transcript (the trigger menu takes Esc first, and the composer turns off assistant-ui's Escape-to-cancel), and ⌘L brings it back.
  - ⌘. stops the conversation that last had focus.
  - In the trigger menu: ↑, ↓, ↵ or ⇥ to pick, Esc to close, and Backspace to leave a category.
- **Mobile.** No code is shared. Mobile lives in its own repository (`packages/mobile` is a submodule). What is shared is the wire text described above, and C10's mobile queue contract.

## 4. Bug history

There are 66 commits on the composer, the trigger engine, the attachment components and session references, and 35 of them mention a fix or a revert. The tracker has 63 todos whose titles match composer, mention, badge, slash, attachment, paste, draft, trigger, skill or quote. The table below groups the ones about the text field, the tokens and the attachments.

| Recurring problem | Evidence | Root cause | Would adoption have avoided it? |
| --- | --- | --- | --- |
| Caret drifts from the text; text shows in the wrong colour | #99 (caret a little below the text; text the same colour as the background after a gate), #140 (two scrollbars and caret offset on a long paste, a regression of an earlier fix), #93 (scroll sync listener) | Transparent textarea with a mirrored overlay. Any difference in typography, padding or scrolling between the two moves the caret, and every redesign of the field has to change both in step (#946, #955) | Prompt Input: **no**, it is a textarea with no tokens. Lexical chips: **yes**, there is no overlay |
| The trigger engine owns keys it shouldn't | #353 (an unknown `/compact` swallowed Enter until Esc and a click), the Escape ordering note at `Composer.tsx:59`, #316 (the `@` button submitted the form, and a programmatic `@` didn't open the menu) | Trigger state comes from the text plus a cursor tracked separately through the plugin registry. Writing the text programmatically skips the DOM events the engine relies on, hence the native-setter workaround | Prompt Input: no. Lexical: partly. Insertion goes through the editor API, but key ownership stays with the same registry |
| Token grammar has to cope with real-world text | #399 / `6fd747a3` (names with spaces need `@"…"`), #240 (session titles with spaces need a label store on the side and expansion at send), #829 (mention results) | There are no token objects. The text is the only model, so the overlay, the send step, the restore step and the draft move each parse tokens again | Prompt Input: no. Lexical: **yes** inside the editor, because a chip carries its id and label. The wire format stays the same |
| Draft state outlives its thread | #30 (content reappears after sending), #62 (attachments follow an archived chat), #359 and #365 (new-session slot reuse) | assistant-ui reuses one `__LOCALID_*` slot, and three side stores must be cleared in step with it | Neither |
| List layout in the sticky footer | #304 / `034ac5f1` (the menu pushed the thread up) | The list was laid out in flow inside the footer, whose height sets the scroll inset | Already fixed with a portal |
| Attachment tiles | #364 / `30f931ec` (widths varied), #342 (a message with only attachments didn't render), #219, `2b648e8b`, #300 (remote daemon, Codex dropped images), #845 (sent attachments shown late) | Tile sizing in the client. The rest was in the daemon and adapters | Attachment: sizing, yes, with fixed `size` variants. The daemon issues are unaffected |
| A failed fetch empties both pickers | #301 | Skills and agents were fetched together with one catch | Neither |

In short, the bugs that keep coming back in the text field come from two decisions: colouring tokens with an overlay, and treating tokens as plain text. **Adopting shadcn's Prompt Input changes neither**, because it is also a plain textarea. Only an editor with token nodes removes them.

## 5. shadcn's composer pieces

### 5.1 Prompt Input (AI Elements)

- **What it is.** A documented composition, with nothing to install as a component. You run `npx shadcn add input-group attachment dropdown-menu` and copy the example. The radix example is 237 lines:
  - `InputGroup`;
  - a `block-start` addon of `Attachment size="sm"` chips with a remove action;
  - an `InputGroupTextarea` whose text lives in `useState`;
  - a `block-end` addon with a `+` that clicks a hidden `<input type="file" multiple>`;
  - a model `DropdownMenu` (radio items grouped under a label per provider);
  - an effort `DropdownMenu`;
  - an `InputGroupButton type="submit"`.
- **Keyboard.** ↵ calls `requestSubmit()` and ⇧↵ adds a new line. The handler doesn't check `isComposing`, so ↵ submits in the middle of CJK composition.
- **Sub-parts the brief asked about.**
  - Attachments: chips only. There is no drop zone, no paste, no size limit and no preview, and the demo stores only the name.
  - Tools: none in the example. The `preview-03` block has a `+` menu with placeholder items.
  - Model select: two plain menus. The prior study kept ours because of provider tabs.
  - Submit/stop: the example has Send only. The `preview-03` block swaps in Stop when the AI SDK's `status` is `streaming`.
- **`@` and `/`.** Nothing. The note on migrating from the deprecated Vercel version says to "keep the command parts as they are", so the old version's cmdk command parts are not part of the shadcn version.

### 5.2 Core components

- **Input Group.** A `role="group"` wrapper with addons at `inline-start`, `inline-end`, `block-start` and `block-end`, plus `InputGroupButton`, `InputGroupText`, `InputGroupInput` and `InputGroupTextarea`, and a focus style scoped to the control. One gap: clicking an addon focuses `querySelector("input")` (`input-group.tsx:59`), so in a textarea group a click on the addon's padding focuses nothing. It's a one-line fix. Mainframe has a copy (133 lines), used by the palette, the URL bar and Command, but not by the composer.
- **Attachment.** `Attachment`, `AttachmentMedia`, `AttachmentContent`, `AttachmentTitle`, `AttachmentDescription`, `AttachmentActions`, `AttachmentAction`, `AttachmentTrigger` and `AttachmentGroup`. It has a `size` and a horizontal or vertical `orientation`. **It also has `state`: `idle`, `uploading`, `processing`, `error` or `done`.** The title shimmers while uploading or processing, and an error tints the border, the media and the description. The composer has no equivalent today: nothing shows while a large file is being read, and a failed restore can't mark a tile. Mainframe's copy (178 lines) is older than upstream (206).
- **Textarea.** A plain styled `<textarea>`.
- **Command.** cmdk. Mainframe already uses it for the trigger list's panel and rows. cmdk can't see a query that lives in another field, which is why the engine keeps filtering and the highlight itself.
- **Combobox.** Built on `@base-ui/react`. Its `ComboboxChips`, `ComboboxChip` and `ComboboxChipsInput` are a multi-select tag field: chips come first, then one input. That isn't inline tokens in prose, and the Base and Aria variants are the same.
- **Anything named mention, token or chip.** None, in the components or in AI Elements, for any base. The only "chips" are Attachment and the Combobox chips above.

### 5.3 Editor technology

Every shadcn input is a native `<input>` or `<textarea>`. Neither can hold an atomic inline element, so no shadcn component offers chips with correct caret movement, deletion, undo or paste. The registry directory points to third-party editors: `@plate` (Plate, with a mention plugin), `@shadcn-editor` and `@zenoadmin` (both Lexical), and `@prosekit`. They are community registries, not shadcn's own, and they bring a whole document editor. Mainframe would use one only for its token nodes.

### 5.4 The chip editor in our own stack: `@assistant-ui/react-lexical`

It is published by assistant-ui. `LexicalComposerInput` takes the place of `ComposerPrimitive.Input` inside `ComposerPrimitive.Root`. Its parts:

- **`DirectiveNode`.** A Lexical `DecoratorNode` that is inline and isolated, and that the keyboard can select. Its `getTextContent()` returns the directive text, so copy, paste and serialization keep the same plain text. The README says that "directives survive cursor navigation, selection, and copy/paste as a single unit".
- **History and Enter.** `HistoryExtension` provides undo. Enter is ignored during IME composition (`isCompositionKey`).
- **Plugins.** ↵, Esc, ↑, ↓, ⇥ and Backspace are delegated to **the same composer-input plugin registry our trigger engine already registers with**. A `CursorPlugin` broadcasts the caret position, and a `SyncPlugin` syncs both ways with the composer runtime, turning parsed directives into chips.
- **Custom chips.** A `directiveChip` render prop, which could be a shadcn `Badge`.
- **Tests.** The package ships tests for the cursor, the triggers, accessibility, thread switching and an external-store thread.

Gaps for Mainframe:

- **assistant-ui upgrade.** Its peers require `@assistant-ui/react` ≥ 0.15.36, `core` ≥ 0.3.38 and `store` ≥ 0.3.25. We pin 0.15.13, 0.3.12 and 0.3.8, and the whole set moves together.
- **No paste handling for files.** The textarea's `addAttachmentOnPaste` has no counterpart, so pasting images needs a small Lexical plugin.
- **Caret after an outside `setText`.** A `setText` from outside moves the caret to the end. Our engine's mid-text insertion would have to insert nodes through the editor instead.
- **Typed tokens become chips only if parsed.** A token typed out by hand becomes a chip only if our formatter learns to `parse`. Today it only serializes.
- **A contenteditable field.** It changes the field from a textarea, so the selectors, focus code and tests that assume a textarea must change. That includes the focus line, `has-[textarea:focus-visible]`. Its behaviour in WebKit (Tauri on macOS) needs a test.

## 6. Feature by feature

Effort is the effort to bring theirs up to what we need. S is under half a day, M is one to two days, and L is three days or more.

| Feature | Ours | Theirs (shadcn) | Effort to extend theirs | Judgement |
| --- | --- | --- | --- | --- |
| Card and layout | `ComposerPrimitive.Root` with hand-written card classes and a drop zone wrapper | **Input Group** with `block-start` and `block-end` addons and a focus style scoped to the control | S. Render assistant-ui's Root and Input inside it, and fix the addon focus for textareas | **Adopt.** About 20–50 lines go, and the anatomy becomes standard |
| Text field | assistant-ui's autosize textarea: per-thread drafts, IME, paste-to-attach, focus on run start | `InputGroupTextarea` with text in `useState` | L. Rewrite what assistant-ui does (300–500 lines) | **Keep ours.** Theirs has no editing layer. Style ours as `InputGroupTextarea` |
| `@` and `/` triggers and menu | Own engine, cmdk list in a portal, combobox ARIA, async file search, drill-down, sessions | None | L. That is our engine | **Keep ours.** It already uses shadcn Command and Popover for the pixels |
| Inline tokens | Coloured text in an overlay. Not atomic, so caret and deletion work per character | None. Combobox chips are a tag field | Not possible in shadcn core. `react-lexical` is assistant-ui's (§5.4) | **Spike, owner's call** (§7.3) |
| Attachment tiles (files, images) | `DraftTile`: 172 × 40, extension square or thumbnail, size, ×, preview | **Attachment**: media, title, description, actions, trigger, sizes, and `idle`, `uploading`, `processing`, `error` and `done` states | S. Size it to C14 with a class, keep `FadeLabel` and the tooltip, and use `state` for reading and errors | **Adopt.** About 60–90 lines go, draft and sent tiles become one component, and #364-style sizing bugs go away |
| Capture and code-note tiles | `NoteTile` on `DraftTile`, with a note pencil | Attachment with an action | S | **Adopt** with the tiles |
| Drop, paste, size limit | assistant-ui drop zone and paste, 5 MB limit with a toast | None | M | **Keep ours** (assistant-ui) |
| Long paste becomes an attachment | Not yet (#440) | None | S on our side | Build it on Attachment, with #440 |
| Quotes as segments | Own segments | None | — | **Keep ours** |
| Send, Stop, Queue/Steer split | `SendControls`: split button, Stop counts sub-agents, ⌘. | Send only. A block shows Stop while streaming | S for the pixels | **Adopt `InputGroupButton`** for the buttons; keep the behaviour |
| Queued rows, edit mode, unsent notice | Own | None | — | **Keep ours** (no shadcn equivalent; #469 agrees) |
| Model menu with provider tabs | `DropdownMenu`, `Tabs`, effort segment, switch in place | Two plain `DropdownMenu` radio menus | M | **Keep ours.** It already uses the same shadcn primitives; the difference is C5's behaviour |
| Permission menu, ⇧⇥ | Own, on `DropdownMenu` | None | — | **Keep ours** |
| Context ring | Own | Hover Card + Progress | S | Already #475 |
| Drafts | In memory per thread, held queue on disk | None | — | **Keep ours** |
| Keyboard | ↵, ⇧↵, ↵ or ⌥↵ during a turn, ⇧⇥, Esc, ⌘L, ⌘., menu keys | ↵ and ⇧↵, no IME guard | — | **Keep ours** |
| Accessibility | Combobox ARIA on the field (`aria-expanded`, `aria-activedescendant`, listbox), labelled tiles and remove buttons | `role="group"`, labelled remove button in the example | — | Ours does more. Theirs adds group semantics, which we get by adopting Input Group |

## 7. Verdict

### 7.1 Adopt parts: Prompt Input's layout, our editing layer

1. **Attachment for every tile the draft carries.** `DraftTile` becomes a C14-sized `Attachment` with `AttachmentMedia` (extension square or thumbnail), `AttachmentTitle` and `AttachmentDescription` (still `FadeLabel`), and `AttachmentActions` (note pencil, ×). The preview stays an overlay button. Use `state="processing"` while a file is being read into its data URL and `state="error"` for a file a Restore couldn't put back. Bring `components/ui/attachment.tsx` up to date with upstream first, so the draft tiles, the sent tiles and the panel grid share one current component.
2. **Input Group as the card.**
   - `ComposerPrimitive.Root` renders the form, with `InputGroup` inside the drop zone.
   - A `block-start` addon holds the queued rows, unsent notices, tiles and segments.
   - The field is `ComposerPrimitive.Input`, carrying `data-slot="input-group-control"` and the `InputGroupTextarea` classes, with the overlay unchanged.
   - A `block-end` addon holds the toolbar, and `+`, Send, Stop and the split button use `InputGroupButton`.
   - Apply the one-line fix so a click on the addon focuses a textarea too.
   - Keep the 16 px card, the shadow and the focus line from C3 as class overrides.
3. **Keep:** assistant-ui's input, the trigger engine and its adapters, segments, queue, edit mode, unsent notices, the model menu with provider tabs, and the permission menu. For each, the missing piece in theirs is named in the table above. The common reason is that shadcn ships no editing behaviour, so extending theirs would mean rewriting what assistant-ui and our engine already do.

| | Net lines removed (est.) | Effort | Risk |
| --- | ---: | --- | --- |
| Attachment tiles (with the resync) | 60–90 | ½–1 d | Low. Visual only, covered by tile tests and the canvas parity check |
| Input Group card | 20–50 | ½–1 d | Low. Layout. Check the overlay alignment, the gate footer shrink (#336), and narrow widths (C6, C9) |
| **Total** | **80–140** | **1–2 d** | **Low** |

Bugs avoided:

- tile sizing drifting between surfaces;
- no feedback while a large file is read;
- one tile look in the draft and another in the transcript;
- addon clicks that don't focus the field.

Polish: the upstream state styles and the standard anatomy.

### 7.2 Why not the whole Prompt Input

Adopting it whole means putting `InputGroupTextarea` and our own state where `ComposerPrimitive` is. We would then have to write:

- drafts per thread;
- the attachment adapter;
- the drop zone and paste-to-attach;
- autosize;
- ↵ that is safe during IME composition;
- focus on run start and after a thread switch;
- cancel.

That is about 300–500 more lines, and it would bring back bugs assistant-ui has already fixed. None of the recurring bugs in section 4 would go away, because theirs is also a plain textarea. That is the "really missing" part: **shadcn's Prompt Input has no editing layer**. It has no `@` or `/`, no inline tokens, no drafts per thread, no paste or drop handling and no IME guard. We could add all of it, but only by rewriting assistant-ui.

### 7.3 Inline chips: a spike on `@assistant-ui/react-lexical`, owner's decision

This is the only change that removes the two root causes in section 4: the overlay and tokens kept as plain text.

- **It would remove:**
  - the overlay (`highlight/`: 126 source and 157 test lines);
  - the native-setter workaround (`open-mention-trigger.ts`);
  - the session-label matching in the overlay;
  - the whole class of caret-drift bugs.
- **It would add:**
  - a Lexical insertion path in the trigger engine (about 80 lines);
  - a plugin for pasting files (about 30);
  - a chip rendered with shadcn `Badge` (about 40);
  - `parse` in our formatters.
- **Net:** about 50–150 source lines removed. The tests that assume a textarea (in the 1,567-line shell suite and the 1,736-line triggers suite, plus e2e) are largely rewritten.
- **Effort:** 4–6 days, including the assistant-ui upgrade.
- **Risk:** medium to high. The upgrade jumps from 0.15.13 to the current 0.15.x line, and the internal plugin registry may have changed. contenteditable needs testing in WebKit, and so do IME and caret behaviour in Tauri.
- **What stays the same:** the wire text. A chip's text content is the directive itself, so mobile and the daemon see no change.

**Recommendation:** do 7.1 now. Run 7.3 as a time-boxed spike, after the assistant-ui upgrade, if the owner wants atomic chips. Without that want, the overlay stays and gets its own regression test for alignment.

## 8. How this fits the transcript plan and #470–#475

The composer work is independent of the transcript scroll work (#455–#468), with three points to sequence:

- **#475 (Context hover card)** edits `config-toolbar/ContextRing.tsx`, which sits in the toolbar row that the Input Group change moves. Land them one after the other, either order, not as parallel branches.
- **#457 (record the assistant-ui boundary)** should record this result: for the composer, assistant-ui owns behaviour and the field, and shadcn owns the card (Input Group), the tiles (Attachment) and the buttons.
- **The assistant-ui upgrade** (needed only for 7.3) must not land while #456 or #461–#463 are in flight. Both rely on assistant-ui's viewport and scroll controllers at the pinned version. Upgrade either before #456 starts or after #463, and re-run the scroll proof rig (#455) afterwards.

#470–#474 touch the session panel, transcript rows, gates and tool output, and don't overlap with the composer. #440 (long paste becomes an attachment) depends on the Attachment tiles and should follow them.

## 9. Adoption todos (draft)

| Title | Summary | Depends on |
| --- | --- | --- |
| Composer tiles on shadcn Attachment | Bring `components/ui/attachment.tsx` up to date with upstream and rebuild `DraftTile`, `NoteTile` and the file tile on it, at the C14 size. Show `processing` while a file is read and `error` for a tile a Restore couldn't put back. | none |
| Composer card on shadcn Input Group | Render `ComposerPrimitive.Root` and `Input` inside `InputGroup`, with `block-start` (queue, notices, tiles, segments) and `block-end` (toolbar) addons and `InputGroupButton` for `+`, Send, Stop and the split. Fix the addon click so it focuses a textarea. | the Attachment tiles todo; land in sequence with #475 |
| Long paste becomes a text attachment (existing #440) | Build the over-600-characters paste on the Attachment tiles. | the Attachment tiles todo |
| Upgrade the assistant-ui set to the current 0.15.x | Move `react`, `core`, `store`, `tap` and `react-markdown` together, and check the composer-input plugin registry, the trigger engine, ComposerPrimitive and the thread viewport. Re-run #455. | before #456 or after #463 |
| Spike: inline chips with `@assistant-ui/react-lexical` | Replace the textarea and overlay with `LexicalComposerInput`, chips rendered as shadcn `Badge`. Measure caret, deletion, undo, paste, IME and accessibility in WebKit, and keep the wire text the same. Then decide whether to adopt. | the assistant-ui upgrade todo; owner decision |
