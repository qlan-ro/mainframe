# Keyboard shortcuts — implementation plan (todo #324)

Spec: `docs/specs/2026-08-14-todo-324-keyboard-shortcuts.md`. Branch: `todo/324-keyboard-shortcuts`.

## Goal

Replace the nine independent window-level keydown listeners in `packages/ui` with one declarative
shortcut set and one mounted dispatcher, keeping every shipped chord on its current key and action;
add the bindings the app lacks (⌃1…⌃9 session-tab switching, ⌃Tab/⌃⇧Tab cycling, ⌘⇧\ open-in-split,
⌘L focus-composer, ⌘/ cheat sheet); and ship a read-only cheat-sheet dialog that renders the declared
set so a new entry appears in it with no change to the dialog. The chord matcher works on the
physical key (`KeyboardEvent.code`), resolves ⌘/Ctrl per platform, is exact on all four modifier
flags, yields to the code editor for the entries that declare it, and fails a test when two entries
resolve to the same chord on either platform. The work is renderer-only: no daemon, no Rust, no
mobile, no native-menu changes.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file and 50 lines/function; `data-testid` on every interactive
  element, kebab-case `<surface>-<element>`, keyed by domain id not array index; no `@ts-ignore`;
  comments say *why*; remove dead code in the same pass ("no leftovers"); a changeset is required.
- `packages/ui/CLAUDE.md`: `components/ui/` primitives stay **passthrough** — this is why the ⌘B
  listener must leave `components/ui/sidebar/context.tsx`. Features never import `layout/`. Pure
  logic lives outside React. Read the `mainframe-design-system` skill before writing markup.
- Test env (`packages/ui/vitest.config.ts:24-42`): `*.test.ts` runs in **node**, `*.test.tsx` runs in
  **jsdom**. Pure-function tests must be `.test.ts`; anything touching the DOM must be `.test.tsx`
  (or carry a `// @vitest-environment jsdom` pragma).
