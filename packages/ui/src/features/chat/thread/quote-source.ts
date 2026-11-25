/** Where a quote is from, as its block in the composer says it (C14). */
import type { ThreadMessage } from '@assistant-ui/react';

function when(date: Date, now: Date): string {
  const clock = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return ` at ${clock}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `, ${day} at ${clock}`;
}

type QuotedMessage = Pick<ThreadMessage, 'role'> & { createdAt?: Date };

export function quoteSource({ role, createdAt }: QuotedMessage, now: Date = new Date()): string {
  const from = role === 'user' ? 'From your message' : 'From the reply';
  return createdAt ? `${from}${when(createdAt, now)}` : from;
}

/** The message a selection starts in. */
export function selectedMessageId(selection: Selection | null): string | undefined {
  const node = selection?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>('[data-message-id]')?.dataset.messageId;
}
