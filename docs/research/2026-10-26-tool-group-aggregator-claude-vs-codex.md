# Tool-use aggregator: Claude desktop vs Codex desktop vs Mainframe

## Scope and evidence

Static reverse engineering of the collapsible row that aggregates consecutive tool calls. No app UI was driven; no profile data, credentials or conversations were read. Nothing was rendered, so spacing and colour come from classes and resolved tokens, not pixels.

- **Claude desktop** v3.6556.2. `app.asar` is only the shell (its `index.html`: "everything else gets loaded from claude.ai"). The Code transcript is claude.ai web code, recovered from Electron's HTTP cache (`~/Library/Application Support/Claude/Cache/Cache_Data`, zstd). Newest deploy: Oct 24. Formatted copies: `/tmp/rev-tooluse-20261026/claude/readable/`.
- **Codex desktop** (`/Applications/ChatGPT.app`, `com.openai.codex`) v26.1021.31345. Renderer in `app.asar`. Formatted copies: `/tmp/rev-tooluse-20261026/codex/`. 22 isolated predicates were executed in a Node VM and passed. Behaviour from [the 2026-10-03 study](2026-10-03-codex-activity-grouping.md) still holds; this doc adds styling and states.
- Names are minified. File refs are `file:line` in the formatted copies; those `/tmp` paths are local, not portable.

## 1. The two models at a glance

|                              | Claude desktop (Code)                                                             | Codex desktop                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| What merges                  | Almost every tool: Bash, Read, Edit, Grep, Glob, web, TodoWrite, Task/Agent…      | Exec, patches, MCP, web search, dynamic tools                                 |
| What splits a group          | Assistant text, errors, interactive cards (AskUserQuestion, ExitPlanMode, MCP apps) | Commentary, compaction, errors, images, subagents, MCP apps                   |
| Thinking                     | Joins the group                                                                   | Hidden; does not split                                                        |
| Single-tool group            | Header becomes that step's own row                                                | Becomes standalone                                                            |
| Default state                | Collapsed (few exceptions)                                                        | Collapsed, always                                                             |
| Permission pending           | Group header turns "Needs your input", group forced open                          | Standalone "Awaiting approval" shimmer line, not in a group                   |
| Settled summary              | Counted: "Read 2 files, ran a command (1 failed)"                                 | Uncounted: "Read files, ran commands"                                         |
| Live label                   | Present-tense label of the running step; shimmer                                  | Running item's label ("Reading foo.ts", "Running command"); shimmer           |
| Label hold                   | Min 650 ms; busy→busy 2000 ms; 250 ms stability; settle immediate                 | Identity change ≥1000 ms; settle immediate                                    |
| Header chrome                | Bare text row, status mark left, caret after label                                | Bare text row, kind icon left, caret after label, hidden until hover          |
| Body                         | Card with divided rows, no max height, no animation                               | Bare list, `max-h-56` scroll with edge fade, 300 ms height/opacity animation  |
| Turn-level fold              | None; the live group carries the turn's single status mark                        | "Working for / Worked for / You stopped after" fold above the final answer    |

## 2. Claude desktop

### Grouping

Fold (`shared-36…:5240–5510`) with Code policy `{thinkingJoinsGroup: true, foldNarration: "never"}` (`c4de…:12279`):

- tool, task and event entries join as steps. Tools classed as cards break the run, except cards placed "after", which are emitted after the group while it continues.
- Every assistant text block ends the group. `error`/`turn_error` become cards or notices and end it too.
- Roll-up table `Mk` (`c4de…:4730–4768`). **Merge:** ordinary tools, sub-agents, peer sends, worktree moves, notifications, Slack posts. **Stand alone:** AskUserQuestion, ExitPlanMode, SendUserMessage/File, Workflow, Artifact, ReportFindings, MCP apps, connector/plugin/skill cards. A standalone tool still running rolls into the group until it settles.
- Consecutive steps with the same repeat key collapse into one row. No nested groups.

### Header text

