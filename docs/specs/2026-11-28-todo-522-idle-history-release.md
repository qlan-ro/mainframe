# Free idle chats' history after a configurable time

Todo #522. It builds on the two-hour idle offload (todo #178, `2026-09-25-todo-178-idle-whole-chat-offload.md`) and the windowed first view (#1014, `docs/guides/transcript-readiness.md`).

## Problem

Every chat the daemon opens keeps its whole history in memory as four copies:

- the raw message list;
- two display copies inside the projector;
- the facade hub's revision log, which holds every item encoded.

A big chat costs a few hundred MiB this way. Eight open chats took the daemon past 1 GiB. The idle offload frees three of the copies only after two hours. It left the revision log behind, because the hub had no handler for an offload.

## Behavior

### The idle history release

Every minute, the idle scanner looks for chats that nobody has viewed or used for the user's idle time. The default is 10 minutes. For each one, it drops three things:

- the raw history;
- the projection;
- the facade hub's revision log.

The chat keeps everything else:

- its registry cell;
- its CLI session, so the next send does not respawn;
- its permission state;
- its worktree offers;
- its tool timings.

The release emits no `chat.offloaded`. Clients keep what they hold.

**What counts as use.** A chat is used when it loads, sends, reads its history, or when its CLI is active. It is viewed when any of these holds:

- a facade connection has a session on it. The desktop attaches only the chat on screen, a workspace tab or a task row. Mobile attaches what it shows.
- an event socket subscribes to it.
- an orchestration wait (`chat_wait`, a task wait, the external MCP wait) is watching it.

Viewing counts as use. A chat the user just left therefore waits the whole idle time before it is released.

**Chats that keep their history.** A chat is never released while any of these holds:

- it is working, or a prompt or turn is in flight;
- it has a pending permission or gate;
- it has a queued prompt, a held maintenance prompt or an agent outbox entry;
- it has a delegated task on either side, an active child chat, or a live background task;
- its session reports work in progress (`blocks_idle_offload`);
- idle compaction is on and the chat may still be compacted (its last run has not been claimed, and the provider's cache window has not passed);
- a client is viewing it;
- the transcript cannot give its history back: a temporary or ephemeral chat, a missing transcript, a chat with no session to read, or a fork that has not sent yet.

The scanner selects candidates. `ChatRelease` checks each rule again under the offload claim. Loads, starts, sends, interrupts and history reads exclude that claim, so a chat that wakes up between the two checks stays.

### The idle offload

The two-hour offload is unchanged, except that it now also tells the chat surface. The hub then drops the chat's revision log. This was the one copy the offload used to leave behind.

### Returning to a released chat

- **A view.** The chat's cell stays, but its history is marked released. Three things follow:
  - The load path (`claim_load`) restores the history into the live cell, through a stateless history session. It never replaces the cell or the CLI session.
  - The first window may come from disk, the way a first open does. The persisted tail and the adapter's pages both count, because the chat's idle CLI writes nothing; a chat holding its history in memory never takes these paths.
  - The windowed resume then completes the history in the background. It resyncs only when the window it served differs.
- **A send.** A send or steer restores the history before it appends.
- **An append that arrives first.** Output the CLI produces on its own can reach a released chat before anything restores it. That append is skipped, never stored as a partial list, because the restore reads the transcript it came from.
- **Multi-segment chats.** These skip the snapshot cache and never page. A first view of one, whether a first open or a return, waits for every segment to be composed, as before this change. It took 1.6 s once in the owner's logs. Paging composed chats is follow-up work.
- **A desktop that still holds the chat.** When the desktop still holds the chat's controller, it reattaches with a cursor. The dropped revision log is an unknown epoch, so the reply replays the chat's window from a full read. The desktop shows the transcript it already holds until that reply arrives.

## Setting

`general` setting `historyRelease.idleMinutes`:

- on the wire, `historyRelease: { idleMinutes: number | null }` in `GET` and `PUT /api/settings/general`;
- whole minutes from 1 to 1440, or `null` for never;
- stored as the minutes or `never`; the default (10) deletes the row;
- a missing or invalid row reads as the default;
- the daemon reads it on every scan, so a change applies within a minute.

Settings › General › Chats offers 5, 10 and 30 minutes, 1 hour, and Never. The UI shows a stored value it does not offer (one set through the API) as an extra choice.

**Never.** Never is offered for users with memory to spare who switch between large chats and would rather not wait for reloads. It turns off the release only: the two-hour offload still frees the chat, and stops its CLI.
