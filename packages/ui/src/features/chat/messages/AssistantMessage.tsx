/** An assistant message that isn't part of a turn's work: the error a turn ended on. */
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { useMainframeMeta } from '../view-model/message-meta';
import { AssistantErrorBlock } from './AssistantErrorBlock';

export function AssistantMessage() {
  const { errorText } = useMainframeMeta();
  const messageId = useAuiState((s) => s.message.id);
  if (!errorText) return null;
  return (
    <MessagePrimitive.Root data-testid="chat-assistant-message" data-message-id={messageId} className="py-2">
      <AssistantErrorBlock text={errorText} />
    </MessagePrimitive.Root>
  );
}
