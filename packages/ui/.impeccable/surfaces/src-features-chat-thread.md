---
version: 1
slug: 'src-features-chat-thread'
primary_target: 'src/features/chat/thread'
related_targets:
  [
    'src/features/chat/messages/turn',
    'src/features/chat/tools',
    'src/features/chat/links',
    'src/features/chat/view-model/turn',
  ]
---

# Transcript

## Scope and mode

Operate. Messages, turns, tool rows, markers, sub-agents and delegated tasks, markdown and links. Canvas page "Transcript". Spec rows: T1–T1g in `design/redesign/DECISIONS.md`.

## Audience and job

Follow what an agent did and why, find the step that failed, and copy or quote what matters.

## Constraints

A turn is the agent's response to one user message, read from the messages themselves, so it holds for every provider and for history. Rows render per message: a streamed chunk re-renders the slice it touched, and text that becomes a step keeps its element. Nothing a transcript holds is dropped or told falsely: another agent's messages are drawn by the components that draw them in a chat, and a state is only "running" while something can still finish it. A part of a turn stands as the evidence says, never as the transcript's shape suggests: `partState` in `build-turns.ts` is the one rule. Going is read from the session, an end only from the part's own messages (`turn-end.ts`), and nothing is kept of how a run ended, so paging, a reload or a reconnect changes no end. A message written into a run ends no part of it, and assistant-ui's stand-in for the coming reply is no message. Where nothing says how a turn, or a call, ended, its row makes no claim; “Stopped” needs a cancelled call or turn, or a task record. Long threads, streamed. Every tool the app renders has a row or a marker (T1a). Times live in hover footers.

Queued messages are not in the transcript: they are rows in the composer. A steered message is, with "Steered into the running turn" under its bubble. Requests are answered above the composer, so a delegated task's card carries none.

Every row, marker and card for a tool call carries `data-activity-id` with the call's id (space-separated when a row stands for several), and its own disclosure is the first `aria-expanded` control inside it. A group that renders its rows only once opened lists their ids in `data-activity-group`. The session panel's jump (R13) relies on both.

A failed first message can show Retry or Unarchive in the transcript beside its composer recovery notice. Starting either action hides the remedies during the resend. Restoring or discarding the message removes its failed bubble.

Compaction and provider-switch dividers use 12 px arrows-in and repeat glyphs. Each divider reserves a 22 px line and surrounding space between the transcript blocks.

A reply to a hidden prompt starts its own turn. A background task notification adds a marker naming the event. Resume prompts without an event open a turn without a marker.

Only one module scrolls the transcript to follow new output, and assistant-ui's viewport scroll controllers are off. A reader who scrolled up stays where they are when a run starts by itself, when history arrives, or when the daemon sends a queued prompt at turn end. The user's own send moves them to the bottom and follows the reply. The scroll-to-bottom button shows whenever the transcript is not following, more than 2 px from the bottom, and a click follows again. Opening a session, on mount or by switching to it, shows the newest output on the first frame, with no hidden or blank frame and no frame at the top: the owner moves to the tail inside its resize callback, before the frame paints. The plain list fades its top and bottom edges with two gradient strips, 16 px tall, not a mask on the scroller: a mask over a scroller that holds every row made a streaming reply run at 4 frames a second. The transcript has no scrollbar thumb: it jumped and resized whenever older messages landed above, which read as broken scrolling. A chat that is still loading shows a spinner in the middle only if the load outlasts 200 ms, and keeps it at least 300 ms, so a cached or fast open never flashes it; an error replaces it at once.

