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
300 px wide. Docks only at a chat column of 1044 px or more, otherwise floats. Sections can be hidden per viewer.

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