- Run single test files: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`.

## Established facts

Every line below was verified while planning. Implementers and reviewers should trust these instead
of re-deriving them.

1. **`@codemirror/commands`' `defaultKeymap` binds `Mod-/` to `toggleComment`.** Receipt:
   `node_modules/@codemirror/commands/dist/index.js:1797` inside the `defaultKeymap` array declared at
   `:1779`. This is why ⌘/ must be editor-yielding.
2. **`defaultKeymap` also binds `Shift-Mod-\` to `cursorMatchingBracket`.** Receipt:
   `node_modules/@codemirror/commands/dist/index.js:1796`. The spec's new ⌘⇧\ open-in-split chord
   collides with it inside the editor. See Decision D1.
3. **`@codemirror/search`'s `searchKeymap` binds `Mod-f` to `openSearchPanel`.** Receipt:
   `node_modules/@codemirror/search/dist/index.js:1044`. This is why ⌘F is editor-yielding.
4. **Mainframe's editor loads both keymaps.** Receipt:
   `packages/ui/src/features/editor/cm-setup.ts:198` — `keymap.of([indentWithTab, ...defaultKeymap,
   ...historyKeymap, ...searchKeymap])`.
5. **`defaultKeymap` binds nothing on Ctrl+Tab.** Receipt: `grep -n "Tab" node_modules/@codemirror/
   commands/dist/index.js` returns only `indentWithTab`-adjacent entries; no `Ctrl-Tab` / `Mod-Tab`
   key string exists in the array at `:1779-1801`. Confirms the spec's "⌃Tab is not editor-yielding".
6. **jsdom 29.1.1 implements `KeyboardEvent.code`.** Receipt:
   `node_modules/.pnpm/jsdom@29.1.1_@noble+hashes@2.2.0/node_modules/jsdom/lib/generated/idl/
   KeyboardEvent.js:290-299` (the `code` getter returning `esValue[implSymbol]["code"]`) and `:414`
   (`code: { enumerable: true }`). `new KeyboardEvent('keydown', { code: 'KeyN', metaKey: true })`
   therefore round-trips `code` in the `dom` vitest project — the whole test strategy rests on this.
7. **The terminal registers no custom key handler.** Receipt: `grep -rn
   "attachCustomKeyEventHandler" packages/ui/src` returns nothing;
   `packages/ui/src/features/terminal/create-terminal.ts` never installs one. xterm's own handler does
   not stop propagation, which is why ⌘F from terminal focus reaches the window listener today.
8. **Every modal in the app renders through one of two slots.** `DialogContent` sets
   `data-slot="dialog-content"` (`packages/ui/src/components/ui/dialog.tsx:44`) and
   `AlertDialogContent` sets `data-slot="alert-dialog-content"`
   (`packages/ui/src/components/ui/alert-dialog.tsx:36`). Radix portals unmount closed content, so
   presence of either selector means "a modal is open".
9. **The search palette is a Dialog.** Receipt: `packages/ui/src/features/palette/
   SpotlightPalette.tsx:125` renders `<CommandDialog>`, which wraps `DialogContent`
   (`packages/ui/src/components/ui/command.tsx:36-41`). So the modal-open predicate in fact 8 makes
   ⌘/ inert over the palette for free.
10. **The composer input is addressable in the DOM.** Receipt:
    `packages/ui/src/features/chat/composer/Composer.tsx:93` — `data-mf-composer-input` on
    `ComposerPrimitive.Input`. An existing consumer proves the pattern:
    `packages/ui/src/features/chat/smart-actions/use-instruction-actions.ts:30`.
11. **A split zone marks its focus in the DOM.** Receipt:
    `packages/ui/src/features/chat/zones/ChatZone.tsx:100-102` — `data-testid={`chat-zone-${chatId}`}`
    plus `data-focused={focused}`. `[data-focused="true"] [data-mf-composer-input]` therefore selects
    the visible chat's composer while split.
12. **The transcript viewport is addressable but not focusable.** Receipt:
    `packages/ui/src/features/chat/thread/ChatThread.tsx:158-162` — `data-testid="chat-thread-viewport"`
    and `data-mf-chat-thread`, with no `tabIndex`. Escape-to-transcript needs `tabIndex={-1}` added.
13. **`toggle-sidebar` already has a working intent path.** Receipt:
    `packages/ui/src/store/intent-subscriber.ts:152-155` calls `useUiPrefs.getState().toggleSidebar()`;
    `packages/ui/src/features/palette/palette-commands.ts:15` already emits the intent. The ⌘B action
    can use it instead of the ui/ primitive's own listener.
14. **`activate-surface` is not a toggle.** Receipt: `packages/ui/src/layout/SurfaceHost.tsx:40-48`
    only calls `toggleSurface` when the surface is *inactive*, whereas the ⌘1/⌘2 keydown at
    `:67-82` calls `toggleSurface` unconditionally. Reusing the intent would silently change ⌘1/⌘2
    from toggle to activate. See Decision D2.
15. **The sidebar chord is `'b'` and already excludes Shift by accident.** Receipt:
    `packages/ui/src/components/ui/sidebar/context.tsx:7` (`SIDEBAR_KEYBOARD_SHORTCUT = 'b'`) and
    `:95` (`event.key !== SIDEBAR_KEYBOARD_SHORTCUT`) — with Shift held `event.key` is `'B'`, so the
    guard already rejects ⌘⇧B.
16. **`⌘P` in the workspace add-menu is a phantom hint.** Receipt: the hint at
    `packages/ui/src/layout/WorkspaceAddMenu.tsx:70` (`<RowHint>⌘P</RowHint>`), against
    `grep -rn "metaKey" packages/ui/src` which lists every modifier handler in the package and
    contains no `p` binding, and `grep -rn "open-file-picker"` which shows only click/menu emitters.
    See Decision D5.
17. **The tab strip's displayed order is computed inline and is not the store order.** Receipt:
    `packages/ui/src/features/session-tabs/SessionTabs.tsx:74` (`[...tabIds, previewId, draftId]`) and
    `:85-91` (split members regrouped adjacently at the first member's position). Spec AC 10 and AC 12
    are defined in *displayed* order, so this computation must move into `tabs-model.ts`.
18. **The open-in-split gesture already has a pure guard.** Receipt:
    `packages/ui/src/features/chat/zones/open-in-split.ts:24-32` (`canOpenInSplit`) and `:34-43`
    (`openInSplit`). The keyboard partner search reuses `canOpenInSplit`, so the shortcut and the
    context menu can never disagree about what is splittable.
19. **`docs/plans/` is gitignored.** Receipt: `git check-ignore -v docs/plans/x.md` →
    `.gitignore:53:docs/plans/`. Committing a plan needs `git add -f`.

## Decisions taken in-lane

- **D1 — ⌘⇧\ (open-in-split) is declared editor-yielding, extending the spec's set of two.** The spec
  names ⌘F and ⌘/ as the only editor-yielding entries, but fact 2 shows `Shift-Mod-\` is a live
  CodeMirror binding. Firing open-in-split from inside the editor would break the spec's own stated
  rule ("a chord fired while focus is inside a code editor does not steal the editor's binding"). No
  acceptance criterion asserts ⌘⇧\ fires from editor focus (AC 8 pins only the physical-key
  behavior), so the yield violates nothing. This is a deliberate deviation from the spec's Decisions
  list.
- **D2 — ⌘1/⌘2 register their action in `SurfaceHost`; no new surface intent.** Fact 14: the existing
  `activate-surface` intent is activate-if-inactive, not toggle. `SurfaceHost` already holds
  `toggleSurface`, so it registers `workspace.toggle-chat` / `workspace.toggle-workspace` directly.
- **D3 — ⌃1…⌃9 is ONE registry entry carrying nine chords, not nine entries.** The descriptor's chord
  field is `Chord | readonly Chord[]`; the dispatcher passes the matched chord's index to the action;
  the cheat sheet renders a multi-chord entry as `render(first) + ' … ' + render(last)`, so the range
  label stays platform-correct with no hardcoded glyph string. Conflict detection iterates every
  chord of every entry, so all nine are still checked.
- **D4 — the registry holds pure data; actions register at mount.** `registry.ts` exports descriptors
  only (id, chord(s), label, group, flags) — no imports of stores, intents or React. Handlers live in
  a separate action store keyed by shortcut id, and each owning scope registers its handler with a
  `useShortcutAction(id, fn)` hook. A chord whose action is not registered is inert. This is what
  makes chat-scoped shortcuts (find, splits, focus-composer, surface toggles) correct: they only work
  while their surface is mounted, exactly as today. Implementers must NOT move these actions to
  module scope.
- **D5 — the phantom `⌘P` hint in `WorkspaceAddMenu.tsx:70` is deleted, not implemented.** Fact 16
  shows nothing binds ⌘P. Adding a binding is out of scope (the spec declines re-mapping and adding
  chords beyond the listed set); leaving a hint that lies is the exact drift this feature exists to
  kill, and the "no leftovers" rule says fix it in the same pass.
- **D6 — cheat-sheet visual treatment mirrors `QuickTaskDialog`.** Per the todo's Design direction,
  the lane makes the visual call. `QuickTaskDialog` is the closest shipped read-only-ish `Dialog`
  with `kbd` chips (`packages/ui/src/features/tasks/QuickTaskDialog.tsx:246`), so the cheat sheet uses
  the same `Dialog`/`DialogHeader`/`DialogTitle` shell and the same `kbd` chip recipe. Load the
  `mainframe-design-system` skill before writing the markup and mirror that component rather than
  inventing a treatment.

## Module map

New directory `packages/ui/src/features/shortcuts/`:

| File | Contents |
| --- | --- |
| `shortcut-types.ts` | `Chord`, `PlatformChord`, `ShortcutGroup`, `ShortcutDescriptor`, `ShortcutAction` |
| `platform.ts` | `isMacPlatform()` — the one `navigator` read, injectable in tests |
| `chord.ts` | `resolveChord(chord, isMac)`, `chordList(entry)`, `matchesChord(event, resolved)`, `chordKey(resolved)` |
| `render-chord.ts` | `renderChord(chord, isMac)`, `renderEntryChord(entry, isMac)` (range form) |
| `eligibility.ts` | `isEligibleTarget(target, entry)` — editor yield + modifier-less text-field rule |
| `registry.ts` | `SHORTCUTS`, `shortcutById(id)`, `visibleShortcuts(entries, { dev })` |
| `conflicts.ts` | `findChordConflicts(entries, isMac): string[][]` |
| `action-store.ts` | id → handler map + `useShortcutAction(id, fn)` |
| `use-shortcut-dispatcher.ts` | the single mounted window keydown listener |
| `cheat-sheet-store.ts` | open state, `toggleCheatSheet()`, `anotherModalOpen()` |
| `ShortcutsCheatSheet.tsx` | the dialog, rendered from `visibleShortcuts()` |
| `use-app-shortcut-actions.ts` | registers the app-root actions (new session, palette, review, settings, sidebar, cheat sheet) |

Deleted: `packages/ui/src/app/use-global-overlay-hotkeys.ts`,
`packages/ui/src/features/sessions/use-new-chat-hotkey.ts`,
`packages/ui/src/features/chat/find/use-find-hotkey.ts`,
`packages/ui/src/features/chat/find/should-open-find.ts` (generalized into `eligibility.ts`),
`packages/ui/src/features/chat/zones/use-zone-hotkeys.ts` (replaced by an action-registration hook).

## Types (the contract every task codes against)

```ts
export interface Chord {
  /** KeyboardEvent.code — the physical key ('KeyN', 'Digit1', 'Backslash', 'Comma', 'Slash', 'Tab'). */
  code: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Literal Control, independent of platform. */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** A chord that resolves differently per platform (⌃1 on macOS, Alt+1 off it). */
export type PlatformChord = Chord | { mac: Chord; other: Chord };

export type ShortcutGroup = 'Sessions' | 'Chat' | 'Workspace' | 'App';

export interface ShortcutDescriptor {
  id: string;
  chord: PlatformChord | readonly PlatformChord[];
  label: string;
  group: ShortcutGroup;
  /** Absent from production builds and the production cheat sheet. */
  dev?: boolean;
  /** Stands down when the keystroke came from inside the code editor. */
  editorYielding?: boolean;
}

/** `chordIndex` is the position of the matched chord in a multi-chord entry (D3). */
export type ShortcutAction = (chordIndex: number) => void;
```

Resolution rule: on macOS `mod → metaKey`, off macOS `mod → ctrlKey`; `ctrl → ctrlKey` on both. A
resolved chord is `{ code, meta, ctrl, alt, shift }` and matching is **exact on all four flags**, so a
chord without `shift` never fires while Shift is held.

## Tasks

TDD ordering: every pure module gets its red test file first (Group A), then the implementation
(Group B). Component/integration tests that verify already-written code come last (Group E).

### Group A — red-phase pure tests (`shortcut-core-tests`)

All new files, node environment (`.test.ts`). Each test file imports modules that do not exist yet
and MUST be observed failing before Group B runs.

**Task 1 — chord resolution and matching tests.**
File: `packages/ui/src/features/shortcuts/__tests__/chord.test.ts`.
Cover: `mod` resolves to meta on macOS and ctrl off it; literal `ctrl` resolves to ctrl on both;
exact-flag matching (a chord without `shift` does not match a Shift-held event — AC 7; a chord
without `mod` does not match a ⌘-held event); code matching ignores `event.key` (dispatch
`{ code: 'Backslash', key: '|', shiftKey: true, metaKey: true }` and match ⌘⇧\ — AC 8; same for
`{ code: 'KeyT', key: 'T' }`); `chordList` normalizes single/array/platform forms.
Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/shortcuts/__tests__/chord.test.ts`
fails with an unresolved-import error.

**Task 2 — chord rendering tests.**
File: `packages/ui/src/features/shortcuts/__tests__/render-chord.test.ts`.
Cover (AC 17): macOS renders `⌘⇧R`, `⌥`, `⌃`; non-macOS renders `Ctrl+Shift+R`, `Alt`, `Ctrl`;
symbol keys render as `\`, `/`, `,`, `Tab`, digits as `1`; a platform chord picks the right variant;
a multi-chord entry renders `⌃1 … ⌃9` on macOS and `Alt+1 … Alt+9` off it (D3).
Verify: the file fails on unresolved import.

**Task 3 — eligibility tests.**
File: `packages/ui/src/features/shortcuts/__tests__/eligibility.test.ts` with a
`// @vitest-environment jsdom` pragma (it builds real elements).
Cover: an `editorYielding` entry is ineligible when the target is inside `.cm-editor` and eligible
otherwise (AC 5); a non-yielding entry is eligible from inside `.cm-editor` (⌘N — AC 5); every entry
is eligible from inside the terminal container (AC 6); a chord **without** `mod` is ineligible when
the target is an `<input>`, `<textarea>` or `[contenteditable]`, and a chord **with** `mod` is
eligible there (AC 3/AC 4); a non-Element target (e.g. `window`) is eligible.
Verify: the file fails on unresolved import.

**Task 4 — registry conflict + visibility tests.**
File: `packages/ui/src/features/shortcuts/__tests__/registry.test.ts`.
Cover (AC 9, AC 16): `findChordConflicts(SHORTCUTS, true)` and `findChordConflicts(SHORTCUTS, false)`
both return `[]`; a fixture set with a deliberate duplicate returns that pair (so the guard itself is
proven, not just the current set); `visibleShortcuts(SHORTCUTS, { dev: false })` excludes the
`dev: true` entry and `{ dev: true }` includes it; ids are unique; every group value is one of the
four; every declared entry has a non-empty label.
Verify: the file fails on unresolved import.

**Task 5 — tab-order and split-partner tests.**
File: `packages/ui/src/features/session-tabs/__tests__/tabs-model.keyboard.test.ts`.
Cover: `displayedTabIds({ tabIds, previewId, draftId }, zones, mainThreadId)` reproduces
`SessionTabs.tsx:74` order and the split regrouping at `:85-91` (fact 17); `tabAtIndex(displayed, n)`
returns `null` when `n` exceeds the tab count (AC 10 — ⌃5 with three tabs); `nextTabId(displayed,
activeId, +1)` wraps from last to first and `-1` wraps from first to last (AC 11), and returns the
same id with one tab open; `nextSplitPartner(displayed, activeId, zones)` returns the nearest
following id for which `canOpenInSplit` is true, wrapping past the end, and `null` when none
qualifies (one session open; the active session an unsent draft; both split slots already filled by
the only two sessions) — AC 12.
Verify: the file fails on unresolved import.

### Group B — pure core (`shortcut-core`)

**Task 6 — chord module.**
Files: `packages/ui/src/features/shortcuts/shortcut-types.ts`,
`packages/ui/src/features/shortcuts/platform.ts`, `packages/ui/src/features/shortcuts/chord.ts`.
`platform.ts` exports `isMacPlatform(): boolean` reading `navigator.platform`/`userAgent` once behind
a function so tests pass the boolean explicitly everywhere else.
Verify: Task 1's file passes; no other test regresses.

**Task 7 — chord rendering.**
File: `packages/ui/src/features/shortcuts/render-chord.ts`.
Verify: Task 2's file passes.

**Task 8 — eligibility.**
File: `packages/ui/src/features/shortcuts/eligibility.ts`. Move the `.cm-editor` `closest()` check out
of `should-open-find.ts` and generalize it; **delete**
`packages/ui/src/features/chat/find/should-open-find.ts` and its test file in the same task (no
leftovers) after re-pointing any importer.
Verify: Task 3's file passes; `grep -rn "should-open-find" packages/ui/src` returns nothing.

**Task 9 — the registry and the conflict checker.**
Files: `packages/ui/src/features/shortcuts/registry.ts`,
`packages/ui/src/features/shortcuts/conflicts.ts`.
Declare exactly the spec's set, ids namespaced by group:

| id | chord | group | flags |
| --- | --- | --- | --- |
| `sessions.new` | mod+`KeyN` | Sessions | |
| `sessions.tab-by-index` | 9 chords: mac `ctrl+Digit1..9`, other `alt+Digit1..9` | Sessions | |
| `sessions.tab-next` | mac `ctrl+Tab`, other `ctrl+Tab` | Sessions | |
| `sessions.tab-prev` | mac `ctrl+shift+Tab`, other `ctrl+shift+Tab` | Sessions | |
| `sessions.open-in-split` | mod+shift+`Backslash` | Sessions | editorYielding (D1) |
| `sessions.close-split` | mod+`Backslash` | Sessions | |
| `sessions.toggle-sidebar` | mod+`KeyB` | Sessions | |
| `chat.find` | mod+`KeyF` | Chat | editorYielding |
| `chat.focus-composer` | mod+`KeyL` | Chat | editorYielding |
| `workspace.toggle-chat` | mod+`Digit1` | Workspace | |
| `workspace.toggle-workspace` | mod+`Digit2` | Workspace | |
| `app.search-palette` | mod+`KeyO` | App | |
| `app.review` | mod+shift+`KeyR` | App | |
| `app.settings` | mod+`Comma` | App | |
| `app.quick-task` | mod+shift+`KeyT` | App | |
| `app.cheat-sheet` | mod+`Slash` | App | editorYielding |
| `app.automations` | mod+shift+`KeyA` | App | dev |

Carry the ⌘1/⌘2-vs-⌃1..⌃9 rationale as a one-line `why` comment on `sessions.tab-by-index` so the
next person does not re-litigate it (the todo brief asks for this explicitly).
Verify: Task 4's file passes.

**Task 10 — tab-order and split-partner helpers.**
File: `packages/ui/src/features/session-tabs/tabs-model.ts` (additions).
Add `displayedTabIds`, `tabAtIndex`, `nextTabId`, `nextSplitPartner`. `nextSplitPartner` imports
`canOpenInSplit` from `features/chat/zones/open-in-split.ts` (fact 18) — the pure guard only, never
`openInSplit` (which reads the store).
Verify: Task 5's file passes; `tabs-model.ts` stays under 300 lines (it is 202 today — split into a
`tabs-keyboard-model.ts` sibling if the additions push it past the cap).

