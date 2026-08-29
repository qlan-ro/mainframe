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
