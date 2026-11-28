# @qlan-ro/mainframe-types

## 2.17.0

### Minor Changes

- [#934](https://github.com/qlan-ro/mainframe/pull/934) [`92d0e4f`](https://github.com/qlan-ro/mainframe/commit/92d0e4fe63fbfb43f78519234b90299a3e32167d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - External MCP clients can wait for a chat to finish or ask for input instead of polling, and a client you allow in Settings can answer its permission prompts, questions and plan approvals for hands-free use.

- [#946](https://github.com/qlan-ro/mainframe/pull/946) [`3724775`](https://github.com/qlan-ro/mainframe/commit/3724775b16b9e983ec6241ce800c71ddabd78c33) Thanks [@doruchiulan](https://github.com/doruchiulan)! - The composer is one card that carries its context: project and branch above it in a new session, ongoing work above it after that, and where the session runs, its branch and its changes below. While a turn runs, a message can be queued or steered into the turn (Settings › Chat picks which one Enter does), Stop ends the turn and its sub-agents, and messages a stop held back wait in the composer. Requests from sub-agents and delegated tasks show above the composer on their own, oldest first, and Unattended asks once per session. Picking another provider's model switches the chat without a confirmation. “Always allow” lists everything it saves and says what it leaves out: a permission mode wider than Auto-Edits, or a suggestion the app cannot read, is never saved from a prompt, whichever client answers. The command a request runs shows whole, cannot be allowed before its end was shown, and what is approved keeps its stored order whatever its script.

### Patch Changes

- [#996](https://github.com/qlan-ro/mainframe/pull/996) [`1ea1979`](https://github.com/qlan-ro/mainframe/commit/1ea19797234875cb0e003eae8c89e8868b457d5d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Load large sub-agent and older history pages faster: the daemon sends them as binary WebSocket frames that the app inflates natively, and updates are validated by tag.

- [#1008](https://github.com/qlan-ro/mainframe/pull/1008) [`412c6ca`](https://github.com/qlan-ro/mainframe/commit/412c6cad802c04da39d613ddad1d1ccfad4fb058) Thanks [@doruchiulan](https://github.com/doruchiulan)! - In the plain transcript list (preview setting), the loaded history stays bounded: it shrinks to the newest page when you scroll back to the bottom. A jump to something not loaded (a Find match, an Activity row, a link) loads a window around it instead of everything in between, and scrolling on from it reaches the latest messages. Find in that list uses only daemon search. The daemon can now raise a connection's history floor (`_mainframe.dev/history_trim`), so a window cut back to the newest page still pages.

- [#989](https://github.com/qlan-ro/mainframe/pull/989) [`2edaf21`](https://github.com/qlan-ro/mainframe/commit/2edaf210a2fee9e4beea698d4be6b89ffce6512d) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add a history request that returns a page of the conversation around one item, and serve history pages and search without copying the whole conversation.

- [#999](https://github.com/qlan-ro/mainframe/pull/999) [`4bddadb`](https://github.com/qlan-ro/mainframe/commit/4bddadb6cd691ffaf18ab1d26f8a433ec31d152c) Thanks [@doruchiulan](https://github.com/doruchiulan)! - History windows are sized by whole turns. A chat opens on its last N turns and each older page adds N more, so the transcript never starts mid-turn. N is set in Settings, Chat, "Turns to load at a time" (default 10, 2 to 50). The daemon drops whole turns from the top of a window that would send more than about 1 MB. Requests without `turns` behave as before.

- [#965](https://github.com/qlan-ro/mainframe/pull/965) [`0ddf245`](https://github.com/qlan-ro/mainframe/commit/0ddf245643731b9d3548bb9079a6e047420e7db5) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Add Back and Forward to launched previews and URL tabs, and remove the address field’s status dot.

- [#948](https://github.com/qlan-ro/mainframe/pull/948) [`7de33a7`](https://github.com/qlan-ro/mainframe/commit/7de33a7418e4773e4614cc173a07f4c9310fe032) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Redesigned transcript

  - Each turn has one work row ("Worked for 2m 14s · edited 3 files"). It folds when the turn ends and opens on rows, one per step. The answer stays in view.
  - A failed step is counted in the work row, which opens on it. A step that a later one made good reads "1 failed, retried" in grey.
  - Agents, delegated tasks and workflows hold their turn open with a live count until they finish. A delegated task's result appears in its own row. A live one has Stop in its row.
  - A turn that waits on a permission reads "Waiting on you" and stays open. A turn claims an end only when its own messages say one; otherwise it reads "Worked" with a dot, which is how Claude history reads after a reload. A step that never came back reads "No result recorded", and "Stopped" only where something says so.
  - Skills, plans, schedules, monitors, worktrees and notifications are pills that stay visible when the work folds. An answered question stays as a small card.
  - User messages and the turn’s reply footer show their time on hover or focus. Messages in the middle of a turn lose their footer times. A time marker appears at the start and after a 30-minute gap.
  - Links share one style and open where Settings › General › "Open links in" says: the workspace browser or the system's. A `0.0.0.0` address counts as a local server.
  - A running background command's output is readable in its row.
  - Settings › General › Transcript (Verbose/Compact) became "Finished work" (Fold/Keep open). A stored Verbose choice starts as Keep open, Compact as Fold.
  - Code in the transcript is syntax-highlighted again.

- [#994](https://github.com/qlan-ro/mainframe/pull/994) [`abd524e`](https://github.com/qlan-ro/mainframe/commit/abd524ecf329786cdb0bb56c71d33998a68f3dd1) Thanks [@doruchiulan](https://github.com/doruchiulan)! - Open a sub-agent tab faster: it fetches only its own tool call and its steps instead of paging the parent conversation back to it, and restoring a sub-agent tab on reload no longer loads parent history. The history request can now return an item's descendants.
