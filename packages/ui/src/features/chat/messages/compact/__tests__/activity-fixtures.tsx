import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  AuiConfig,
  AuiProvider,
  ExternalThread,
  ThreadPrimitive,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TranscriptScopeProvider } from '../transcript-scope';
import { CompactParts } from '../CompactParts';
import { CompactActivityGroup } from '../CompactActivityGroup';
import type { ActivityGroup } from '../../../view-model/compact/types';
import '../../../tools/register-cards';

interface Props {
  messages: ThreadMessage[];
  rootId: string;
  split?: boolean;
  group?: ActivityGroup;
}
function Surface({ rootId, group }: Props) {
  const scope = useMemo(
    () => ({ rootThreadId: rootId, chatId: 'chat-fixture', ancestors: [], pendingToolIds: new Set<string>() }),
    [rootId],
  );
  return (
    <TooltipProvider>
      <TranscriptScopeProvider value={scope}>
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Viewport>
            {group ? (
              <CompactActivityGroup group={group} />
            ) : (
              <ThreadPrimitive.Messages components={{ AssistantMessage: CompactParts, UserMessage: () => null }} />
            )}
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </TranscriptScopeProvider>
    </TooltipProvider>
  );
}
function Split(props: Props) {
  const aui = useAui();
  const config = useMemo(
    () => AuiConfig({ thread: ExternalThread({ messages: props.messages, isRunning: false, onNew: async () => {} }) }),
    [props.messages],
  );
  return (
    <AuiProvider extends={aui} config={config}>
      <Surface {...props} />
    </AuiProvider>
  );
}
export function ActivityFixture(props: Props) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: props.split ? [] : props.messages,
    isRunning: false,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {props.split ? <Split {...props} /> : <Surface {...props} />}
    </AssistantRuntimeProvider>
  );
}
