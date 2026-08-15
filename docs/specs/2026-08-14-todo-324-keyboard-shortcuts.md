# Keyboard shortcuts (todo #324)

## Problem

Mainframe's keyboard shortcuts were added one at a time, each by the feature that needed it. Nothing
in the app knows the full set, so the app cannot show the user what is bound: there is no cheat
sheet, and the hints that do exist drift — the command palette advertises "Toggle Sidebar ⌘\" while
the sidebar is actually on ⌘B and ⌘\ closes a split. Two features can claim the same chord without
anything noticing, and the rules about when a shortcut should stand down (typing in a field, working
inside the code editor) are re-decided at each call site.

The gaps are as visible as the drift. Session tabs can only be switched with the mouse, a session can
only be opened in a split by ⌘-click, drag, or the context menu, and there is no way to jump focus
back to the composer. The result is a keyboard layer that power users cannot learn and cannot lean
on.

## Behavior

### One keyboard layer

Every app-level shortcut is declared once, in one place, with its chord, a human label, and the area
it belongs to. One listener matches keystrokes against that set and runs the matching action. Adding
a shortcut means adding a declaration; nothing else in the app listens for app-level chords.

Two exemptions stay: an overlay may still handle Escape for its own dismissal, and the code editor
keeps its own key bindings.

### The shortcuts

Chords render with macOS glyphs below. On Windows and Linux, ⌘ reads as Ctrl, ⌥ as Alt, and ⇧ as
Shift, except where a platform-specific chord is called out.

**Sessions**

| Chord | Action |
| --- | --- |
| ⌘N | New session |
| ⌃1 … ⌃9 (Alt+1 … Alt+9 off macOS) | Switch to the Nth open session tab |
| ⌃Tab / ⌃⇧Tab | Next / previous session tab |
| ⌘⇧\ | Open the next session tab beside the active one, in a split |
| ⌘\ | Close the visible split |
| ⌘B | Toggle the sessions sidebar |

**Chat**

| Chord | Action |
| --- | --- |
| ⌘F | Find in chat |
| ⌘L | Focus the composer |

**Workspace**

| Chord | Action |
| --- | --- |
| ⌘1 | Toggle the Chat surface |
| ⌘2 | Toggle the Workspace surface |

**App**

| Chord | Action |
| --- | --- |
| ⌘O | Open the search palette |
| ⌘⇧R | Open Review |
| ⌘, | Open Settings |
| ⌘⇧T | Quick-add task |
| ⌘/ | Keyboard shortcuts cheat sheet |
| ⌘⇧A | Automations host (dev builds only) |

Every chord in the first four groups already ships today except the new ones — tab switching, tab
cycling, open-in-split, focus-composer, and the cheat sheet. Existing chords keep their current key
and their current action.

### When a shortcut fires

- A chord matches the physical key that was pressed, not the character the keyboard produced. ⌘⇧\
  fires on the backslash key even though Shift renders it as `|`.
- A chord that does not include Shift does not fire while Shift is held. A chord that does not
  include ⌘/Ctrl does not fire while ⌘/Ctrl is held.
- A shortcut that fires prevents the webview's own handling of that keystroke.
- Shortcuts that carry a ⌘/Ctrl modifier fire while the user is typing in the composer or any other
  text field. This is what ships today and it stays.
- Two shortcuts declare **editor-yielding**: ⌘F and ⌘/. When the keystroke comes from inside the code
  editor they do not fire, so the editor keeps its own search and comment-toggle. Editor-yielding
  covers the code editor only. The terminal declares no competing bindings, so every shortcut fires
  from terminal focus exactly as it does today — ⌘F from the terminal still opens the chat Find bar.
- ⌃Tab and ⌃⇧Tab are not editor-yielding: nothing in the editor claims them, so tab cycling works from
  anywhere.
- ⌘L is editor-yielding and does nothing when no chat is on screen.
- A shortcut with no ⌘/Ctrl modifier does not fire while a text field, textarea, or contenteditable
  has focus. No shortcut ships in that shape today; the rule exists so the next one behaves. It
  governs declared shortcuts only — Escape stays element-scoped handling inside the component that
  owns it and is never declared as an app-level shortcut.
- Declaring the same chord twice is a conflict the project detects rather than resolving silently by
  order of declaration. Conflicts are checked per platform, so a pair that only collides on
  Windows/Linux is still caught.

