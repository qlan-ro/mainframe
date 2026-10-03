/**
 * Mainframe's `_mainframe.dev` extension namespace (todo #350) — the
 * handshake/control slice: the namespace key, agent capabilities advertised
 * in `initialize`, and the rich permission answer that reuses today's
 * `ControlResponse` semantics. Everything else in the namespace (out-of-band
 * notification params, in-band message/turn payloads) lives in
 * `extensions-notifications.ts` and `extensions-payload.ts` — split along
 * that seam because the file crossed 300 lines (see those files' headers for
 * the shared extensibility-discipline rationale, ACP-EVALUATION.md "What to
 * borrow" #6). Mirrors `mainframe-types/src/acp/extensions.rs`.
 */
import { z } from 'zod';
import type { ControlResponse } from '../adapter.js';
import { EXECUTION_MODES } from '../settings.js';

/** The `_meta` key every extension value below is namespaced under. */
export const MAINFRAME_META_NAMESPACE = '_mainframe.dev';

// `adapter.ts` has no Zod schema for `ControlResponse` to import — this
// mirrors it field-for-field (single-canonical-*type* rule; a validation
// schema is not the type) so the rich permission answer can be validated.
const ControlDestinationSchema = z.enum(['userSettings', 'projectSettings', 'localSettings', 'session', 'cliArg']);
const RuleBehaviorSchema = z.enum(['allow', 'deny', 'ask']);
const PermissionModeSchema = z.enum([...EXECUTION_MODES, 'plan']);
const ControlRuleSchema = z.object({ toolName: z.string(), ruleContent: z.string().optional() }).loose();
const ControlUpdateSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('addRules'),
      rules: z.array(ControlRuleSchema),
      behavior: RuleBehaviorSchema,
      destination: ControlDestinationSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('replaceRules'),
      rules: z.array(ControlRuleSchema),
      behavior: RuleBehaviorSchema,
      destination: ControlDestinationSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('removeRules'),
      rules: z.array(ControlRuleSchema),
      behavior: RuleBehaviorSchema,
      destination: ControlDestinationSchema,
    })
    .loose(),
  z.object({ type: z.literal('setMode'), mode: PermissionModeSchema, destination: ControlDestinationSchema }).loose(),
  z
    .object({
      type: z.literal('addDirectories'),
      directories: z.array(z.string()),
      destination: ControlDestinationSchema,
    })
    .loose(),
  z
    .object({
      type: z.literal('removeDirectories'),
      directories: z.array(z.string()),
      destination: ControlDestinationSchema,
    })
    .loose(),
]);
const ControlResponseSchema: z.ZodType<ControlResponse> = z
  .object({
    requestId: z.string(),
    toolUseId: z.string(),
    toolName: z.string().optional(),
    behavior: z.enum(['allow', 'deny']),
    updatedInput: z.record(z.string(), z.unknown()).optional(),
    updatedPermissions: z.array(ControlUpdateSchema).optional(),
    message: z.string().optional(),
    executionMode: z.enum(EXECUTION_MODES).optional(),
    clearContext: z.boolean().optional(),
  })
  .loose();

/**
 * Mainframe's agent-capabilities extension, advertised in `initialize`'s
 * response under `_meta["_mainframe.dev"]`.
 */
export const MainframeCapabilitiesSchema = z
  .object({
    richPermissionAnswers: z.boolean().optional(),
    queuedPrompts: z.boolean().optional(),
    retryMarkers: z.boolean().optional(),
    heartbeatIntervalMs: z.number().int().nonnegative().optional(),
    /**
     * Whether `create_update` stamps `ITEM_CREATED_META_KEY` on an item's
     * complete first frame (spec Decision 37) — a client gates its strict
     * accumulator mode on this rather than assuming it.
     */
    itemCreationMarkers: z.boolean().optional(),
    /**
     * Whether every successful `session/resume` reply is followed by
     * exactly one `_mainframe.dev/replay_complete` for that session (spec
     * Decision 38) — a client stages a full replay off-screen only when
     * this is advertised.
     */
    replayComplete: z.boolean().optional(),
    /**
     * Whether the daemon negotiates revision-versioned resume cursors
     * (todo #377): an opted-in connection's `session/resume` reply adds
     * `cursor` meta and is followed by `_mainframe.dev/cursor`
     * notifications after catch-up. A connection that does not opt in via
     * `REVISION_CURSORS_OPT_IN_KEY` keeps today's item-cursor-only wire
     * regardless of this flag.
     */
    revisionCursors: z.boolean().optional(),
  })
  .loose();
export type MainframeCapabilities = z.infer<typeof MainframeCapabilitiesSchema>;

/**
 * The `initialize` request `_meta["_mainframe.dev"]` key a client sets to
 * `true` to opt into revision-versioned resume cursors (todo #377). Absent
 * or `false` keeps the connection on item cursors only, byte-identical to
 * today, even when `MainframeCapabilities.revisionCursors` advertises
 * server support.
 */
export const REVISION_CURSORS_OPT_IN_KEY = 'revisionCursors';

/**
 * The replay boundary a revision-cursor `session/resume` reply returns and
 * the `_mainframe.dev/cursor` notification advances (todo #377). `epoch`
 * identifies the log generation — `transcript_cleared`, `resync`,
 * compaction, and a tool-call vanish each rotate it, which invalidates
 * every cursor from the prior epoch. `revision` is the daemon's monotonic
 * per-chat counter. Mirrors
 * `mainframe-types/src/acp/extensions.rs`'s `RevisionCursor`.
 */
export const RevisionCursorSchema = z
  .object({
    epoch: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .loose();
export type RevisionCursor = z.infer<typeof RevisionCursorSchema>;

/**
 * `ResumeSessionRequest.replayFrom`'s wire shape (todo #377) — opaque on
 * the vendored `ResumeSessionRequest` type by design (`session.ts`).
 * `start` always full-replays; `item` resumes after the named stable item
 * (legacy daemons and clients that have not negotiated revision cursors);
 * `revision` resumes from a server-issued `{epoch, revision}` boundary.
 * Moved here from `acp-client.ts` so the daemon-contract type and its
 * validator live together (single-canonical-type rule).
 */
export const ReplayCursorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('item'), itemId: z.string() }),
  z.object({ type: z.literal('revision'), epoch: z.string(), revision: z.number().int().nonnegative() }),
]);
export type ReplayCursor = z.infer<typeof ReplayCursorSchema>;

/**
 * The rich permission answer (spec decision 12): today's `ControlResponse`
 * semantics, reused verbatim per the single-canonical-type rule rather than
 * redefined for the facade.
 */
export const RichPermissionAnswerSchema: z.ZodType<{ controlResponse: ControlResponse }> = z
  .object({
    controlResponse: ControlResponseSchema,
  })
  .loose();
export type RichPermissionAnswer = z.infer<typeof RichPermissionAnswerSchema>;
