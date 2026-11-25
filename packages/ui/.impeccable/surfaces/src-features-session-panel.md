---
version: 1
slug: "src-features-session-panel"
primary_target: "src/features/session-panel"
related_targets: []
---

# Session panel

## Scope and mode
Operate. The panel beside the chat: Activity, pull requests, plan, launch, files, skills, attachments, tasks; docked or floating. Canvas page "Session panel". Spec rows: R in `design/redesign/DECISIONS.md`.

## Audience and job
See everything the session is running or has run, and reach it in one click.

## Constraints
300 px wide, fits its content and caps at the chat area. Docks only at a chat column of 1044 px or more, otherwise floats and ends 8 px above the composer, which stays usable. Sections can be hidden per viewer. Before the first message it shows project-level sections only.
Rows don't unfold, except workflows. Worktree, branch and changes live in the strip under the composer (`BottomStrip`), not here.
A jump lands on the transcript row that carries the tool call's id in `data-activity-id`. Work that started before the loaded history loads it first; a row never goes to a neighbouring message instead.
A jump that waits for history says so on its row and gives way to any later action; leaving the session drops it silently.
Focus doesn't leave the section with a row: it follows the row to Earlier, else goes to its neighbour. Row actions are Tab stops after the row, not only in its menu.
A row that can be stopped shows Stop at its end on hover or keyboard focus, over its value. A background command's output is “Full output” beside Stop and in the row menu until its transcript row shows it; the dialog belongs to the section, so it outlives the row's move to Earlier.

## Direction contract
THESIS: a quiet index of the session, not a dashboard. Every row leads with what it is and ends with its state.
OWN-WORLD: kind icons from the app's ActivityRow (Bot, filled Bot, Route, Binoculars, SquareTerminal, Clock3), trailing status, inset hairlines between sections, a "Session" title with a Sections menu.
STORY: the user spots what needs them, opens an agent in the workspace, or jumps to the transcript row behind a monitor or schedule.
FIRST VIEWPORT: "Session", then Activity with live work first and finished work under Earlier.
FORM: seed: none (pinned) "i need the icons for knowing what type of activity it is even in earlier".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
Clicking a monitor row scrolls the transcript to its pill, opens it and highlights it.

## Unresolved
None.
