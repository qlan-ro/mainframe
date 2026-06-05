'use client';

/**
 * System message — minimal muted line. CompactionPill / skill markers are a
 * later leaf; this just surfaces system text without breaking the thread.
 */
import { MessagePrimitive } from '@assistant-ui/react';

export function SystemMessage() {
  return (
    <MessagePrimitive.Root data-testid="chat-system-message" className="py-1">
      <div className="text-caption text-muted-foreground">
        <MessagePrimitive.Parts components={{ Text: ({ text }) => <span>{text}</span> }} />
      </div>
    </MessagePrimitive.Root>
  );
}
