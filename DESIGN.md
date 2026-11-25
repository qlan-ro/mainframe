---
name: Mainframe
description: A calm, native workbench for running several coding agents at once. The system of the window revamp, approved 24 Nov 2026. Failure rose, the focus line, overlay scrollbars, the accent's text and fill pair (accent-ink, accent-fill), the composer and the gates are built in packages/ui; the rest is the target the revamp builds towards.
colors:
  ground: "#f5f5f8"
  side: "#ffffff"
  sheet: "#ffffff"
  card: "#ffffff"
  chip: "#ececef"
  q: "#f5f5f7"
  bubble: "#f1f1f3"
  hair: "#e5e5e5"
  hair2: "#cfcfd4"
  sel: "#ececef"
  hover: "#ededf0"
  press: "#e2e2e6"
  ink: "#1f1f1f"
  ink2: "#48484a"
  meta: "#5c5c61"
  faint: "#a1a1a6"
  accent: "#0a84ff"
  accent-ink: "#0063cc"
  accent-fill: "#0063cc"
  focus: "#0b6fdc"
  live: "#0b6fdc"
  sel-bg: "rgba(10,132,255,.26)"
  warn: "#8a4b00"
  warn-bg: "rgba(217,119,6,.13)"
  warn-bd: "rgba(138,75,0,.35)"
  warn-dot: "#b45f06"
  crit: "#c70016"
  crit-bg: "rgba(199,0,22,.07)"
  crit-bd: "rgba(199,0,22,.28)"
  ok: "#1d7a46"
  fail: "#b04466"
  red: "#c0392b"
  code: "rgba(0,0,0,.06)"
  tipbg: "#1f1f1f"
  tipink: "#ffffff"
  claude: "#d97757"
  codex: "#19c37d"
  ground-dark: "#262626"
  side-dark: "#171717"
  sheet-dark: "#171717"
  card-dark: "#262626"
  chip-dark: "#363636"
  q-dark: "#2d2d30"
  bubble-dark: "#262626"
  hair-dark: "#333336"
  hair2-dark: "#454549"
  sel-dark: "#2f2f31"
  hover-dark: "#262628"
  press-dark: "#303033"
  ink-dark: "#ececec"
  ink2-dark: "#c7c7cc"
  meta-dark: "#aeaeb4"
  faint-dark: "#5f5f64"
  accent-ink-dark: "#5aaeff"
  accent-fill-dark: "#0a6fd6"
  focus-dark: "#3d9bff"
  live-dark: "#0a84ff"
  sel-bg-dark: "rgba(10,132,255,.42)"
  warn-dark: "#f0b35a"
  warn-bg-dark: "rgba(240,179,90,.12)"
  warn-bd-dark: "rgba(240,179,90,.38)"
  warn-dot-dark: "#e08a1e"
  crit-dark: "#ff8080"
  crit-bg-dark: "rgba(255,107,107,.1)"
  crit-bd-dark: "rgba(255,107,107,.36)"
  ok-dark: "#4cc38a"
  fail-dark: "#e48aa3"
  red-dark: "#ff7b6e"
  code-dark: "rgba(255,255,255,.09)"
  tipbg-dark: "#ececec"
  tipink-dark: "#1f1f1f"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.45
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  transcript:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
  input:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "20px"
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: "16px"
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.3
  mono:
    fontFamily: "ui-monospace, \"SF Mono\", Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "19px"
rounded:
  xs: "4px"
  code: "5px"
  sm: "6px"
  row: "7px"
  md: "8px"
  tab: "9px"
  menu: "10px"
  lg: "12px"
  panel: "14px"
  card: "16px"
  full: "50%"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "14px"
  3xl: "16px"
  4xl: "24px"
