---
version: 1
slug: "src-features-chat-thread"
primary_target: "src/features/chat/thread"
related_targets: ["src/features/chat/messages","src/features/chat/tools"]
---

# Transcript

## Scope and mode
Operate. Messages, turns, tool rows, markers, sub-agents and delegated tasks, markdown and links. Canvas page "Transcript". Spec rows: T1–T1g in `design/redesign/DECISIONS.md`.

## Audience and job
Follow what an agent did and why, find the step that failed, and copy or quote what matters.

## Constraints
Queued messages are not in the transcript: they are rows in the composer. A steered message is, with "Steered into the running turn" under its bubble. Requests are answered above the composer, so a delegated task's card carries none. Long threads, streamed. Every tool the app renders has a row or a marker (T1a). Times live in hover footers.

Every row, marker and card for a tool call carries `data-activity-id` with the call's id (space-separated when a row stands for several), and its own disclosure is the first `aria-expanded` control inside it. A group that renders its rows only once opened lists their ids in `data-activity-group`. The session panel's jump (R13) relies on both.

## Direction contract
THESIS: one work row per turn, folded once the answer starts. Events are pills on the spine. This replaces a stack of tool cards.
OWN-WORLD: rows of glyph, verb, target and receipt. Pills for skills, plans, schedules, monitors, worktrees and notifications. Failures in muted rose. Answered questions are small cards outside the fold.
STORY: the user reads the answer first, opens the work only when needed, and sees child agents hold the turn open until they finish.
FIRST VIEWPORT: user bubble, "Worked for 1m 14s · 2 agents", the answer, a quiet footer on hover.
FORM: seed: none (pinned) "we shouldn't have more than one 'Worked' block in one turn".
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
"1 failed, retried" in grey, so a recovered failure doesn't shout.

## Unresolved
None.
