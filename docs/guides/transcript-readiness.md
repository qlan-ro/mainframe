# Transcript readiness

Viewing a chat waits for history and pending permissions to be restored. Metadata discovery and provider startup can finish after the transcript is visible.

## POST /api/chats/{id}/resume

| Query | Response boundary |
| --- | --- |
| Omitted | Existing full lifecycle resume, including metadata work and any required provider restart |
| `waitFor=transcript` | History, pending permissions and restoration resync are ready; the remaining lifecycle work continues in the daemon |

Both modes return the normal success envelope without a response body payload. Unknown chats return 404. An unsupported `waitFor` value returns 400.

An older daemon ignores the query and retains its full lifecycle wait. The desktop can therefore request transcript readiness without an extra capability handshake or a failed endpoint probe.

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
