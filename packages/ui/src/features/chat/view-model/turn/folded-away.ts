/**
 * The messages a folded turn draws nothing for: the plain transcript list leaves them out (#517, #518). Every other
 * message of a folded turn shows something (its work row, its answer, a marker or the footer). The virtualized list
 * keeps them as empty 1 px rows, which it needs to measure; on the plain list each cost a whole message subtree, and
 * a large chat held thousands of them, so an older page mounted them all in one long frame. Pure.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { hasTimeMarker } from '../time-markers';
import { messageMeta } from './turn-units';
import type { MessageSlice } from './types';

/** Draws nothing once its turn is folded. */
export const foldsAway = (slice: MessageSlice): boolean =>
  !slice.header && !slice.footer && !slice.hiddenPromptEvent && slice.markers.length === 0 && slice.answer.length === 0;

/**
 * Of `candidates` (message ids whose folded slice draws nothing), the ones the list may leave out: not a failed
 * message (it draws its error) and not one the transcript dates (a time marker sits above it). Ids joined by `\0`.
 */
export function leftOut(messages: readonly ThreadMessage[], candidates: ReadonlySet<string>): string {
  if (candidates.size === 0) return '';
  let ids = '';
  messages.forEach((message, index) => {
    if (!candidates.has(message.id) || messageMeta(message)?.errorText) return;
    if (hasTimeMarker(messages, index)) return;
    ids += `${message.id}\0`;
  });
  return ids;
}
