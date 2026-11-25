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
Keyboard first: Enter, ⌥↵, ⇧⇥, ⌘.. Gates are answered one at a time, oldest first, whoever asks: the session, a sub-agent or a delegated task. Steer needs an adapter that can take a message mid-turn; otherwise both choices queue and the menu says so. Draft content keeps today's segment model and highlight to quote.
Text a gate asks the user to approve shows whole, with nothing hidden, in stored order (`stored-order`, `visible-text.ts`). What overflows is not allowed unread: the allowing answers are locked until its end was in view (`use-shown-to-end.ts`). The bottom strip belongs to the thread footer, so a chat with no composer keeps it.
The gate slot carries `data-chat-gate`: an Activity row that needs you moves focus into it (R13).

The read dialog has a title, a labelled scroll region at least 64 px tall, and a reserved footer row. If the request text grows while the dialog is open, the reader must reach the new end. The manual confirmation appears only when the scroll region has no client rectangles. Closing returns focus to Show or the first available answer. If the request went away, focus moves to the next gate's first available answer or to the composer.

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
