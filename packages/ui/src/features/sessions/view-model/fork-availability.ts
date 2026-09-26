/**
 * Fork-availability view-model (todo #343).
 *
 * The Fork action is enabled only when every check in the spec's Behavior
 * list passes, checked in that exact order — the first failing reason is what
 * a disabled menu item's `Hint` shows. Pure and side-effect-free: the caller
 * resolves the adapter and the chat's own fields (`SessionCustom`) and decides
 * how to render `reason` (a disabled `ContextMenuItem` wrapped in `Hint`).
 */

export type ForkAvailability = { enabled: true } | { enabled: false; reason: string };

export interface ForkAvailabilityInput {
  /** `AdapterInfo.capabilities.fork` — absent/false both mean "can't fork". */
  capabilityFork: boolean;
  /** `AdapterInfo.name` — the disabled reason names the adapter, never its id. */
  adapterName: string;
  /** The chat's own provider session id (`SessionCustom.claudeSessionId`). Absent means nothing has run yet. */
  claudeSessionId?: string;
  transcriptMissing: boolean;
  directoryMissing: boolean;
  /**
   * The main turn only — NEVER `displayStatus === 'working'` alone, which
   * live background tasks also set. A chat with background tasks but no main
   * turn running is still forkable (spec edge case).
   */
  isRunning: boolean;
  /** A pending permission or question — `displayStatus === 'waiting'`. */
  hasPending: boolean;
}

/** The spec's exact Behavior-list copy, in the spec's exact order. */
export function forkAvailability(input: ForkAvailabilityInput): ForkAvailability {
  if (!input.capabilityFork) {
    return { enabled: false, reason: `Forking isn't available for ${input.adapterName} chats yet` };
  }
  if (input.claudeSessionId == null) {
    return { enabled: false, reason: 'Nothing to fork yet' };
  }
  if (input.transcriptMissing) {
    return { enabled: false, reason: "This chat's transcript is missing" };
  }
  if (input.directoryMissing) {
    return { enabled: false, reason: "This chat's folder is missing" };
  }
  if (input.isRunning || input.hasPending) {
    return { enabled: false, reason: 'Wait for the current turn to finish or interrupt it' };
  }
  return { enabled: true };
}