- **Settled** (`c24951e9f…`): lower-case verb + ICU-pluralised noun per category, first verb capitalised, joined with `", "`. "read/edited/created {a file|# files}", "ran {a command|# commands}", "searched code", "found files", "browsed the web", "fetched {a page|# pages}", "updated todos", "ran {an agent|# agents}", "used {a tool|# tools}".
- Counts are **distinct targets** (per path, else per tool id). Reading one file twice is "Read a file".
- All file ops on one file: "Read and edited foo.ts", with the file name as a link.
- 5+ parts: keep 3, then "and # more actions".
- Failure suffixes "(# failed)", "(# blocked)", "(# stopped)". A part whose items all failed turns `text-danger`. Interrupted or rejected calls do not count as failures.
- **Live** (`h2`, `shared-14…:15196`): permission pending → "Needs your input"; tool running → its present-tense label ("Running the tests", conjugated from the Bash `description`; "Reading foo.ts"); thinking → the latest thinking summary or "Thinking…".

### States

| State           | Look                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| pending         | Status mark only, no label                                                             |
| busy            | Animated mark left, shimmering label, elapsed time after 5 s, SR "running"             |
| blocked         | Warning badge "Needs your input"; outcome "Needs approval" (`text-warning`); forced open, not toggleable |
| done            | Summary label, caret if expandable; mark exits over 400 ms                             |
| failed          | Outcome word "Failed" (`text-danger`)                                                  |
| partial failure | "(2 failed)" suffix                                                                    |
| stopped/denied  | Outcome "Stopped"/"Denied" (`text-secondary`)                                          |
| empty           | Renders nothing                                                                        |

Opens by default only for first-time nudges, some failures (`add_repo`; memory save with ≤8 tools) and always-open single tools. "Verbose" mode forces all open. **Nothing auto-collapses on turn end.** Open state lives in a per-session in-memory store (LRU of 50), keyed by first tool id, surviving remounts but not reloads. Collapsed text is mirrored into `hidden="until-found"` so browser find opens the group.

### Styling

- Root `div[data-cds=TurnStatus]` → `group/status flex w-full min-w-0 flex-col`.
- Header row `flex min-w-0 items-center gap-xs text-start font-sans text-body font-normal`, padding computed to control height, `px-xs` with negative inline margins so hover/focus bleeds past the text column.
- Row order: status mark (20 px column; in Code a clay `#d97757` mark whose variant follows the tool: think/read/write/search/code/blocked) → label (shimmer while busy) → subject (`text-secondary`, `text-primary` on hover) → outcome word → trailing (elapsed, `+N −M`, "·"-separated) → caret toggle.
- Caret: `CaretRightFilled` xs, `text-muted`, `transition-transform duration-fast` (60 ms); open `rotate-90 text-secondary`. The toggle's `after:absolute after:inset-0` makes the whole row clickable.
- Shimmer: 120° gradient text, `background-size:400%`, 3 s linear infinite; off under reduced motion and forced colours.
- Label change: 180 ms `cubic-bezier(.2,0,0,1)`; old label fades up 3 px, new fades in from 3 px below, width glides.
- Body: `pt-sm pb-xs`, indented 20 + 12 px when a mark shows; card `flex flex-col divide-y overflow-y-clip rounded-card shadow-card-ring`, rows `px-[--cds-turn-status-card-pad-x] py-sm`. No max height, no scroll, no height animation.
- Tokens: `--cds-dur-fast/snap/base` 60/120/200 ms; `text-secondary` `#52514e` / `#a5a49a`; `text-body` 13–14 px by density.
- A11y: native button, `aria-labelledby` covering label + subject + outcome; polite `role=status` region announcing changes.

## 3. Codex desktop

### Structure

```
div.min-w-0.text-size-chat.relative
└ div.flex.min-w-0.flex-col
  ├ div.group/activity-header.inline-flex.self-start.items-center.gap-1
  │ ├ button[aria-expanded][aria-labelledby].absolute.inset-0.rounded-md   ← invisible overlay, inset focus ring
  │ ├ icon 16px text-text/60 + label span (truncate, text-text/60, hover → text-default)
  │ └ chevron
  └ motion.div (height/opacity) → div.vertical-scroll-fade-mask.max-h-56.overflow-y-auto
```