components:
  composer-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "10px 10px 8px"
  composer-field:
    textColor: "{colors.ink}"
    typography: "{typography.input}"
  toolbar-button:
    textColor: "{colors.ink2}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 8px"
  toolbar-button-hover:
    backgroundColor: "{colors.hover}"
  toolbar-button-open:
    backgroundColor: "{colors.press}"
  permissions-chip-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "28px"
  send-idle:
    textColor: "{colors.faint}"
    rounded: "{rounded.full}"
    size: "28px"
  send-ready:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.tipink}"
    rounded: "{rounded.full}"
    size: "28px"
  stop:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.full}"
    size: "28px"
  queue-split:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.tipink}"
    typography: "{typography.control}"
    rounded: "{rounded.panel}"
    height: "28px"
  context-ring:
    textColor: "{colors.meta}"
    typography: "{typography.label}"
    size: "16px"
  icon-button:
    textColor: "{colors.meta}"
    rounded: "{rounded.sm}"
    size: "24px"
  icon-button-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.ink}"
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.tipink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  button-outline-hover:
    backgroundColor: "{colors.hover}"
  button-danger:
    textColor: "{colors.red}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  button-warn:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 12px"
  session-tab:
    textColor: "{colors.ink2}"
    typography: "{typography.small}"
    rounded: "{rounded.tab}"
    height: "32px"
    padding: "0 4px 0 12px"
  session-tab-selected:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
  usage-capsule:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.ink2}"
    rounded: "{rounded.menu}"
    height: "28px"
    width: "224px"
    padding: "0 12px"
  sidebar-row:
    textColor: "{colors.ink2}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 8px 0 6px"
  sidebar-row-selected:
    backgroundColor: "{colors.sel}"
    textColor: "{colors.ink}"
  sidebar-search:
    backgroundColor: "{colors.chip}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "30px"
    padding: "0 10px"
  group-header:
    textColor: "{colors.meta}"
    typography: "{typography.label}"
    height: "24px"
  activity-row:
    textColor: "{colors.ink2}"
    typography: "{typography.small}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "0 2px 0 8px"
  queued-row:
    backgroundColor: "{colors.q}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "2px 2px 2px 10px"
  queued-row-failed:
    textColor: "{colors.fail}"
  attachment-chip:
    backgroundColor: "{colors.q}"
    rounded: "{rounded.tab}"
    height: "40px"
    padding: "0 2px 0 8px"
  user-bubble:
    backgroundColor: "{colors.bubble}"
    textColor: "{colors.ink}"
    typography: "{typography.transcript}"
    rounded: "{rounded.panel}"
    padding: "8px 14px"
  work-row:
    textColor: "{colors.ink2}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    height: "28px"
    padding: "0 4px"
  code-block:
    backgroundColor: "{colors.code}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  session-panel:
    backgroundColor: "{colors.sheet}"
    rounded: "{rounded.panel}"
    width: "300px"
  panel-row:
    textColor: "{colors.ink2}"
    typography: "{typography.body}"
    rounded: "{rounded.row}"
    height: "28px"
    padding: "0 10px"
  panel-tile:
    backgroundColor: "{colors.q}"
    textColor: "{colors.ink2}"
    rounded: "{rounded.lg}"
    size: "48px"
  gate-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
  gate-option:
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  gate-option-selected:
    backgroundColor: "{colors.q}"
  menu:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.menu}"
    padding: "4px"
  menu-item:
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  menu-item-hover:
    backgroundColor: "{colors.hover}"
  confirm-dialog:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    width: "300px"
    padding: "14px 14px 12px"
  tooltip:
    backgroundColor: "{colors.tipbg}"
    textColor: "{colors.tipink}"
    typography: "{typography.meta}"
    rounded: "{rounded.row}"
    padding: "5px 9px"
  toast:
    backgroundColor: "{colors.tipbg}"
    textColor: "{colors.tipink}"
    typography: "{typography.small}"
    rounded: "{rounded.tab}"
    padding: "7px 14px"
  shortcuts-sheet:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    width: "448px"
  kbd:
    backgroundColor: "{colors.q}"
    textColor: "{colors.ink2}"
    typography: "{typography.mono}"
    rounded: "{rounded.xs}"
    padding: "1px 5px"
---

# Design System: Mainframe

## Overview

**Creative North Star: "The Calm Workbench"**

Mainframe is a native Mac work surface for someone running four to six coding agents at once. The workbench steps back so the work leads: grey ground, white sheets, hairlines a single pixel thin, and a system font in a few weights. Nothing in the chrome asks for attention unless an agent needs the user, something is running, or an action is ready. When several sessions are busy, the window should still read as quiet, scannable status.

The layout is the category standard that users of the Claude desktop app, Codex and Antigravity already know: a title bar with tabs, a session list on the left, a centred reading column with the composer under it, and optional panels on the right. Distinction comes from craft, not from a themed look. Columns line up from the title bar down, one 28 px row pitch runs through every list, each shortcut has a visible control, and narrowing the window never drops a control. Bold themed directions were explored and rejected; consumer-chat softness was rejected too.

Density is moderate and keyboard-first. Body text is 13 px, the transcript 14 px, and controls are 24–32 px. Colour is a signal, never decoration: blue for action, focus and live work, amber and red only when a state earns them, and provider brand colours only as small dots. Light and dark are equal citizens: every colour token has a `-dark` twin, and the dark theme compensates contrast instead of simply inverting.

This file is the approved target for the window revamp (sidebar, title bar, transcript, composer, session panel, workspace). The decision log is `design/redesign/DECISIONS.md`, and the rendered states are the `Proposal-Redesign-*` boards in `design/canvas/project/`. A row of the log that says "Implemented" is in `packages/ui`; everything else here is still to be built. The `Foundations-Tokens` board is generated from this file's frontmatter. Settings, automations, tasks and mobile adopt the system later.

