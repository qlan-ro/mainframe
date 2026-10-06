/**
 * "Fork from here" availability for one user message
 * (`docs/specs/2026-10-06-fork-from-message.md`, Behavior).
 *
 * The chat-level checks are the whole-chat Fork's (`forkBaseAvailability`).
 * A turn in flight does NOT disable this action: everything before a sent
 * message is already settled, so the cut can't move. The message adds its
 * own two checks, in the spec's order.
 */
import { FORK_ENABLED, forkBaseAvailability, type ForkAvailability, type ForkBaseInput } from './fork-availability';

export interface ForkFromMessageInput extends ForkBaseInput {
  /** Still sending or failed to send — the optimistic projection's `pending`/`error`. */
  messageUnsent: boolean;
  /** The chat's first user message has nothing before it to fork. */
  isFirstUserMessage: boolean;
}

export function forkFromMessageAvailability(input: ForkFromMessageInput): ForkAvailability {
  const base = forkBaseAvailability(input);
  if (!base.enabled) return base;
  if (input.messageUnsent) return { enabled: false, reason: "This message hasn't been sent yet" };
  if (input.isFirstUserMessage) return { enabled: false, reason: 'Nothing before this message to fork' };
  return FORK_ENABLED;
}