**Task 10a — cheat-sheet store.**
File: `packages/ui/src/features/shortcuts/cheat-sheet-store.ts`.
`open`, `setOpen`, and `toggleCheatSheet()` implementing the spec's three-way rule: open → close;
closed and `document.querySelector('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')`
non-null → do nothing (facts 8/9); otherwise open. It lives in the core group, not with the dialog,
so Task 12 can register the ⌘/ action without waiting on Group D — the dialog reads this store, never
the other way round.
Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Group C — dispatcher and migration (`dispatcher-and-migration`)

**Task 11 — action store and dispatcher.**
Files: `packages/ui/src/features/shortcuts/action-store.ts`,
`packages/ui/src/features/shortcuts/use-shortcut-dispatcher.ts`.
The dispatcher: one `window` keydown listener; for each visible entry (dev-filtered at this one
mount site), for each of its chords, resolve for the live platform and match; on a match check
`isEligibleTarget`, look up the handler, and if present `preventDefault()` and call it with the chord
index. No handler → no `preventDefault`, no dispatch. `useShortcutAction(id, fn)` registers on mount
and removes on unmount, holding the callback in a ref so re-renders do not re-register.
Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

**Task 12 — mount the dispatcher and register the app-root actions.**
Files: `packages/ui/src/features/shortcuts/use-app-shortcut-actions.ts` (new),
`packages/ui/src/app/AppShell.tsx`.
`RuntimeBody` calls `useShortcutDispatcher()` and `useAppShortcutActions(...)`. Registered here:
`sessions.new` → the existing `useNewChatHotkeyHandler(aui)` callback; `app.search-palette` /
`app.review` / `app.settings` → the same `emitSurfaceIntent` calls the deleted hooks made;
`sessions.toggle-sidebar` → `emitSurfaceIntent({ type: 'toggle-sidebar' })` (fact 13);
`app.cheat-sheet` → `toggleCheatSheet()` from Task 10a.
Delete from `AppShell.tsx`: the ⌘, `useEffect` (`:84-93`), the `useNewChatHotkey` import and call,
the `useGlobalOverlayHotkeys` import and call. Delete the files
`packages/ui/src/app/use-global-overlay-hotkeys.ts` and
`packages/ui/src/features/sessions/use-new-chat-hotkey.ts` plus their tests.
Verify: typecheck; `grep -rn "use-new-chat-hotkey\b\|use-global-overlay-hotkeys" packages/ui/src`
returns nothing (the `use-new-chat-hotkey-handler` module stays — different file).