### Session tabs and splits from the keyboard

⌃1 … ⌃9 select the 1st through 9th tab in the order the tabs are displayed and make that session
active — the same result as clicking the tab. ⌃Tab moves one tab to the right and ⌃⇧Tab one to the
left, wrapping at both ends.

⌘⇧\ puts a second session beside the active one. The active session anchors the split — the same role
it plays for the mouse gesture — and the partner is the nearest tab after it in displayed order for
which the tab context menu's "Open in Split" would be enabled, wrapping past the end of the strip. The
shortcut then fires that same action, so the resulting split is identical to right-clicking that tab
and choosing "Open in Split". When no tab qualifies, the shortcut is inert. ⌘\ keeps its shipped
behavior: it closes the visible split and leaves the other session in the full surface.

### Focusing the composer

⌘L moves keyboard focus into the composer's text input of the visible chat, leaving whatever the user
had typed intact. Escape from a plain composer returns focus to the transcript. Escape keeps its
existing meaning first: with a mention or trigger menu open it closes the menu, and in message-edit
mode it leaves edit mode.

That Escape is the composer's own handling, scoped to the composer, alongside the trigger-menu and
edit-mode handlers already there — the same shape as an overlay dismissing itself. It is not an
app-level shortcut and is not declared as one, which is why the rule against modifier-less shortcuts
in text fields does not reach it.

### The cheat sheet

⌘/ opens a dialog listing the shortcuts, grouped under Sessions, Chat, Workspace, and App, each row
showing the label and its chord as glyphs. The dialog is read-only: no editing, no search field. It
closes on Escape and on clicking outside, and reopening it from ⌘/ while it is open closes it.

The list is the declared set, rendered directly — a shortcut added to the app appears here without
anyone touching the dialog. Dev-only shortcuts (⌘⇧A) appear in dev builds and are absent in
production builds. The cheat sheet lists itself.

The search palette gains a "Keyboard Shortcuts" command that opens the same dialog.

### Hints stop drifting

Anywhere the app already displays a chord for a shortcut in the set — the search palette's command
hints, the toolbar's tooltips — it displays the chord the shortcut is actually bound to. The palette's
"Toggle Sidebar" command shows ⌘B, not ⌘\.

## Not Included

- `declined` — A user-editable keymap, persistence of edited bindings, and a Settings pane for
  keybindings. Nothing half-built is being left behind: the placeholder pane was removed deliberately.
- `declined` — Chord sequences (VS Code-style two-stroke bindings).
- `declined` — Re-mapping any shipped chord to a different key.
- `deferred` — Native macOS menu accelerators, and making the menu reflect the shortcut set.
- `deferred` — System-wide (Tauri global) shortcuts that fire while the app is unfocused.
- `deferred` — Changes to the code editor's CodeMirror keymap or the terminal's key handling.
- `deferred` — A visible affordance for the cheat sheet beyond ⌘/ and the palette command (no menu
  item, no toolbar button, no first-run coachmark).
- `platform` — Shortcut support in the mobile submodule.
- `platform` — The Windows/Linux chord variants ship declared but unexercised: the release pipeline
  builds macOS only, so their first real test comes when those builds return.

## Edge cases

- **Fewer tabs than the index.** ⌃5 with three tabs open does nothing — no tab change, no error.
- **One tab.** ⌃Tab and ⌃⇧Tab keep the single tab active.
- **Cycling past the ends.** ⌃Tab on the last tab moves to the first; ⌃⇧Tab on the first moves to the
  last.
- **No partner for the split.** ⌘⇧\ does nothing when no tab qualifies as the partner: one session
  open, two sessions already sharing the visible split, or every other tab an unsent draft.
- **Split already open with a third session.** ⌘⇧\ replaces the unfocused half of the visible split
  with the next qualifying tab, which is what the context-menu action does for that tab.
- **⌘\ with no split.** Inert, as today. Also inert when the split pair is parked rather than visible.
- **Typing a shortcut's letter.** Typing `n`, `f`, or `l` into the composer inserts the character.
- **Shift held.** ⌘⇧N does not open a new session; ⌘⇧O does not open the palette.
- **Keystroke inside the code editor.** ⌘F opens the editor's own search, not the chat Find bar. ⌘/
  toggles a comment. ⌘N still opens a new session, and ⌃Tab still cycles session tabs.
