import { ReadonlyThreadProvider, ThreadPrimitive, type ThreadMessage } from '@assistant-ui/react';
import { boundedMessageComponents } from '../../messages/bounded-messages';
import { NestedTranscriptProvider } from '../../messages/nested-transcript-context';
import { NestedTranscriptScope } from '../../messages/compact/transcript-scope';
import { CompactDetailProvider } from '../shared/compact-detail-context';

export function SubagentTranscript({
  messages,
  messageId,
  toolCallId,
}: {
  messages: readonly ThreadMessage[];
  messageId: string;
  toolCallId: string;
}) {
  return (
    <div className="ml-[12px] min-w-0 border-l-2 border-border pl-3.5">
      <NestedTranscriptScope messageId={messageId} toolCallId={toolCallId}>
        <CompactDetailProvider value={false}>
          <NestedTranscriptProvider>
            <ReadonlyThreadProvider messages={messages}>
              <ThreadPrimitive.Messages components={boundedMessageComponents} />
            </ReadonlyThreadProvider>
          </NestedTranscriptProvider>
        </CompactDetailProvider>
      </NestedTranscriptScope>
    </div>
  );
}
