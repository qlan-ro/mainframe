/**
 * Stands in for `messages/turn/use-row-anchor`. v0 keeps today's anchor; the
 * other variants model #461, which deletes it and lets the browser (or the
 * library) hold the reader's place when a row opens or folds.
 */
import { useRef } from 'react';
import { useRowAnchor as todaysRowAnchor } from '@/features/chat/messages/turn/use-row-anchor';
import { params } from '../params';

function noRowAnchor(_open: boolean) {
  const rowRef = useRef<HTMLDivElement>(null);
  return { rowRef, beforeToggle: (_automatic?: boolean) => {} };
}

export const useRowAnchor = params.variant === 'v0' ? todaysRowAnchor : noRowAnchor;