- **Keystroke inside the terminal.** ⌘F opens the chat Find bar and ⌘/ opens the cheat sheet, as they
  do from anywhere else. The terminal binds neither, so nothing is taken from it.
- **Cheat sheet over another dialog.** ⌘/ while Settings or any other modal dialog is open does
  nothing — the cheat sheet does not open and the open dialog keeps focus and Escape.
- **Escape in the composer with an open mention menu.** The menu closes and focus stays in the
  composer; a second Escape returns focus to the transcript.
- **Dev-only entry in production.** ⌘⇧A does nothing and is absent from the cheat sheet.
- **A future duplicate chord.** Two shortcuts declaring the same chord fail the project's checks
  instead of shipping with one of them dead.

## Acceptance criteria

1. All app-level chords listed in "The shortcuts" are declared in a single place, and no component or
   hook outside the shortcut layer registers a window- or document-level keydown listener for an
   app-level chord. Element-scoped Escape handling inside the component that owns it (overlays, the
   composer) and the code editor's own keymap are exempt.
2. A test asserts, for each of ⌘N, ⌘O, ⌘⇧R, ⌘F, ⌘,, ⌘1, ⌘2, ⌘B, ⌘⇧T, ⌘⇧A (dev), and ⌘\, that the
   chord fires the same action it fires today.