**Key Characteristics:**
- Grey ground, white sheets and cards, one-pixel hairlines; depth by tone first, shadow second.
- The system font stack only, in three weights (400, 500, 600) and sizes from 11.5 to 15 px.
- One 28 px row pitch in the sidebar, session panel, activity strip, menus and toolbar.
- Blue only where something can act or is acting; amber and red only for earned states.
- Columns aligned from the title bar down; nothing disappears at narrow widths.
- Status outranks settings: what the agent is doing is always the loudest thing on screen.

## Colors

A cool, near-neutral grey scale carries almost everything; a single system blue and two state hues (amber and red) carry meaning.

### Primary
- **System Blue** (`accent`): the ready Send button, the caret, range accents and the gate-card outline tint. It is the "go" colour and appears only on things that can act.
- **Blue Ink** (`accent-ink`): blue as readable text and icons, such as the active Filter button, the Plan status ("Planning · then Auto-Edits"), gate tiles, "Recommended" tags, the pressed segmented control, and keywords in code views. Use it whenever blue must pass 4.5:1 as text.
- **Deep Blue Fill** (`accent-fill`): solid filled buttons with white text (gate primary, confirm primary, the Queue split button, the selected radio). It is darker than System Blue so white text passes.
- **Focus Blue** (`focus`): the 2 px focus line on every focusable element, the composer card's focused outline and the resize grip highlight. Its job is focus only.
- **Live Blue** (`live`): running spinners and dots (session tab dot, sidebar spinner, activity strip, panel rows). It means "an agent is working right now".
- **Selection** (`sel-bg`): text selection.

### Secondary
- **Burnt Amber** (`warn`, `warn-bg`, `warn-bd`, `warn-dot`): needs you, and risky permissions. It covers the needs-you ring and label, the Auto and Unattended permission chip, the ⚡ Unattended marker, the context ring at 80–94 %, warning gate tiles, and the "Run unattended" confirm button. `warn-dot` is the brighter amber for small marks and the warning gate's outline.

### Tertiary
- **Muted Rose** (`fail`): failed work, at regular weight. It covers the "N failed" counts on work rows and under Earlier, failed tool and activity rows and their ✕ glyphs, a failed queued message ("Not sent: the session stopped."), and the Error label in results. It is quieter than red on purpose: a failure is information to read later, not an alarm.
- **Signal Red** (`crit`, `crit-bg`, `crit-bd`): criticality only: the context ring at 95 % or more and the panel's running Stop square.
- **Diff Red** (`red`) and **Diff Green** (`ok`): deletions and additions in change counts and diffs, Reject and danger actions (`red`), and completion ticks (`ok`).

### Neutral
- **Ground** (`ground`): the window floor behind the title bar and rail, and the workspace preview canvas.
- **Sheet** (`sheet`, `side`): the white main pane, sidebar and session panel. In dark mode the sidebar and sheet are the darkest surfaces (`#171717`) and cards rise above them.
- **Card** (`card`): the composer card, gate cards, menus, dialogs and the shortcuts sheet.
- **Chip** (`chip`): search fields, the URL bar, the usage capsule and segmented-control wells.
- **Well** (`q`) and **Bubble** (`bubble`): queued-message rows, attachment chips, panel tiles, selected gate options and keycaps (`q`), and the user's message bubble (`bubble`).
- **Hairlines** (`hair`, `hair2`): `hair` for every divider and resting outline, and `hair2` for stronger outlines (outline buttons, the idle Send ring, title bar separators, radio rings).
- **Selection and interaction fills** (`sel`, `hover`, `press`): the selected sidebar row and current menu item (`sel`), hover (`hover`), and open or pressed states (`press`).
- **Ink scale** (`ink`, `ink2`, `meta`, `faint`): primary text (`ink`), body and control text (`ink2`), and labels, times, values and icons (`meta`, the lowest colour allowed for text). `faint` is only for the disabled Send arrow and inactive tab dots, never for text.
- **Tooltip** (`tipbg`, `tipink`): the tooltip and toast surfaces, inverted per theme.
- **Code tint** (`code`): inline code, code blocks, keyboard hints in menus and the gate's JSON details. Text a gate asks the user to approve uses `stored-order`: left to right, in the order it is stored, whatever its script.
- **Provider dots** (`claude`, `codex`): 8 px dots beside a model or provider name.

### Named Rules
**The One Accent Rule.** Blue appears only where something can act or is acting: focus, a ready Send, the caret, live work, the plan status. It is never a background wash, a resting border or decoration.