- No rail, border, indent or background on the body.
- Chevron: 14 px right caret **after** the label, `opacity-0` at rest, visible on hover/keyboard focus, `rotate-90 opacity-100` when open; rotation 300 ms.
- Colours: running/thinking label ≈27% of foreground (shimmer base); completed 60%; hover 100%. Child rows 30%.
- Shimmer: masked sweep; first pass 600 ms after visible, then a 1 s pass every 4 s; paused off-screen, hidden or reduced motion; **disabled inside an open group**.
- Expand: state machine collapsed → opening → expanded → closing; lazy body; 300 ms `cubic-bezier(0.19,1,0.22,1)` both ways. Does not honour reduced motion.
- Completed header shows the icon of a representative item (new in this build).

### Header states

Running command ("Running command", or the command in coding mode), "Reading {target}", "Searching for {query}", "Listing files in {folder} folder", "Editing files", web title or "Searching the web for {query}", MCP label, "Thinking", "Waiting for your answer", the live reasoning heading, completed summary (`Intl.ListFormat` unit list, fallback "Worked"), and not-expandable (no button, no chevron, no hover change).

### Child rows

- Read/search/list: verb in tertiary, path as dotted-underline file link (tooltip with full mono path; click opens side panel).
- Commands: "Ran {command} in 2m 5s", "Running command for 12s", "Stopped {command} after…", "Command declined by auto-review". **Failures look identical collapsed**; exit code appears only in the expanded footer ("Success" / "Exit code N" / "Stopped"). Expanded card `rounded-lg border bg-secondary-soft-alpha`, command line clamped to 2 lines, output `max-h-36` bottom-anchored with ANSI colours.
- Patches: one row per file, Edited/Creating/Rejected verbs, diff stats uncoloured until hover, 6 px dot for new/deleted files.

### Outer fold

- Button (ghost tertiary): label **then** chevron (always visible, 150 ms rotation), optional "N denied actions" badge right-aligned that expands and scrolls to the denial.
- `border-t` divider (8% foreground) under it whether open or closed.
- Labels: skeleton (loading), "Activity", "Paused", "Working" (<1 s) → "Working for 12s" (ticks), "Worked for 2m 5s", "You stopped after…", "N previous messages".
- Collapses with no animation when the final answer starts; user expand 300 ms with −8 px translate; collapse 150 ms; reduced motion fades only; collapsed body is `inert`.

## 4. Mainframe today

Two unrelated aggregators, chosen by `transcriptMode` (default `verbose`, `store/ui-prefs.ts:179`).

### Verbose (default)

- Daemon-authoritative (`mainframe-display/src/tool_grouping.rs`). Groups only runs of the adapter's `explore` category: Claude `Read/Glob/Grep/LS`; **Codex declares none**, so Codex never groups. A lone explore call is never grouped. Bash, Edit, Write, Task, MCP render as individual cards.
- `components/ui/assistant-ui/tool-group.tsx`: outlined card around the whole group (`rounded-lg border bg-card py-3`), **default open** (`tool-dispatch.tsx:38`), chevron-down **before** the label, label `font-medium text-foreground`, plus a mono "N calls" count.
- Label `tool-group-summary.ts`: "Read 3 files · Searched 2 patterns · Globbed 1 pattern · 2 tools"; counts calls, not distinct targets.
- Running: only `aria-busy`. No live label, no shimmer, no permission or failure state on the group.

### Compact (opt-in)

