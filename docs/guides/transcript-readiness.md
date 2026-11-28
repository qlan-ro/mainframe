# Transcript readiness

Viewing a chat waits for history and pending permissions to be restored. Metadata discovery and provider startup can finish after the transcript is visible.

## POST /api/chats/{id}/resume

| Query | Response boundary |
| --- | --- |
| Omitted | Existing full lifecycle resume, including metadata work and any required provider restart |
| `waitFor=transcript` | History, pending permissions and restoration resync are ready; the remaining lifecycle work continues in the daemon |
| `waitFor=transcript&initialWindow=true` | As above, except it returns at once when the next windowed `session/resume` can answer its first window without the whole history (see below) |

Both modes return the normal success envelope without a response body payload. Unknown chats return 404. An unsupported `waitFor` value returns 400.

An older daemon ignores the query and retains its full lifecycle wait. The desktop can therefore request transcript readiness without an extra capability handshake or a failed endpoint probe.

## Opens that skip the restore

With `initialWindow=true` the request does not restore the history first when the first window can come from:

- a persisted transcript tail that still validates, or
- the adapter's newest pages (Claude reads the end of the transcript, Codex asks `thread/turns/list`): the chat is idle, nothing of it is in memory and no current history snapshot exists. A stale snapshot (left by an update or by a turn the daemon never saw) counts as none; its fingerprint is read from the start of the file.

The windowed `session/resume` then answers from the tail or the pages and completes the history in the background (`complete_history`). The full load compares its tail with the window it served and sends a resync only when they differ, or when it restores a pending permission, which a window read from pages never carries. After a reply from pages, the loaded history is stored as the chat's persisted tail, so the next start hits it. When the adapter declines to page (a short Claude transcript, for one), the resume reads the whole history itself, as before.

Restoring first would fill the history before the resume arrives, so neither faster path could answer. The provider resume that the full warm-up runs in the background does nothing for these chats: it restarts only a chat left working, and a working chat never takes these paths.

## Persisted tails after an update

A tail validates only for the exact first-window request it was written for (`{"turns": 10}` by default) and for the history fingerprint it was written under. The fingerprint holds the daemon version and the snapshot format, so the first start after a released update misses every tail and every snapshot whatever the window. A changed window (another `historyTurns` value, or a build that changed the default) misses the same way. This is expected: the miss writes a new tail and the next start hits. The miss opens from a current snapshot when one exists, otherwise through the adapter's pages, not a whole-transcript parse.

## Ordering

1. Wait for an in-flight offload, then claim the shared chat load.
2. Load and compose history, restore pending permissions, and publish any restoration resync.
3. Release transcript readers and the `waitFor=transcript` response.
4. Complete worktree baseline discovery and metadata scans while retaining the full load claim.
5. Continue any required provider resume only if the same chat/session is still active, then publish chat and todo state. Closed chats still publish their persisted state.

The desktop starts ACP replay after step 3. ACP's awaiting-seed buffering, revision cursors, permission replay and history paging protocol keep their existing ordering.

Concurrent requests share restoration. A cached revisit does not reload history. An interrupted restoration removes its own partial active cell so the next request can retry. Offload remains excluded while the full load is running. Worktree baseline results from before teardown or a binding change cannot recreate forgotten state.

## Measurement

Measure the cold REST readiness response, ACP replay and first visible message separately, alongside the complete click-to-visible interval. Compare full lifecycle and transcript-ready waits against the same immutable transcript in separate cold daemon runs. Warm cache measurements must be reported separately.

This separates viewing from session warmup; it does not remove the necessary disk read on a cold open. The history window's container size is a separate limit and can still contain many tool operations.
