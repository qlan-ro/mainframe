/**
 * Mainframe's `_mainframe.dev` extension namespace (todo #350) — params for
 * the daemon's custom out-of-band notifications (as opposed to payloads
 * riding an in-band message/turn `_meta`, which live in
 * `extensions-payload.ts`). Split out of `extensions.ts` once that file
 * crossed 300 lines; see its header for the shared extensibility-discipline
 * rationale. Mirrors `mainframe-types/src/acp/extensions.rs`.
 */
import { z } from 'zod';

/** A queued prompt's ref — mirrors `QueuedMessageRef` (chat.ts) on the facade wire. */
export const QueuedRefSchema = z
  .object({
    messageId: z.string(),
    chatId: z.string(),
    uuid: z.string(),
    content: z.string(),
    attachmentIds: z.array(z.string()).optional(),
    timestamp: z.string(),
  })
  .loose();

/**
 * `_mainframe.dev/queue_state`'s params: the FULL queued-prompt snapshot for
 * a session, pushed on every queue change and after each resume — a snapshot,
 * never a delta, so a reconnecting client cannot hold stale queued turns.
 */
export const QueueStateParamsSchema = z
  .object({
    sessionId: z.string(),
    refs: z.array(QueuedRefSchema),
  })
  .loose();
export type QueueStateParams = z.infer<typeof QueueStateParamsSchema>;

/**
 * `_mainframe.dev/transcript_cleared`'s params: the server wiped the
 * session's transcript (plan-mode clear-context) — re-resume to converge.
 */
export const TranscriptClearedParamsSchema = z
  .object({
    sessionId: z.string(),
  })
  .loose();
export type TranscriptClearedParams = z.infer<typeof TranscriptClearedParamsSchema>;

/**
 * `_mainframe.dev/compaction`'s params: live compaction progress
 * (`chat.compacting`/`chat.compactDone`'s facade successor). The durable
 * transcript marker rides `ItemMeta.isCompacted`; this drives the in-flight
 * indicator only.
 */
export const CompactionParamsSchema = z
  .object({
    sessionId: z.string(),
    phase: z.enum(['started', 'done']),
  })
  .loose();
export type CompactionParams = z.infer<typeof CompactionParamsSchema>;

/**
 * `_mainframe.dev/session_detach`'s params: the client is dropping this
 * session's live stream (D2 — façade attachment follows the active
 * thread). The daemon forgets the session's stream state and any pending
 * gates for it on this connection; switching back re-attaches through
 * `session/resume`.
 */
export const SessionDetachParamsSchema = z
  .object({
    sessionId: z.string(),
  })
  .loose();
export type SessionDetachParams = z.infer<typeof SessionDetachParamsSchema>;

/**
 * `_mainframe.dev/resync`'s params: the chat's cache was rebuilt from the
 * transcript under ids an attached session may not hold (spec Decision 34,
 * rewritten). Raised when `do_load_chat` repopulates the cache and the
 * result differs from what was there, or when a resume delivery fails after
 * its reply (at most once per failure streak). Cache retention alone never
 * raises it. Distinct from `transcript_cleared`: the handler calls
 * `reattach()` with no reducer wipe.
 */
export const ResyncParamsSchema = z
  .object({
    sessionId: z.string(),
  })
  .loose();
export type ResyncParams = z.infer<typeof ResyncParamsSchema>;

/**
 * `_mainframe.dev/replay_complete`'s params: closes exactly one
 * `session/resume` replay (spec Decision 38). Sent after `queue_state` and
 * before the buffered catch-up, in every arm that sent a successful reply.
 * `aborted` is present and `true` only when a resume delivery failed after
 * its reply went out; a normal close carries no `aborted` key at all.
 */
export const ReplayCompleteParamsSchema = z
  .object({
    sessionId: z.string(),
    aborted: z.boolean().optional(),
  })
  .loose();
export type ReplayCompleteParams = z.infer<typeof ReplayCompleteParamsSchema>;

/** The one `encoding` `ReplayBatchParams` ships today: standard base64 of a zlib-deflated JSON array of `SessionUpdate`s. */
export const REPLAY_BATCH_ENCODING = 'deflate+base64';

/**
 * `_mainframe.dev/replay_batch`'s params (spec Decision 42): one slice of a
 * `session/resume` replay for a connection that opted in with
 * `COMPRESSED_REPLAY_OPT_IN_KEY`. `count` is the number of `session/update`
 * payloads inside `data`, in replay order; batches for one reply arrive in
 * order and all precede the reply's gate, `queue_state` and
 * `replay_complete`. A client that cannot decode `encoding` must treat the
 * replay as failed, never apply a partial batch.
 */
export const ReplayBatchParamsSchema = z
  .object({
    sessionId: z.string(),
    encoding: z.string(),
    count: z.number().int().nonnegative(),
    data: z.string(),
  })
  .loose();
export type ReplayBatchParams = z.infer<typeof ReplayBatchParamsSchema>;

/**
 * Params for the daemon's custom `_mainframe.dev/heartbeat` notification
 * (spec decision 13). `sequence` lets a client detect a gap and resume
 * instead of heuristically refetching.
 */
export const HeartbeatParamsSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
  })
  .loose();
export type HeartbeatParams = z.infer<typeof HeartbeatParamsSchema>;

/**
 * Params for the daemon's custom `_mainframe.dev/gate_resolved` notification
 * (spec decision 19): pushed to every attached connection still holding the
 * gate when it resolves elsewhere, so a pending gate clears immediately
 * instead of on the next resume. `requestId` is the JSON-RPC id the gate's
 * `session/request_permission` traveled under (`gate-{id}`).
 */
export const GateResolvedParamsSchema = z
  .object({
    sessionId: z.string(),
    requestId: z.string(),
  })
  .loose();
export type GateResolvedParams = z.infer<typeof GateResolvedParamsSchema>;

/**
 * `_mainframe.dev/cursor`'s params (todo #377): the replay boundary a
 * reconnecting client now holds every change through. Rides the
 * per-session throttle FIFO after the frames of the display revision it
 * describes, so receiving it means the client holds every change up to
 * and including `revision`. Sent only to connections that opted into
 * revision cursors via `REVISION_CURSORS_OPT_IN_KEY` (`extensions.ts`).
 */
export const CursorParamsSchema = z
  .object({
    sessionId: z.string(),
    epoch: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .loose();
export type CursorParams = z.infer<typeof CursorParamsSchema>;