3. Dispatching `n`, `f`, `o`, `l`, `1`, `2`, `b`, or `\` with no ⌘/Ctrl modifier while focus is in the
   composer fires no shortcut and leaves the typed character in the composer.
4. With ⌘ held, each of ⌘N, ⌘O, ⌘,, ⌘B, ⌘1, ⌘2, and ⌘L fires while focus is in the composer.
5. A ⌘F keydown originating inside the code editor does not open the chat Find bar; a ⌘/ keydown
   originating inside the code editor does not open the cheat sheet; a ⌘N keydown from inside the code
   editor does open a new session.
6. A ⌘F keydown originating inside the terminal opens the chat Find bar, and a ⌘/ keydown from inside
   the terminal opens the cheat sheet.
7. Adding Shift to a chord that does not declare it (⌘⇧N, ⌘⇧O, ⌘⇧F, ⌘⇧,) fires nothing.
8. ⌘⇧\ fires the open-in-split action when the pressed key is backslash, regardless of the character
   Shift produces; ⌘⇧T fires quick-add task on the same basis.
9. A test over the declared set fails when two entries resolve to the same chord, evaluated once for
   the macOS resolution and once for the Windows/Linux resolution.
10. With three or more tabs open, ⌃1 activates the first tab and ⌃3 the third, in displayed order;
    ⌃5 with three tabs open leaves the active tab unchanged.
11. ⌃Tab from the last tab activates the first; ⌃⇧Tab from the first activates the last.
12. With tabs A (active), B, C in displayed order and no split, ⌘⇧\ produces the same split state as
    right-clicking B and choosing "Open in Split". With that A+B split visible, ⌘⇧\ produces the same
    state as the menu action on C. With one session open, with two sessions already sharing the
    visible split, or with the active session an unsent draft, ⌘⇧\ leaves the split state unchanged.
13. ⌘L from the transcript moves focus to the visible chat's composer input; Escape in a plain
    composer moves focus out of it; Escape with a mention menu open closes the menu and keeps focus in
    the composer.
14. ⌘/ opens the cheat-sheet dialog; Escape closes it; ⌘/ while another modal dialog is open opens
    nothing; the dialog lists every non-dev-only shortcut,
    grouped under Sessions, Chat, Workspace, and App, with its label and chord.
15. The cheat sheet rendered from a fixture set containing an entry the app does not ship shows that
    entry, with no per-shortcut props passed to the dialog.
16. A dev-only entry appears in the cheat sheet in a dev build and is absent from a production build.
17. Chords render as ⌘/⌥/⇧/⌃ glyphs when the platform reports macOS and as Ctrl/Alt/Shift/Ctrl text
    otherwise, asserted by a test over the chord-rendering function for both platforms.
18. The search palette lists a "Keyboard Shortcuts" command that opens the cheat sheet, and its
    "Toggle Sidebar" command displays ⌘B.
19. Every interactive element in the cheat sheet carries a kebab-case `data-testid`; shortcut rows are
    keyed by shortcut id, not array index.
20. `pnpm --filter @qlan-ro/mainframe-ui typecheck` and the UI test suite pass, and the PR includes a
    changeset.

## Decisions

- **Modifier chords keep firing while the user types; only modifier-less chords are suppressed in text
  fields.** `hard-to-reverse` — the brief proposed suppressing shortcuts in text inputs by default,
  but ⌘N, ⌘O, ⌘,, ⌘B, ⌘1, ⌘2, and ⌘⇧T all fire in the composer today, so the default would regress the
  brief's own "existing shortcuts keep working" criterion. The opt-in flag becomes an editor-yield
  flag instead.
- **Editor-yielding is the one eligibility opt-in, and it covers the code editor only — not the
  terminal.** `reversible` — the shipped ⌘F rule exempts CodeMirror targets and nothing else, so ⌘F
  from the terminal opens the chat Find bar today; the terminal registers no search or comment-toggle
  binding to protect, and suppressing shortcuts there would regress shipped behavior for no gain.
- **⌃Tab and ⌃⇧Tab are not editor-yielding.** `reversible` — the editor's keymap binds Tab for
  indentation but nothing on Ctrl+Tab, so yielding would disable tab cycling to protect a binding that
  does not exist.
- **Session tabs bind to ⌃1..⌃9 with ⌃Tab/⌃⇧Tab on macOS, and to Alt+1..Alt+9 off macOS.**
  `hard-to-reverse` — ⌘1/⌘2 keep the surfaces (shipped muscle memory), and literal Ctrl+1 collides
  with the surface toggles on platforms where the ⌘/Ctrl modifier resolves to Ctrl. A per-platform
  chord keeps both sides conflict-free.
- **Conflict detection runs per platform.** `reversible` — a single-resolution check would have missed
  the collision above.
- **Chords match the physical key, not the produced character.** `hard-to-reverse` — ⌘⇧\ arrives as
  `|` and ⌘⇧T as `T`; matching on the character makes shifted chords layout-dependent.
- **⌘/ opens the cheat sheet, and it yields to the editor.** `reversible` — ⌘/ is the convention users
  arrive with, and CodeMirror's default keymap binds it to comment-toggle inside the editor.
- **⌘⇧\ opens in a split; ⌘\ keeps closing one.** `reversible` — pairs with the shipped close chord and
  routes through the same action the context menu already calls.
- **⌘⇧\ splits the active session against the next qualifying tab in displayed order, wrapping.**
  `hard-to-reverse` — the brief said "open the active session in a split" without naming the partner,
  and the shipped gesture always pairs the active session with a *different* one; applied to the active
  session alone it can never fire. Displayed order is what the strip already exposes and what ⌃Tab
  already cycles, so the two tab gestures agree; a most-recently-used partner would need history the
  app does not keep.
- **⌘L focuses the composer, and Escape out of the composer is composer-local handling rather than a
  declared shortcut.** `reversible` — the composer already owns Escape for its trigger menu and edit
  mode, so the return-to-transcript path joins handling that is there; declaring it would make it the
  one modifier-less app shortcut, which the text-field rule forbids.
- **One lane: registry, new bindings, and cheat sheet ship together.** `reversible` — the cheat sheet
  is the only user-visible proof the registry exists; splitting ships an invisible refactor.
- **No user-customizable keymap.** `reversible` — the customization surface was removed deliberately,
  so nothing is half-finished; the registry is a prerequisite for it if it ever returns.
- **The registry does not drive the native macOS menu.** `reversible` — the menu is predefined items
  with their own enable/disable semantics; wiring it is a separate surface.
- **The Automations chord stays dev-only and is marked as such.** `reversible` — matches today's gating
  and keeps the production cheat sheet honest.
- **Palette and tooltip chord hints read from the registry.** `reversible` — the palette currently
  advertises ⌘\ for the sidebar, which is wrong and is exactly the drift the single source of truth
  exists to prevent. A "Keyboard Shortcuts" palette command rides along as one more registry-driven
  row.
- **No daemon work.** `reversible` — the feature is renderer-only, so the Zod/`ok`-`fail` envelope,
  new-route tests, and Rust-daemon-parity constraints do not apply; the required tests are UI tests
  plus pure-function tests over the registry.