Modelled on Codex (#371, #384, #764, #769).

- Mixed-kind groups. Known kinds come from a hard-coded name map (`view-model/compact/tool-kind.ts`); `unknown` kinds (TodoWrite, Skill, NotebookEdit, Claude's newer `Agent`…) are not routine and split groups. Tools awaiting approval, stopped or declined are standalone (`build-activity-groups.ts:5`).
- Live label: last running tool's label, else "Thinking"; 1000 ms identity hold (`use-stable-activity-label.ts`).
- Summary: Codex-style uncounted ("Read files, ran commands"), no failure mention.
- Header (`CompactDisclosure.tsx`): spinner (running) or **check icon (every settled group)** on the left, chevron after label (always visible), hover `bg-muted`, tooltip repeating the label.
- Body: `border-l` rail with `ml-1.5 pl-3`, `max-height: min(224px, 50cqh)`, each child row again with its own status icon (check/spinner/X/octagon/clock) and elapsed time. No open/close animation, no chevron transition.
- Turn fold (`CompactTurnDisclosure.tsx`): ghost `Button`, chevron **before** label, "Worked for X" only once settled; no live "Working for", no divider.

## 5. Where Mainframe diverges

1. **Two models, neither matches a reference by default.** Verbose groups too little (explore only, never Codex, never Bash/Edit) and shows it as an always-open card. Both references group nearly all routine tools and start collapsed.
2. **Header looks like a card, not a status line.** Both references render the header as a bare, muted text row with the caret after the label and only a colour shift on hover. Verbose wraps it in a bordered card with a bold label and a count chip.
3. **No live state in verbose.** Both references make the group header the place that says what is happening now, with a shimmer label. Verbose has nothing.
4. **Permission and failure are invisible at group level.** Claude puts "Needs your input" in the header and forces the group open; failures surface as "(1 failed)". Mainframe compact splits the group on approval and never mentions failures in the summary; verbose has neither.
5. **Icon noise in compact.** A check on every settled group and on every child row. Neither reference shows a success mark: Claude's status mark exits on settle and Codex shows a kind icon.
6. **Compact grouping depends on a tool-name allowlist.** Unrecognised tools split groups; Claude rolls them up by default and only breaks for an explicit list of interactive cards.
7. **Motion and rhythm.** Mainframe has no expand animation and no label morph; Claude snaps the body but morphs labels (180 ms); Codex animates the body (300 ms).

## 6. Recommendation

One aggregator, used in both transcript modes, built on the compact view-model (it is already client-side, provider-agnostic and mixed-kind). Verbose then becomes "same groups, expanded by default, full tool cards inside" (what Claude's own verbose mode does), and the daemon's explore-only `tool_group` path can retire.

Take **Claude's semantics**, because they suit an orchestrator that shows both providers and needs to surface permission:

- Roll up every tool except an explicit interactive-card denylist (invert `tool-kind.ts` from allowlist to denylist).
- Assistant text and errors end a group; thinking joins it.
- Pending approval stays inside the group: header "Needs your input", warning tone, group forced open.
- Counted summary over distinct targets, with "(N failed)" suffix and `text-destructive` on fully failed parts.
- Single-step group renders as that step's row.
- Collapsed by default; no auto-collapse on settle; open state persisted per group key (Mainframe already does this).

Take the **header styling consensus** (both apps agree):

- Bare `text-xs`/body-size row, muted label, no card or border on the header, hover = colour shift only, whole row clickable, caret **after** the label.
- Left slot: an animated activity mark or spinner while busy that disappears on settle (no settled check). A per-kind icon is optional.
- Shimmer on the live label, off under reduced motion and inside an open group.
- Short label morph on change, with the existing 1000 ms hold (or Claude's 650 ms / 2000 ms busy-to-busy).

For the **body**, Claude's divided card (`rounded-lg border divide-y`, rows with tool cards) fits Mainframe's existing card-based tool UI better than Codex's bare list. Keep the existing `max-height` scroll, since Mainframe groups can be long.

Keep **Codex's outer fold** in compact mode, but fix it to match Codex: label before chevron, live "Working for X", divider below. Claude has no equivalent, so this is a Mainframe product choice rather than parity.

## Open points

- Claude remote flags (`om()` turnStatusRows, `fizzy-lake` colour/type/icons, renderer gate) were not resolved; the DOM above is the flagged-on `TurnStatus` path.
- Which Claude `text-muted` grey is light vs dark.
- Codex local vs ChatGPT Work single-item rules were not re-traced in this build.