**The State-Earned Colour Rule.** Amber, rose and red appear only when a state earns them: amber for needs you, Auto and Unattended permissions and context at 80 %; rose for failed work; red for context at 95 %. A screen where every session is idle is entirely neutral apart from provider dots.

**The Provider Dot Rule.** Provider brand colours appear only as small dots beside a name. They never tint text, fills or borders.

### Tokens in code
Built so far in the base theme of `packages/ui`, each with a light and a dark value and a Tailwind mapping:

| Here | CSS variable | Utilities |
| --- | --- | --- |
| `fail` | `--fail` | `text-fail`, `bg-fail`, `border-fail` |
| `focus` | `--focus` (`--ring` and `--sidebar-ring` alias it) | `focus-line`, `focus-line-inset`, `*-focus` |
| `live` | `--live` | `text-live` on the session row spinner |
| `accent-ink` | `--accent-ink` | `text-accent-ink` on the active sidebar filter |
| `tipbg`, `tipink` | `--tooltip`, `--tooltip-foreground` | `bg-tooltip`, `text-tooltip-foreground` on shared tooltips |
| Meta (12 px) | `--text-meta` | `text-meta` on group labels and shared tooltips |
| Tooltip shadow | `--shadow-tooltip` | `shadow-tooltip` |

`crit` and `red` are not built. The app has one red, `--destructive` (`#e7000b` light, `#ff6467` dark, against `#c70016` and `#ff8080` for `crit`, `#c0392b` and `#ff7b6e` for `red`), and it does the work of both: irreversible actions, Reject, Stop, context and plan usage at 90 % and above, the Unattended permission, error output in tool bodies and the run console, and diff deletions (`--mf-diff-del-text` aliases it). The xterm terminal's red is its own ANSI palette. The split into two reds and the 95 % threshold come with the PRs that build those areas.

Text in `fail` may sit on a `fail` tint of 6 % at most (`bg-fail/6`), at full strength; a stronger tint is for icons and `foreground` text. `contrast.test.ts` measures it (4.60:1 at worst in light, 4.96:1 in dark) and refuses a stronger one.

The shell uses the palette above for ground, sheet, card, chip, hairlines, hover, press, selection, foreground, metadata, warning and success. The neutral row selection is separate from the legacy blue tint used for drag targets and engaged controls.

## Typography

**Display Font:** none. The largest size is 15 px.
**Body Font:** the system UI stack, `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`.
**Label/Mono Font:** `ui-monospace, "SF Mono", Menlo, monospace`.

**Character:** SF Pro at small sizes, set in three weights, with hierarchy from weight and tone rather than size jumps. It reads as the Mac itself, which is the point.

### Hierarchy
- **Headline** (600, 15 px, 1.45): the sidebar header ("Chats") and workspace preview headings. One per region at most.
- **Title** (600, 14 px, 20 px): the session title in the header, gate titles (the question itself, "Ready to implement"), dialog and sheet titles.
- **Transcript** (400, 14 px, 22 px): agent prose and user bubbles, in a reading column of 740 px by default (about 85–90 characters).
- **Input** (400, 14 px, 21 px): the composer field, growing line by line.
- **Body** (400, 13 px, 1.45): the default UI size, used for sidebar rows, panel rows, menus, tool rows, toolbar controls and dialog copy.
- **Control** (500, 13 px, 20 px): labels that are the thing you act on, such as the permissions label, menu item names and gate buttons (13.5 px in gates).
- **Small** (400, 12.5 px): session and workspace tabs, the activity strip, the bottom strip, attachment names and the file tree.
- **Label** (500, 12 px, `meta`): group headers (Today, Yesterday), panel section labels, gate eyebrows and shortcut-sheet groups, all in sentence case and never uppercase.
- **Meta** (400, 12 px, `meta`): times, counts, values, tooltips, menu descriptions and table headers.
- **Caption** (600, 11.5 px): menu group labels and the queued-row index.
- **Mono** (400, 12 px, 19 px): code blocks, terminal, diffs, tool names and commands (13 px semibold for the tool name in gates), branches, paths and keycaps. Inline code sits at 0.92 em with a 5 px tint.

### Named Rules
**The Native Stack Rule.** Use the system font stack and the system monospace only. No webfonts, no display sizes above 15 px, and weights only 400, 500 and 600.

**The Mono Means Machine Rule.** Monospace marks strings the machine owns: code, commands, branches, paths, file names and rule patterns. UI labels such as "Worktree" or "from main" stay in the UI face.

**The Steady Number Rule.** Numbers that change in place (context percent, elapsed time, change counts, sub-agent counts, usage) use tabular figures, so nothing shifts as they update.

## Layout

The window is a set of fixed columns that line up from the title bar to the composer.

