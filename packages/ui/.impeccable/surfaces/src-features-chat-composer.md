---
version: 1
slug: "src-features-chat-composer"
primary_target: "src/features/chat/composer"
related_targets: ["src/features/chat/gates","src/features/chat/commands"]
---

# Composer & gates

## Scope and mode
Operate. The composer card, its top strip (activity, queue), bottom strip (where it runs, branch, changes), the new-session empty state, draft content (files, captures, code annotations, quotes) and the gates pinned above it (permission, question, plan). Canvas page "Composer & gates". Spec rows: C, K, G in `design/redesign/DECISIONS.md`.

## Audience and job
Tell an agent what to do next, steer or queue while it runs, and answer what it asks. All of this happens without leaving the input.

## Constraints
Keyboard first: Enter, ⌥↵, ⇧⇥, ⌘.. Gates are answered one at a time, oldest first, whoever asks: the session, a sub-agent or a delegated task. Steer needs an adapter that can take a message mid-turn; otherwise both choices queue and the menu says so. Draft content keeps today's segment model and highlight to quote. The workspace adds to the draft and never sends for the user: a preview capture or a code annotation becomes a tile, its note edited there. A draft's first message that failed is the user's to restore, from a notice above the field: nothing is merged or sent again by itself. Switching a draft's project, worktree or daemon keeps prose and quotes, removes what belongs to the old place, and says so with an Undo.
The empty state claims only what it knows: no branch until it is read, nothing of one project under another's name, and a list that failed says so. A task's text goes under what was typed.
Text a gate asks the user to approve shows whole, with nothing hidden, in stored order (`stored-order`, `visible-text.ts`). What overflows is not allowed unread: the allowing answers are locked until its end was in view (`use-shown-to-end.ts`). The bottom strip belongs to the thread footer, so a chat with no composer keeps it.
The gate slot carries `data-chat-gate`: an Activity row that needs you moves focus into it (R13).

The read dialog has a title, a labelled scroll region at least 64 px tall, and a reserved footer row. If the request text grows while the dialog is open, the reader must reach the new end. The manual confirmation appears only when the scroll region has no client rectangles. Closing returns focus to Show or the first available answer. If the request went away, focus moves to the next gate as a whole, or to the thread when none is left, never to an answer or the composer.

A decorative middle dot separates the environment and branch buttons. The environment opens the worktree menu and the branch opens the branch manager. A matching live branch with a recorded creation base includes `from <base>` inside the branch button and a From row in the worktree menu.

## Direction contract
THESIS: one calm card that carries its context with it, never a toolbar of switches. Project above the input, where it runs below it, ongoing work tucked in a strip on top.
OWN-WORLD: white card on grey, 16 px radius, hairline and soft shadow, solid focus line. Tiles in one 172 × 40 shape. Requests pinned above in warning tone.
STORY: the user sees what the agent is doing, adds to it (Steer) or lines it up (Queue), and answers requests where they type.
FIRST VIEWPORT: before the first message, "What's next for <project>?" with recent sessions and project tasks, then the card with project and branch pickers.
FORM: seed: none (pinned) "calm Mac atmosphere", project above the input (Antigravity).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Memorable moment
A sub-agent's request appearing above the composer on its own, saying how many more wait.

## Unresolved
None.

Claude and Codex release the oldest queued prompt after each successful turn. Stop, interrupt, error and exit pause the queue. Each held row shows “Paused” and the reason (“Stopped”, “Interrupted”, “Error: <short>” or “Session ended”). Edit and remove stay available. One keyboard-accessible Resume action sends the oldest held prompt as the next turn and restores the usual release order. Sending while paused starts a new turn and leaves the held rows visible and paused. Use the same behavior in light and dark.

If Claude exits before its echo or 30 seconds pass without an echo, the head becomes Uncertain. It says "Not confirmed by the agent. It may have been received." and offers Mark as sent and Move to composer. Later rows say "Waiting on the message above". Mark as sent keeps the prompt in the transcript and advances the queue. Move to composer removes the row, adds its attachments, and appends its text below any existing draft with a blank line. The user reviews and sends it from the composer. A late echo confirms the original in place and releases the next prompt if the turn already ended. Resume stays hidden while the head is uncertain. A pending head can be resumed once the provider is ready. A rejected head offers Retry. Stop is checked at dispatch and again before Claude writes a queued prompt. Cold history still reconciles interrupted deliveries using the provider input ID.
