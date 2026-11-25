---
"@qlan-ro/mainframe-ui": minor
"@qlan-ro/mainframe-types": patch
---

Redesigned transcript

- Each turn has one work row ("Worked for 2m 14s · edited 3 files"). It folds when the turn ends and opens on rows, one per step. The answer stays in view.
- A failed step is counted in the work row, which opens on it. A step that a later one made good reads "1 failed, retried" in grey.
- Agents, delegated tasks and workflows hold their turn open with a live count until they finish. A delegated task's result appears in its own row.
- A turn that waits on a permission reads "Waiting on you" and stays open. Work a killed session left behind reads stopped, and a turn nothing says the end of claims none.
- Skills, plans, schedules, monitors, worktrees and notifications are pills that stay visible when the work folds. An answered question stays as a small card.
- Times are in each message's footer, shown on hover or focus, with a time marker at the start and after a 30-minute gap.
- Links share one style and open where Settings › General › "Open links in" says: the workspace browser or the system's. A `0.0.0.0` address counts as a local server.
- A running background command's output is readable in its row.
- Settings › General › Transcript (Verbose/Compact) became "Finished work" (Fold/Keep open). A stored Verbose choice starts as Keep open, Compact as Fold.
- Code in the transcript is syntax-highlighted again.
