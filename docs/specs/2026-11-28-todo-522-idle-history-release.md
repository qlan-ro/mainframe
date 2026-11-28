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

Every minute, the idle scanner looks for chats that have no live process and that nobody has viewed or used for the user's idle time. The default is 10 minutes. For each one, it drops three things:

- the raw history;
- the projection;
- the facade hub's revision log.

The chat keeps everything else:

- its registry cell;
- its permission state;
- its worktree offers;
- its tool timings.

The release emits no `chat.offloaded`. Clients keep what they hold.

**Only chats with no live process.** A chat whose CLI or session process is alive (a Claude CLI child, a Codex app-server, any running turn) keeps its history until the process is gone; the two-hour offload ends it. A released chat therefore has nothing that can write to its history on its own. The memory breakdown found that this is the common case: an idle daemon typically has one CLI child, the chat on screen, and every other open chat has no process.

**What counts as use.** A chat is used when it loads, sends or reads its history. It is viewed when any of these holds:

- a facade connection has a session on it. The desktop attaches only the chat on screen, a workspace tab or a task row. Mobile attaches what it shows.
- an event socket subscribes to it.
- an orchestration wait (`chat_wait`, a task wait, the external MCP wait) is watching it.

Viewing counts as use. A chat the user just left therefore waits the whole idle time before it is released. Subscribing, unsubscribing, `session_detach` and a closing connection each restart the idle clock, so a view shorter than one scan still counts, and so does a history read answered from memory.

**Chats that keep their history.** A chat is never released while any of these holds:

- it is working, or a prompt or turn is in flight;
- it has a pending permission or gate;
- it has a queued prompt, a held maintenance prompt or an agent outbox entry;
- it has a delegated task on either side, an active child chat, or a live background task;
- its CLI or session process is alive;
- idle compaction is on and the chat may still be compacted (its last run has not been claimed, and the provider's cache window has not passed);
- a client is viewing it;
- the transcript cannot give its history back: a temporary or ephemeral chat, a missing transcript, a chat with no session to read, a fork that has not sent yet, or a composed history that loaded with a segment missing (a restore would refuse it, so releasing it would leave the chat unreadable).

The scanner selects candidates. `ChatRelease` checks each rule again under the offload claim. Loads, starts, sends, interrupts and history reads exclude that claim, so a chat that wakes up between the two checks stays.

Every use advances the chat's activity generation, under the same cache lock the release clears the history with. The release reads the generation before its checks and clears nothing if it moved, so even a view that starts and ends while the checks run keeps the history.

### The idle offload

The two-hour offload is unchanged, except that it now also tells the chat surface. The hub then drops the chat's revision log. This was the one copy the offload used to leave behind.

### The revision log and reconnects

Both the release and the offload tell the hub while they still hold the offload claim, so a resume reads the history only after the hub has acted. The hub drops the log only when no connection has a session on the chat, deciding under the registry lock that a resume takes its log through:

- A reconnect that attached first keeps the log, and the cursor it was given stays valid.
- A reconnect after the drop gets a new log under a new epoch. A cursor from before the release names an unknown epoch and replays in full.

### Returning to a released chat

- **A view.** The chat's cell stays, but its history is marked released. The load path (`claim_load`) restores the history into the cell, through a stateless history session. Because a released chat has no live process, its first window may come from disk the way a first open does: a persisted tail or the adapter's pages. The windowed resume then completes the history in the background, and it resyncs only when the window it served differs.
- **One restore path.** Every restore of a released chat goes through the lifecycle's load claim, so a view, a send, a steer and a history read (`get_messages`) share one read. `get_messages` takes its own history claim only after rechecking, under the flight guards, that the chat is not released. A failed restore installs nothing, and nothing reads the history in its place. Every install also checks the chat's history epoch, which advances with every write: a read that began before another write keeps that newer history instead of installing its older list.
- **A restore installs only a complete history.** Every transcript the history needs must read successfully:
  - for a composed chat, every segment's native session;
  - for any chat, a read the adapter reports as an empty list must not have failed. Codex reports a failed app-server start or `thread/read` as `Ok([])` to its other callers, and says so through `last_history_read_failed`.

  Otherwise the chat stays released. A transcript that reads successfully as empty is installed, which ends the release.
- **A send, a steer or a process start.** These restore the history first. This covers a send, a resume that restarts a working chat, and an automation, all of which start the CLI through `start_chat`. If the restore fails, the chat stays released. A send or steer then stops with a retryable error ("This chat's history could not be reloaded. Try again."), never reaches the CLI, and is never dropped silently. A start begins no process.
- **An append that still reaches a released chat** is skipped and logged at warn, never stored as a partial list. Nothing is expected to produce one.
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

**Never.** Never is offered for users with memory to spare who switch between large chats and would rather not wait for reloads. It turns off the release only: the two-hour offload still frees the chat, and stops its CLI if one is running.
