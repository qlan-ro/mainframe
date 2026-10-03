import { lazy, Suspense } from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import { ReadonlyThreadProvider, ThreadPrimitive, type ThreadMessage } from '@assistant-ui/react';
import { boundedMessageComponents } from '../../messages/bounded-messages';
import { NestedTranscriptProvider } from '../../messages/nested-transcript-context';
import { NestedTranscriptScope } from '../../messages/compact/transcript-scope';
import { CompactDetailProvider } from '../shared/compact-detail-context';

const CompactTranscript = lazy(() =>
  import('../../messages/compact/CompactTranscript').then((module) => ({ default: module.CompactTranscript })),
);

export function SubagentTranscript({
  messages,
  messageId,
  toolCallId,
}: {
  messages: readonly ThreadMessage[];
  messageId: string;
  toolCallId: string;
}) {
  const mode = useUiPrefs((state) => state.transcriptMode);
  return (
    <div className="ml-[12px] min-w-0 border-l-2 border-border pl-3.5">
      <NestedTranscriptScope messageId={messageId} toolCallId={toolCallId}>
        <CompactDetailProvider value={false}>
          <NestedTranscriptProvider>
            <ReadonlyThreadProvider messages={messages}>
              {mode === 'compact' ? (
                <Suspense fallback={null}>
                  <CompactTranscript />
                </Suspense>
              ) : (
                <ThreadPrimitive.Messages components={boundedMessageComponents} />
              )}
            </ReadonlyThreadProvider>
          </NestedTranscriptProvider>
        </CompactDetailProvider>
      </NestedTranscriptScope>
    </div>
  );
}
