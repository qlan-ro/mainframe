import { lazy, Suspense, useMemo } from 'react';
import { MessagePrimitive, useAuiState } from '@assistant-ui/react';
import { Message, MessageContent, MessageFooter } from '@/components/ui/message';
import { useUiPrefs } from '@/store/ui-prefs';
import { useMainframeMeta } from '../view-model/message-meta';
import { MessageActionBar } from './MessageActionBar';
import { MessageTiming } from './MessageTiming';
import { MessageTimestamp } from './MessageTimestamp';
import { AssistantErrorBlock } from './AssistantErrorBlock';
import { MessagePathContextMenu } from './MessagePathContextMenu';
import { useIsNestedTranscript } from './nested-transcript-context';
import { VerboseParts } from './VerboseParts';
import { TranscriptScopeProvider, useTranscriptScope } from './compact/transcript-scope';

const CompactParts = lazy(() => import('./compact/CompactParts').then((module) => ({ default: module.CompactParts })));

export function AssistantMessage() {
  const meta = useMainframeMeta();
  const messageId = useAuiState((s) => s.message.id);
  const isNested = useIsNestedTranscript();
  const mode = useUiPrefs((s) => s.transcriptMode);
  const scope = useTranscriptScope();
  const messageScope = useMemo(() => ({ ...scope, messageId }), [scope, messageId]);
  const parts =
    mode === 'compact' ? (
      <Suspense fallback={null}>
        <CompactParts />
      </Suspense>
    ) : (
      <VerboseParts />
    );
  return (
    <TranscriptScopeProvider value={messageScope}>
      <MessagePrimitive.Root data-testid="chat-assistant-message" data-message-id={messageId} className="py-2">
        <Message>
          <MessageContent>
            {meta.errorText ? (
              <AssistantErrorBlock text={meta.errorText} />
            ) : (
              <>
                {isNested ? parts : <MessagePathContextMenu>{parts}</MessagePathContextMenu>}
                <MessageFooter className="min-h-6 gap-2 px-0">
                  <MessageActionBar />
                  <MessageTimestamp />
                  <MessageTiming />
                </MessageFooter>
              </>
            )}
          </MessageContent>
        </Message>
      </MessagePrimitive.Root>
    </TranscriptScopeProvider>
  );
}