**Task 13 — migrate the four host listeners.**
Files: `packages/ui/src/layout/SurfaceHost.tsx`,
`packages/ui/src/features/tasks/TasksModalHost.tsx`,
`packages/ui/src/features/automations/AutomationsHost.tsx`,
`packages/ui/src/components/ui/sidebar/context.tsx`.
- `SurfaceHost`: delete the `handleKeyDown`/`useEffect` pair (`:67-82`) and the now-unused
  `SHORTCUT_MAP`; register `workspace.toggle-chat` and `workspace.toggle-workspace` →
  `toggleSurface('chat'|'workspace')` (D2).
- `TasksModalHost`: delete the `useEffect` at `:52-62`; register `app.quick-task` → `openQuick()`.
- `AutomationsHost`: delete the `useEffect` at `:46-56` **including its `import.meta.env.DEV` guard**
  — the registry's `dev` flag is now the single gate; register `app.automations` → `openHost()`.
- `components/ui/sidebar/context.tsx`: delete the `useEffect` at `:93-102` and the now-unused
  `SIDEBAR_KEYBOARD_SHORTCUT` export (check `components/ui/sidebar/index.ts:7` and re-export
  consumers before removing). The primitive returns to passthrough.
Verify: typecheck; `grep -rn "addEventListener('keydown'" packages/ui/src/layout
packages/ui/src/features/tasks packages/ui/src/features/automations
packages/ui/src/components/ui/sidebar` returns nothing.