- **Title bar** (48 px): traffic lights and the usage capsule (224 × 28) on the left, then session tabs, then (when open) workspace tabs, and search plus the Chat / Workspace switch on the far right. Small separators (1 × 16 px, `hair2`) split it into segments that sit exactly above the column edges below: one above the sidebar's right edge and one above the workspace panel's left edge. That gives two segments, or three with the workspace open.
- **Rail and sidebar**: an icon rail (56 px, its own column with a hairline) and a session list (260 px), 316 px in total. The sidebar collapses with ⌘B. The pane beside the rail clips its contents at a 10 px top-left corner. Its 1 px top and left border follows the curve, with the ground visible outside it.
- **Main pane**: a 44 px session header (title left, side-chat and panel toggles right). The transcript scrolls across the whole pane, so its scrollbar sits at the pane edge. The reading column and the composer share one centred width (`--cw`, default 740 px) with at least 24 px gutters. The composer sits 16 px above the window bottom.
- **Session panel**: 300 px, inset 8 px from the sheet edges, as tall as its content up to the window height. It docks only when the chat column is at least 1044 px wide (720 transcript + 24 gap + 300 panel). Otherwise its toggle floats it over the chat, starting under the header and ending 8 px above the composer.
- **Workspace panel**: slides in from the right and pushes the chat narrower. Its default width is 50 % of the area right of the sidebar, never under 320 px, and the chat column keeps at least 360 px. The left edge is a resize grip, and the docked file tree is 224 px.
- **Composer width behaviour** (container queries on the composer's own width): below 560 px the model label caps at 150 px. Below 400 px model and permissions merge into one chip, labels shorten and the card padding tightens to 8 px. Below 320 px the merged chip shows only the permission status, and the ring, Stop and split wrap onto a second toolbar row.
- **Rhythm**: rows are 28 px everywhere: sidebar rows, panel rows, activity rows, work rows and toolbar controls. Group headers are 24 px with 14 px above (4 px for the first), and panel section labels are 22 px with 12 px above, both bottom-aligned close to their rows. Panel sections end with 10 px, and their dividers are inset 16 px to line up with the text. Transcript turns are 16 px apart.
- **Overflow**: the activity strip caps at 6 rows and the gate slot at 45 % of the height, both scrolling inside. Menus cap at the viewport height minus 16 px. Overflowing tab rows scroll with a 28 px fade at the right edge.

### Named Rules
**The Aligned Seams Rule.** Every vertical edge in the title bar continues an edge below it. A separator that doesn't sit above a column edge is a bug.

**The 28 Pitch Rule.** Lists and toolbars use one 28 px row pitch. A new list row that is 30 or 32 px tall needs a reason (tabs and queued messages are 32 px because they hold a close or edit control).

**The Nothing Disappears Rule.** Narrowing merges, shortens or iconifies a control, and never removes one. Every shortened control keeps its full meaning in its tooltip and accessible name, and the context ring and permission status stay visible at every width.

## Elevation & Depth

Depth is tonal first. The ground is grey, sheets are white, and cards sit on sheets with a hairline. Shadows mark only two things: the composer card, which lifts slightly off the sheet, and surfaces that float above the layout (menus, dialogs, the floating panel, the shortcuts sheet, tooltips, toasts). In dark mode the same shadows are deeper and the surface steps are reversed: sheet and sidebar are the darkest, cards are lighter.

### Shadow Vocabulary
- **Card lift** (`box-shadow: inset 0 0 0 1px <hair>, 0 1px 2px rgba(0,0,0,.04), 0 3px 10px rgba(0,0,0,.05)`): the composer card and its top strip. Dark: `0 1px 2px rgba(0,0,0,.3), 0 3px 10px rgba(0,0,0,.25)`.
- **Float** (`box-shadow: 0 0 0 1px <hair>, 0 2px 4px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.16)`): menus, confirm dialogs, the shortcuts sheet and the floating session panel. Dark: `0 2px 4px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.5)`.
- **Selected tab** (`box-shadow: inset 0 0 0 1px <hair>, 0 1px 2px rgba(0,0,0,.05)`): the selected session or workspace tab, a white sheet raised one step from the title bar.
- **Tooltip** (`box-shadow: 0 4px 14px rgba(0,0,0,.2)`) and **Toast** (`box-shadow: 0 6px 20px rgba(0,0,0,.2)`).
- **Focused composer** (`outline: 2px solid <focus>` on the card's own edge, card lift unchanged): replaces the hairline while the card has focus. No translucent halo.
- **Gate halo** (`border: 1px solid <accent 40%>; box-shadow: 0 0 0 3px <accent 15%>`): a pending gate, in amber (`warn-dot`) for permission gates.
- **Scrims**: the floating panel's scrim is the sheet at 40 %, and the shortcuts sheet's is `rgba(0,0,0,.32)`.

### Named Rules
**The Two-Lift Rule.** The composer card lifts slightly and floating surfaces lift clearly. Nothing else casts a shadow, and no resting border is thicker than 1 px.

**The Halo Means Waiting Rule.** A translucent ring around a card means it is waiting for the user: a pending gate. The focused composer has a solid line, not a ring. Never use it for emphasis.

## Shapes

Radii are soft but not round, and they nest: the outer container is always rounder than what it holds. The composer card is 16 px. The session panel and user bubbles are 14 px. Gate cards, dialogs, the top strip's upper corners, panel tiles and the framed window are 12 px. Menus, the usage capsule and segmented wells are 10 px. Tabs, attachment chips and toasts are 9 px. Controls, rows, fields and code blocks are 8 px. Panel and work rows are 7 px. Icon buttons and menu items are 6 px. Inline code is 5 px and keycaps are 4 px. Send, Stop and the attach `+` are full circles, and the Queue split is a 28 px pill.

The composer's top strip is the one silhouette worth naming. It is a drawer with the card's surface and outline, inset 12 px each side, rounded on top only, with its bottom tucked 17 px under the card so the seam disappears. Strips are never a frame around the composer.

Icons are a 16 px outline set (12 px small, 20 px in the rail) with a 1.5 px stroke and round caps and joins, drawn in `meta` and turning `ink` on hover.

## Components

Native and restrained throughout. Controls are quiet text until hovered, fills come from the neutral interaction scale, and colour appears only when a state earns it.

### Buttons
- **Shape:** gently rounded (8 px). Toolbar and strip buttons are 28 px tall, gate and dialog buttons 32 px, and icon buttons are 24 px squares (6 px radius).
- **Toolbar / ghost:** no fill at rest, `ink2` text, a `meta` chevron. Hover fills `hover`, and open menus hold `press`.
- **Primary:** Deep Blue Fill with white 500-weight text. Hover brightens it by 8 %. Used for "Allow once", "Approve & run" and confirm primaries.
- **Outline:** card fill with a `hair2` outline and `ink` text, hover `hover`. Used for "Always allow `rule`" and "Cancel".
- **Danger:** `red` text on an 11 % red tint (19 % on hover). Used for "Reject".
- **Warn:** `warn` text on `warn-bg` with a `warn-bd` outline. Used only for "Run unattended".
- **Disabled:** 50 % opacity and no hover. In the toolbar, `aria-disabled` keeps the label at full contrast with a tooltip explaining why.

### Send, Stop and Queue (signature)
The bottom-right slot of the composer always holds the action that matters now. Each is a 28 px circle:
- **Idle** has a `hair2` outline and a `faint` arrow, and is disabled.
- **Ready** is a System Blue fill with a white arrow.
- **Stop** is an `ink` fill with a `card`-coloured square, shown while the turn or any sub-agent runs.
- **Stopping** is a spinner in `meta`.

While the agent runs with text typed, a Deep Blue pill split button appears, "Queue ↵" plus a chevron for "Send now (interrupts)". The Stop square stays to its left. Stop never confirms, and its tooltip names what it stops ("Stop the turn and 3 sub-agents ⌘.").

### Context ring
A 16 px gauge beside Send, with the percentage in 12 px tabular 500 weight. It always shows a full track (ink at 26 %) so it never reads as a spinner. The arc and number are `meta` below 80 %, `warn` from 80 to 94 % and `crit` at 95 % and above.

### Composer card
- **Corner Style:** 16 px.
- **Background:** `card`, with the card lift and a hairline outline. The outline becomes a solid 2 px Focus Blue line, with no halo, while the card has focus.
- **Internal Padding:** 10 px 10 px 8 px; the field has 2 px 4 px 8 px inside that.
- **Contents, top to bottom:** queued rows (32 px wells, edit and remove, failed rows in `fail`, tinted with it at 7 %), attachment chips (40 px), the field, then the toolbar: `+`, model with a dimmed effort suffix and provider dot, permissions label (always visible, amber chip for Auto and Unattended), spacer, context ring, Send/Stop.
- **Strips:** a top drawer (project and branch pickers before the first message, the activity strip after it), and a bare bottom row below the card (where it runs on the left, `+22 −1` changes pushed right). There is no bottom row before the first message.

### Chips
- **Permissions chip:** neutral text at Interactive and Auto-Edits; at Auto and Unattended, `warn` text on `warn-bg` with a `warn-bd` outline. Plan status uses Blue Ink ("Planning · then Auto-Edits").
- **Usage capsule:** a `chip` fill, 10 px radius, 12 px text with a 32 × 4 px meter and tabular figures.
- **Badges:** gate counters ("1 of 3") are 11.5 px mono in a 6 px outlined box.

### Cards / Containers
- **Gate card:** 12 px radius, `card` fill, an accent outline at 40 % with a 3 px halo at 15 % (amber for permission gates), and a 24 px tinted icon tile. Content aligns to a 50 px text column. Pinned above the composer, one gate at a time.
- **Session panel:** 14 px radius, `sheet` fill (in dark, card at 55 % over the sheet), a real 1 px `hair` border, and a sticky 44 px header ("Session" plus a "Sections" button). Sections are separated by inset hairlines.
- **Confirm dialog:** a 300 px card with 12 px radius and the float shadow, title at 14 px 600, body in `ink2`, buttons right-aligned.
- **Shortcuts sheet:** 448 px, centred over a scrim, grouped Sessions / Chat / Workspace / App, with 4 px keycaps in mono on `q`.

### Inputs / Fields
- **Style:** borderless `chip` fields, 30 px tall with 8 px radius and 13 px text (sidebar search, menu search, URL bar). Gate text fields and "Other…" use a `hair2` outline on `card`.
- **Focus:** a solid 2 px Focus Blue line. Controls (`focus-line`) wear it 2 px off their edge. Fields, full-width rows, tabs and anything a scroll area would clip (`focus-line-inset`) wear it on their own edge, as the composer card does. Menu search lines its container instead.
- **Invalid:** the border turns `fail`, and the message under the field is `fail`.
- **Caret:** System Blue. Placeholders use `meta` at full opacity.

### Navigation
- **Session tabs:** 32 px, 9 px radius, 12.5 px text, 180 px default width shrinking to 96 px. An 8 px status dot leads (`faint` idle, Live Blue running, amber ring for needs you). The selected tab is a raised white sheet with the selected-tab shadow. Close is a 24 px icon button.
- **Workspace tabs:** the same shape with a 12 px type glyph instead of the dot. Unselected tabs truncate down to 84 px, and their close button overlays the title's end on hover.
- **Sidebar rows:** 28 px, 8 px radius. A 16 px project letter tile leads (neutral, ink at 8 %; "–" for no project). The title fades when it overflows, and turns semibold while a response is unread. The right slot shows one value: the time, or a status in its place, which is a Live Blue spinner (no count) or "needs you" in amber 500 weight. "Needs you" outranks running. Selected rows take `sel` and `ink`; hover is the same fill at 60 %, and adds Pin, Tags and Archive before the right slot. A row under 216 px drops Tags and lets the actions take the right slot, so the title keeps its room. Everything else about the session is in its hover card, whose links are underlined body ink, 24 px tall; Tab from the row reaches them.
- **Sidebar group headers:** 24 px, 12 px 500 `meta`, bottom-aligned, with 14 px above (4 px for the first). Each sticks below the first, which stays parked and carries Filter, Sort and More as 24 px buttons that appear on hover or keyboard focus, or while their menu is open. An active filter keeps Filter visible, in blue; its tooltip and name say what is filtered.
- **Rail:** 38 px buttons with 10 px radius and 20 px icons. Pressed takes `chip`.

### Menus
A `card` surface with 10 px radius, the float shadow and 4 px padding. Items have 7 × 10 px padding with 6 px radius, a 16 px leading icon in `meta`, a 13 px 500 label, an optional 12 px `meta` description, and a trailing check, keycap or action word. Hover and keyboard focus fill `hover`. Group labels are 11.5 px 600 `meta`, and separators are 1 px `hair` inset 6 px. Menus open with a 4 px rise over 0.14 s.

### Activity strip rows
28 px rows inside the top drawer, 12.5 px. Needs-you rows come first, with an amber icon and value and an "Open" action in Blue Ink. Running rows follow, with a Live Blue spinner, tabular elapsed time and an immediate "Stop" (a toast confirms it afterwards). A chevron on the first row collapses the strip to one row plus "+N".

### Transcript
- **User bubbles:** right-aligned and neutral (`bubble`), 14 px radius, at most 85 % wide.
- **Agent prose:** sits on the sheet with no container.
- **Folded turns:** one 28 px row per turn ("✓ Worked for 2m 14s · edited 3 files…") that expands to 26 px tool rows with mono targets. The row carries the turn's agents and "N failed" (Muted Rose; grey once retried). This replaces the tool cards and their primitives.
- **Markers:** events (skills, plans, schedules, monitors, worktrees, notifications) are 26 px pills centred on the spine, outside the fold. One with content opens a 12 px card under it, at most 600 px wide.
- **Links:** one style, Blue Ink with an underline; a raw URL or a file path is in mono, with no glyph.
- **Changed lines:** ink on the tint; colour only in the +/− column. The terminal follows the theme.
- **Dividers:** hairlines with a centred 12 px `meta` label ("Context compacted").
- **Code blocks:** 8 px radius on the `code` tint.

### Scrollbars
Overlay thumbs only, never a track or a gutter, whatever the engine or the macOS scroll bar setting. Native scrollbars are hidden. A 6 px thumb (ink at 26 %, 3 px radius, inset 2 px, at least 24 px long) fades in while a region scrolls or is hovered, widens to 8 px (ink at 42 %) under the pointer, can be dragged, and fades out about a second after. Content keeps its full width, so the transcript's text edges stay aligned with the composer. `prefers-reduced-motion` removes the fade.

One manager draws the thumb for every scroll container in the app, portals included (`packages/ui/src/lib/overlay-scrollbars`, mounted once in `App.tsx`): a container only needs `overflow: auto`. `data-scrollbar="none"` opts a strip out where a thumb would cover it (session tabs, workspace tabs, the project strip, attachments); those fade at the edge instead. The terminal uses xterm's own overlay bar, set to the same size and colours in a 10 px lane.

A resize strip on a scroller's edge carries `data-edge-handle` (the sidebar's rail). The thumb shows over it and leaves it the outermost 2 px.

Exception: the HTML file preview keeps the engine's own scrollbars. It is a sandboxed frame with an opaque origin, so no thumb can be drawn for it, and hiding its bars from the outside would mean rewriting the user's document.

### Tooltips and toasts
Tooltips: inverted (`tipbg`, `tipink`), 12 px, 7 px radius, max 280 px, clamped to the composer card's edge. Toasts: the same inversion, 12.5 px, 9 px radius, centred under the header.

### Motion
Motion is functional and short:
- **State fills:** 0.12–0.16 s.
- **Menus, rows and toasts entering:** a 4 px rise over 0.14–0.22 s on `cubic-bezier(.16,1,.3,1)`.
- **Workspace panel slide:** 0.32 s on `cubic-bezier(.22,1,.36,1)`.
- **Disclosure chevrons:** rotate over 0.15 s.
- **Spinners:** 0.8 s linear.
- **Group-header actions:** fade over 0.12 s.
- **Jump highlight:** the transcript row a jump lands on is tinted with the accent at 16 % and fades over 2.2 s. With reduced motion it is a still 12 % tint for the same time.

`prefers-reduced-motion` removes every animation and transition.

### Named Rules
**The One Slot Rule.** The composer's bottom-right slot holds the action that matters now: Send, Stop or Stopping. Only the Queue split may sit beside Stop, and only while the agent runs with text typed.

**The No-Confirm Stop Rule.** Stopping is always one click or one keystroke (⌘.), in the composer and in the activity strip. The result is reported afterwards (a toast or a transcript line), never asked for before.

**The Exclusive Environment Rule.** Local, worktree and temporary are one choice with one answer. Temporary never has a branch or worktree, and the UI shows this by locking the control, not hiding it.

## Do's and Don'ts

### Do:
- **Do** use the 28 px row pitch for every new list, and align new title bar elements to the column edges below them.
- **Do** put blue text in Blue Ink (`accent-ink`) and blue fills behind white text in Deep Blue Fill (`accent-fill`); System Blue (`accent`) is for the ready Send, the caret and tints.
- **Do** keep the focus line a solid 2 px Focus Blue (2 px off a control, on a field's own edge), at 3:1 or better against the ground, card and hairline.
- **Do** show status in the right slot of a row (spinner, "needs you", count) and keep the project letter in the leading slot.
- **Do** use tabular figures for every number that changes in place.
- **Do** design every surface in light and dark together, using the `-dark` twin of each token.
- **Do** keep text at 4.5:1 (`meta` is the lowest text colour), targets at 24 px or more, and toolbar targets at 28 px.
- **Do** give every shortened or icon-only control a tooltip and accessible name that carry its full meaning and shortcut.

### Don't:
- **Don't** use webfonts, sizes above 15 px, uppercase labels or weights other than 400, 500 and 600.
- **Don't** use blue, amber or red as decoration, a background wash or a resting border.
- **Don't** tint text, fills or borders with a provider colour; it is a dot only.
- **Don't** add shadows beyond the card lift and the float shadow, or any resting border thicker than 1 px.
- **Don't** wrap the composer in a frame or a different-grey box; strips tuck under the card.
- **Don't** hide a control at narrow widths; merge, shorten or iconify it.
- **Don't** confirm Stop; the one confirmation in the composer is turning on Unattended, once per session.
- **Don't** use `faint` for text, draw a scrollbar track, or let a native scrollbar take width; scrollbars are overlay thumbs.
