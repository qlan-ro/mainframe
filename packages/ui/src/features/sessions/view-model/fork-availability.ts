/**
 * Fork-availability view-model (todo #343).
 *
 * The Fork action is enabled only when every check in the spec's Behavior
 * list passes, checked in that exact order — the first failing reason is what
 * a disabled menu item's `Hint` shows. Pure and side-effect-free: the caller
 * resolves the adapter and the chat's own fields (`SessionCustom`) and decides
 * how to render `reason` (a disabled `ContextMenuItem` wrapped in `Hint`).
 *
 * `forkBaseAvailability` holds the checks every fork shares; the whole-chat
 * Fork adds the turn-in-flight refusal, and "Fork from here" adds its message
 * rules (`fork-from-message-availability.ts`).
 */

export type ForkAvailability = { enabled: true } | { enabled: false; reason: string };

export const FORK_ENABLED: ForkAvailability = { enabled: true };

/** The chat-level facts every fork checks, whatever its fork point. */
export interface ForkBaseInput {
  /** `AdapterInfo.capabilities.fork` — absent/false both mean "can't fork". */
  capabilityFork: boolean;
  /** `AdapterInfo.name` — the disabled reason names the adapter, never its id. */
  adapterName: string;
  /**
   * `AdapterInfo.forkUnavailableReason` (todo #368) — a version-specific reason
   * (e.g. "needs Codex CLI 0.143.0 or newer") shown instead of the generic
   * no-capability copy when `capabilityFork` is false and this is present.
   * Ignored when `capabilityFork` is true.
   */
  capabilityReason?: string;
  /** A temporary chat has no vendor transcript to branch from (todo #346). */
  temporary: boolean;
  /** A no-project chat has no project checkout for the fork to run in (todo #346). */
  noProject: boolean;
  /** The chat's own provider session id (`SessionCustom.claudeSessionId`). Absent means nothing has run yet. */
  claudeSessionId?: string;
  transcriptMissing: boolean;
  directoryMissing: boolean;
}

export interface ForkAvailabilityInput extends ForkBaseInput {
  /**
   * The main turn only — NEVER `displayStatus === 'working'` alone, which
   * live background tasks also set. A chat with background tasks but no main
   * turn running is still forkable (spec edge case).
   */
  isRunning: boolean;
  /** A pending permission or question — `displayStatus === 'waiting'`. */
  hasPending: boolean;
}

const disabled = (reason: string): ForkAvailability => ({ enabled: false, reason });

/** The shared checks, in the spec's order. */
export function forkBaseAvailability(input: ForkBaseInput): ForkAvailability {
  if (!input.capabilityFork) {
    return disabled(input.capabilityReason ?? `Forking isn't available for ${input.adapterName} chats yet`);
  }
  if (input.temporary) return disabled("Temporary chats can't be forked");
  if (input.noProject) return disabled("Chats with no project can't be forked");
  if (input.claudeSessionId == null) return disabled('Nothing to fork yet');
  if (input.transcriptMissing) return disabled("This chat's transcript is missing");
  if (input.directoryMissing) return disabled("This chat's folder is missing");
  return FORK_ENABLED;
}

/** The spec's exact Behavior-list copy, in the spec's exact order. */
export function forkAvailability(input: ForkAvailabilityInput): ForkAvailability {
  const base = forkBaseAvailability(input);
  if (!base.enabled) return base;
  if (input.isRunning || input.hasPending) {
    return disabled('Wait for the current turn to finish or interrupt it');
  }
  return FORK_ENABLED;
}