**Task 14 — migrate the chat-scoped listeners and add the chat actions.**
Files: `packages/ui/src/features/chat/thread/ChatThread.tsx`,
`packages/ui/src/features/chat/zones/use-zone-shortcut-actions.ts` (new, replacing
`use-zone-hotkeys.ts`), `packages/ui/src/features/sessions/new-thread/ChatSurface.tsx`.
- `ChatThread`: replace `useFindHotkey()` with `useShortcutAction('chat.find', () =>
  useFindInChatStore.getState().open())`; delete `use-find-hotkey.ts` and its test; add
  `tabIndex={-1}` to `ThreadPrimitive.Viewport` (fact 12).
- `use-zone-shortcut-actions.ts`: registers `sessions.close-split` with the exact body of today's
  `use-zone-hotkeys.ts:17-27` (guard → `closeSplit()` → `switchToThread(survivor)`), and
  `sessions.open-in-split` → resolve the partner via `nextSplitPartner(displayedTabIds(...),
  activeTabId, zones)` and call `openInSplit(activeTabId, partner)`; inert when the partner is null
  (AC 12).
- `ChatSurface`: swap `useZoneHotkeys(aui)` for the new hook; register `chat.focus-composer` →
  focus `document.querySelector('[data-focused="true"] [data-mf-composer-input]') ??
  document.querySelector('[data-mf-composer-input]')` (facts 10/11), a no-op when neither exists.
