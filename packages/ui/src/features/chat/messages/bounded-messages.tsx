/**
 * Role message components wrapped in a per-message error boundary, ready to
 * drop into `ThreadPrimitive.Messages`'s `components` map. Both the main thread
 * (ChatThread) and subagent transcripts (TaskCard) use this shared map so a
 * single message render failure can't take down the surrounding thread.
 */
import { MessageRenderBoundary } from './MessageRenderBoundary';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { SystemMessage } from './SystemMessage';
import { useAuiState } from '@assistant-ui/react';
import type { ReactNode } from 'react';
import { DisclosureScope } from '@/components/ui/disclosure-state';

function MessageScope({ children }: { children: ReactNode }) {
  const id = useAuiState((state) => state.message.id);
  return <DisclosureScope id={id}>{children}</DisclosureScope>;
}

function BoundedUserMessage() {
  return (
    <MessageRenderBoundary>
      <MessageScope>
        <UserMessage />
      </MessageScope>
    </MessageRenderBoundary>
  );
}

function BoundedAssistantMessage() {
  return (
    <MessageRenderBoundary>
      <MessageScope>
        <AssistantMessage />
      </MessageScope>
    </MessageRenderBoundary>
  );
}

function BoundedSystemMessage() {
  return (
    <MessageRenderBoundary>
      <MessageScope>
        <SystemMessage />
      </MessageScope>
    </MessageRenderBoundary>
  );
}

/** The `components` map for `ThreadPrimitive.Messages`. */
export const boundedMessageComponents = {
  UserMessage: BoundedUserMessage,
  AssistantMessage: BoundedAssistantMessage,
  SystemMessage: BoundedSystemMessage,
};
