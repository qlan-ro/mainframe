/**
 * "Fork from here" availability for one user message
 * (`docs/specs/2026-10-06-fork-from-message.md`, Behavior and Compatibility).
 *
 * The chat-level checks are the whole-chat Fork's (`forkBaseAvailability`).
 * A turn in flight does NOT disable this action: everything before a sent
 * message is already settled, so the cut can't move. The message adds its
 * own checks, in the spec's order. A chat that switched providers forks only
 * inside its latest segment, after that segment's first message (it carries
 * the handoff) — the daemon refuses the rest with the same copy.
 */
import type { ProviderSwitchMarker } from '@qlan-ro/mainframe-types';
import { FORK_ENABLED, forkBaseAvailability, type ForkAvailability, type ForkBaseInput } from './fork-availability';

/** The divider that opened the chat's latest segment. */
export type LatestSegmentStart = Pick<ProviderSwitchMarker, 'kind' | 'toAdapterName'>;

export interface ForkFromMessageInput extends ForkBaseInput {
  /** Still sending or failed to send — the optimistic projection's `pending`/`error`. */
  messageUnsent: boolean;
  /** The chat's first user message has nothing before it to fork. */
  isFirstUserMessage: boolean;
  /** Set when the message lies before the latest segment's divider, or is
   *  that segment's first user message. */
  beforeLatestSegment?: LatestSegmentStart | null;
}

export function forkFromMessageAvailability(input: ForkFromMessageInput): ForkAvailability {
  const base = forkBaseAvailability(input);
  if (!base.enabled) return base;
  if (input.messageUnsent) return { enabled: false, reason: "This message hasn't been sent yet" };
  if (input.isFirstUserMessage) return { enabled: false, reason: 'Nothing before this message to fork' };
  if (input.beforeLatestSegment) return { enabled: false, reason: beforeSegmentReason(input.beforeLatestSegment) };
  return FORK_ENABLED;
}

function beforeSegmentReason(start: LatestSegmentStart): string {
  if (start.kind === 'context_reset') return "Can't fork from before this chat's context was cleared";
  return `Can't fork from before the switch to ${start.toAdapterName}`;
}

/** The slice of a thread message this check reads. */
export interface SegmentedMessage {
  readonly id: string;
  readonly role: string;
  readonly metadata?: { readonly custom?: { readonly mainframe?: { readonly providerSwitch?: ProviderSwitchMarker } } };
}

/** The latest divider's marker when `messageId` lies before it or is the
 *  first user message after it; `null` otherwise (and for a chat that never
 *  switched). Returns the store's own marker object, so it is a stable
 *  selection. */
export function latestSegmentBlock(
  messages: readonly SegmentedMessage[],
  messageId: string,
): ProviderSwitchMarker | null {
  let latest = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.metadata?.custom?.mainframe?.providerSwitch) {
      latest = i;
      break;
    }
  }
  if (latest < 0) return null;
  const marker = messages[latest]?.metadata?.custom?.mainframe?.providerSwitch ?? null;
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) return null;
  if (index < latest) return marker;
  const opener = messages.slice(latest + 1).find((m) => m.role === 'user');
  return opener?.id === messageId ? marker : null;
}