Verify: typecheck; `grep -rn "use-find-hotkey\|use-zone-hotkeys" packages/ui/src` returns nothing.

**Task 15 — session-tab keyboard actions.**
File: `packages/ui/src/features/session-tabs/SessionTabs.tsx`.
Replace the inline `displayIds` / `ordered` computation (`:74`, `:85-91`) with a call to
`displayedTabIds` from Task 10 — the strip and the shortcuts must read the same function, not two
copies. Register `sessions.tab-by-index` → `tabAtIndex(ordered, chordIndex)` then
`aui.threads.switchToThread(id)` when it is not already active, and `sessions.tab-next` /
`sessions.tab-prev` → `nextTabId(ordered, activeTabId, ±1)` then switch.
Verify: typecheck; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run
src/features/session-tabs/__tests__` stays green; `SessionTabs.tsx` stays under 300 lines.

**Task 16 — Escape returns focus from the composer to the transcript.**
File: `packages/ui/src/features/chat/composer/Composer.tsx`.
Extend `handleInputKeyDown` (`:121-133`): on `Escape` with no trigger menu open and not in edit mode,
`preventDefault()` and focus the nearest `[data-mf-chat-thread]` viewport. The trigger popover and
`ComposerEditMode` already own Escape in their states and must keep it — check for the open trigger
menu before acting (AC 13). This stays composer-local handling; it is **not** a registry entry.
Verify: typecheck; the composer's existing test files stay green;
`handleInputKeyDown` stays under 50 lines (extract a helper if not).

### Group D — cheat sheet and hint de-drift (`cheat-sheet`)

**Task 17 — the dialog.**
Files: `packages/ui/src/features/shortcuts/ShortcutsCheatSheet.tsx`,
`packages/ui/src/app/AppShell.tsx` (mount it alongside the other app-wide outlets at `:117-131`).
Props: `entries?: readonly ShortcutDescriptor[]` (defaults to `visibleShortcuts(SHORTCUTS, { dev:
import.meta.env.DEV })`) — the fixture seam AC 15 needs — and **no per-shortcut props**. Renders one
section per group in Sessions/Chat/Workspace/App order, skipping empty groups; each row keyed by
`entry.id` (never index); each row shows `entry.label` and `renderEntryChord(entry, isMacPlatform())`
in a `kbd` chip. `data-testid`: `shortcuts-cheat-sheet` on the content, `shortcuts-cheat-sheet-group-
<group-lowercased>` on each section, `shortcuts-cheat-sheet-row-<entry.id>` on each row. Escape and
outside-click close come free from the `Dialog` primitive. Read the `mainframe-design-system` skill
and mirror `QuickTaskDialog` (D6) before writing class names.
Verify: typecheck; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run
src/__tests__/design-token-audit.test.ts`.

