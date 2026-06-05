'use client';

/**
 * User message — minimal bubble. The full "cool card" treatment (gradient +
 * tinted edge, quote blocks, attachments, read-more) is the msg-shell leaf.
 */
import { MessagePrimitive } from '@assistant-ui/react';

export function UserMessage() {
  return (
    <MessagePrimitive.Root data-testid="chat-user-message" className="flex justify-end py-2">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-xl border border-mf-um-edge bg-mf-um-card px-3 py-2 text-body text-foreground">
        <MessagePrimitive.Parts components={{ Text: ({ text }) => <span>{text}</span> }} />
      </div>
    </MessagePrimitive.Root>
  );
}
