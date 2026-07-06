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

function BoundedUserMessage() {
  return (
    <MessageRenderBoundary>
      <UserMessage />
    </MessageRenderBoundary>
  );
}

function BoundedAssistantMessage() {
  return (
    <MessageRenderBoundary>
      <AssistantMessage />
    </MessageRenderBoundary>
  );
}

function BoundedSystemMessage() {
  return (
    <MessageRenderBoundary>
      <SystemMessage />
    </MessageRenderBoundary>
  );
}

/** The `components` map for `ThreadPrimitive.Messages`. */
export const boundedMessageComponents = {
  UserMessage: BoundedUserMessage,
  AssistantMessage: BoundedAssistantMessage,
  SystemMessage: BoundedSystemMessage,
};