**Task 18 — palette command and hint de-drift.**
Files: `packages/ui/src/features/palette/palette-commands.ts`,
`packages/ui/src/layout/MainToolbar.tsx`, `packages/ui/src/features/sessions/SessionSidebar.tsx`,
`packages/ui/src/layout/WorkspaceAddMenu.tsx`.
- `palette-commands.ts`: replace the three hardcoded `hint` strings (`:13-15`) with
  `renderEntryChord(shortcutById('app.review' | 'app.settings' | 'sessions.toggle-sidebar'),
  isMacPlatform())` — this is what fixes the ⌘\ → ⌘B lie (AC 18). Add a `keyboard-shortcuts` command
  ("Keyboard Shortcuts") whose `run` opens the cheat sheet, with its own registry-derived hint.
- `MainToolbar.tsx:73/86`: derive the `⌘O` label and chip from `app.search-palette`.
- `SessionSidebar.tsx:52`: derive the `⌘,` hint from `app.settings`.
- `WorkspaceAddMenu.tsx:70`: delete the phantom `⌘P` `RowHint` (D5); drop `RowHint` from the import
  if it becomes unused in that file.
Verify: typecheck; `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/palette/__tests__`.

### Group E — behavioral tests and release hygiene (`integration-tests`)

These verify code Groups B–D produce, so they run after them.