Two lists draw the transcript, chosen in Settings › Chat (the plain list is a preview, off by default). Today's list is react-virtuoso inside assistant-ui's viewport, held by the bottom pin (`use-thread-bottom-pin.ts`), the prepend anchor and the row anchor. The plain list draws every loaded message as a plain row under one scroll owner (`use-scroll-owner.ts`) with the browser's scroll anchoring on and the composer below the scroller, not inside it. A folded turn's messages that show nothing get no row, so a folded turn is as tall as its work row and answer (today's list keeps a 1 px row for each). The owner follows the tail inside the resize callback, stops following only on the reader's upward input (or opening a row, or a jump to a row) and follows again only on the reader's own downward scroll that reaches the bottom, the End key, the jump button or the user's own send. Content shrinking below a reader who scrolled up never brings follow back. While following, only a layout change that explains a move up keeps follow: the browser clamping to shrunk content, or anchoring by no more than it shrank. Any other move up, such as the reader's scroll or a selection drag, releases follow. A turn that ends while the reader is above the tail stays open until they come back to the tail, so its fold never takes away what they are reading; a turn that arrives already finished, in an older page or a jump window, shows folded from its first frame. A page of older messages that lands within a screen of the top is corrected where the browser did not hold the reader, with a relative scroll that keeps a flick going. The newest rows mount first and the rest follows above them in slices, so the tail is on screen at once. The top of the plain list is a fixed 48 px band in every state, so it never moves the rows under the reader: a spinner with "Loading earlier messages" while a page is in flight (held at least 300 ms), a muted "Earlier messages" cue with an up arrow while more is above and nothing loads (a click loads), and "Beginning of conversation" at the start. Today's boundary row is unchanged.

The plain list keeps its loaded window bounded. When the reader comes back to the bottom, everything above the newest page (the same number of whole turns a page loads, Settings › Chat) is dropped; they are at the bottom, so nothing moves, and the cue above reads "Earlier messages" again. A page loads only on the reader's upward scroll, so there is no cap on how far back they can read; the window shrinks when they return. On a daemon that cannot raise its history floor the window is not cut back, so it only grows. A jump to something not loaded (a Find match, an Activity row, a link to an item) loads about a hundred items around it instead of everything between, and the transcript shows that window until the reader leaves it. The window opens at its top, then the jump scrolls to the row. Follow stays off in it: its bottom is not the live end, and the scroll-to-bottom button always takes the reader to the live tail. The top of the window behaves as the top of the list (a page of earlier items on upward input). Its bottom is a 48 px band with the same rules: a spinner with "Loading later messages", a muted "Later messages" button with a down arrow while the window ends before the chat does (downward input within a screen of the bottom loads the next items), and "Back to latest" where the window reaches the end of the chat (one more downward step at the bottom returns). Sending a message, or leaving the chat, returns to the tail. Export, the session panel and sub-agent tabs keep reading the live transcript meanwhile. What the chat does meanwhile is never lost: the tail keeps every update and shows them on return. The window is a snapshot and is read again at the end of a turn, after a compaction, a cleared transcript or a resync. Find has no in-page fallback on the plain list; a daemon without search shows "Search needs a newer daemon".

Markdown streams by block: while a reply streams, only its last block is parsed and drawn again, and the finished blocks above it keep their elements and any selection in them. The unfinished tail renders as what it is becoming: an open fence is already a code block, a half-written `**bold` is bold, and a link cut mid-address shows its text with no address. The typing reveal holds while a selection sits inside the streaming text. Code blocks in replies are shadcn's Code Block: language label, labelled Copy, numbered lines, and no trailing empty line.

Markdown images, local and remote, inline badges included, sit in a 240 px tall frame from the first render, so the text around them never shifts as they load. A larger image scales down into the frame; a smaller one keeps its size. An image that fails, or has not loaded after 15 seconds, shows its alt text with "(image unavailable)".

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

Agents and delegated tasks open in the workspace's Agent tab (W8), and their rows say what the tab says (T1c) and have its Stop while the work is live. A delegated task's request shows above the composer (G5).

After a turn ends, only its last failed step can open by itself. It opens if no later step in that turn succeeded and no successful retry recovered it. The same rule applies to child failures in their own turn. Live turns keep failed rows closed by default. The header still counts failures, and manual open or close choices take precedence.

Claude steers stay inside their running turn. The existing steer label also appears after a history reload.

Saved Claude agent rows use the recorded outcome and usage. When the transcript cannot settle the outcome, the receipt reads “Open to see status” and the turn does not auto-open a failed row. After the steps load, the receipt says “Status unavailable” if the outcome is still unknown.

Opening a saved Claude agent shows a loading status while its newest steps arrive. Earlier steps load on upward scroll or through Earlier messages. A failed load says “Could not load history” when the outcome is unknown. An open row offers Retry after a failed load or when its saved pages are cleared. A saved agent holds at most three pages of its steps, in its row and in its tab alike. Scrolling up past that drops its newest page, and a muted “Later messages” button then ends the steps (downward input within a screen of it loads the page again, and the oldest one goes). While the steps stop short of the agent's end, its last held words stay among the steps and the Result block shows what came back. The loading line is as tall as the button it replaces, so pressing Earlier or Later messages moves nothing. On the plain list the scroll owner holds the reader's place when a page lands above them, at the top of the tab as well, where the browser does not anchor.