**Task 19 — parity and guard-rail dispatcher tests.**
File: `packages/ui/src/features/shortcuts/__tests__/use-shortcut-dispatcher.test.tsx` (jsdom).
Mount a harness that installs the dispatcher plus spy handlers for every id, then dispatch synthetic
`KeyboardEvent`s on `window` and on specific targets (fact 6 guarantees `code` survives).
Cover AC 2 (each of ⌘N, ⌘O, ⌘⇧R, ⌘F, ⌘,, ⌘1, ⌘2, ⌘B, ⌘⇧T, ⌘⇧A-in-dev, ⌘\ fires its handler exactly
once and calls `preventDefault`), AC 3 (bare `n`/`f`/`o`/`l`/`1`/`2`/`b`/`\` from a focused textarea
fire nothing and do not `preventDefault`), AC 4 (⌘N/⌘O/⌘,/⌘B/⌘1/⌘2/⌘L fire from a focused textarea),
AC 5 (⌘F and ⌘/ from inside a `.cm-editor` fire nothing; ⌘N does), AC 6 (⌘F and ⌘/ from inside a
terminal container fire), AC 7 (⌘⇧N/⌘⇧O/⌘⇧F/⌘⇧, fire nothing), AC 8 (`code: 'Backslash'` with
`key: '|'` + Shift fires open-in-split; `code: 'KeyT'` with `key: 'T'` fires quick-task), and that an
id with no registered handler is inert and leaves the default intact.
Verify: file green.

**Task 20 — session-tab and split shortcut tests.**
File: `packages/ui/src/features/session-tabs/__tests__/SessionTabs.keyboard.test.tsx` (jsdom).
Against the existing session-tabs test harness: three tabs open → ⌃1 activates the first, ⌃3 the
third in displayed order, ⌃5 leaves the active tab unchanged (AC 10); ⌃Tab from the last activates
the first and ⌃⇧Tab from the first activates the last (AC 11); with A active plus B and C and no
split, ⌘⇧\ produces the same zones state as calling the context menu's `onOpenInSplit(B)`, and with
that split visible ⌘⇧\ matches the menu action on C; with one session open, with the only two
sessions already split, and with the active session an unsent draft, the zones state is unchanged
(AC 12).
Verify: file green.

**Task 21 — focus-composer and composer-Escape tests.**
File: `packages/ui/src/features/chat/composer/__tests__/focus-composer.test.tsx` (jsdom).
⌘L from the transcript moves focus to `[data-mf-composer-input]`; with a split rendered, ⌘L targets
the `[data-focused="true"]` zone's composer; Escape in a plain composer moves focus off the input and
onto `[data-mf-chat-thread]`; Escape with a trigger menu open closes the menu and leaves focus in the
composer (AC 13).
Verify: file green.

**Task 22 — cheat-sheet tests.**
File: `packages/ui/src/features/shortcuts/__tests__/ShortcutsCheatSheet.test.tsx` (jsdom).
⌘/ opens the dialog and a second ⌘/ closes it; Escape closes it; with another `Dialog` already
rendered, ⌘/ opens nothing (AC 14); rendering with a fixture set containing an entry the app does not
ship shows that entry with no per-shortcut props (AC 15); a `dev: true` fixture entry appears when
`dev: true` is passed and is absent when `dev: false` is (AC 16); every row carries a kebab-case
`data-testid` keyed by shortcut id (AC 19); grouped headings appear in Sessions/Chat/Workspace/App
order.
Verify: file green.

**Task 23 — changeset and full-suite gate.**
Files: `.changeset/<name>.md` (new).
Run `pnpm changeset` selecting `@qlan-ro/mainframe-ui` with a **minor** bump (new user-visible
bindings and a new dialog), describing the change in one plain sentence.
Verify: `pnpm --filter @qlan-ro/mainframe-ui typecheck` and `pnpm --filter @qlan-ro/mainframe-ui test`
both pass (AC 20); `grep -rn "addEventListener('keydown'" packages/ui/src` lists only
element-scoped handlers and the shortcuts dispatcher — no window/document app-shortcut listener
outside `features/shortcuts/` (AC 1).

## Risks

- **`KeyboardEvent.code` is layout-dependent in the other direction.** Matching the physical key means
  that on a non-QWERTY layout (AZERTY, Dvorak) ⌘N fires on the key *positioned* where QWERTY has N,
  which may print another letter. The spec chose physical-key matching deliberately (its
  `hard-to-reverse` decision) because shifted chords like ⌘⇧\ are otherwise unmatched; noted here so
  the tradeoff is not rediscovered as a bug.
- **`SessionTabs.tsx` is already 240 lines** and Task 15 adds registration code. If it passes 300,
  extract the action registrations into a `use-session-tab-shortcuts.ts` sibling rather than trimming
  comments.
- **The Windows/Linux chord variants ship unexercised** — the spec says so, and the release pipeline
  builds macOS only. The per-platform conflict test (Task 4) is the only coverage they get.
