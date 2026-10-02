import type { ComponentType, ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
  type ToolCallMessagePart,
  type ThreadAssistantMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TranscriptScopeProvider } from '../transcript-scope';
import { CompactParts } from '../CompactParts';
import '../../../tools/register-cards';

export function fixtureTool(overrides: Partial<ToolCallMessagePart> = {}): ToolCallMessagePart {
  return {
    type: 'tool-call',
    toolCallId: 'read-a',
    toolName: 'Read',
    args: { file_path: '/src/a.ts' },
    argsText: '{"file_path":"/src/a.ts"}',
    result: 'const a = 1;',
    providerMetadata: { mainframe: { acpStatus: 'completed' } },
    ...overrides,
  };
}
export function fixtureMessage(
  content: ThreadAssistantMessage['content'],
  id = 'message',
  running = false,
): ThreadAssistantMessage {
  return {
    id,
    role: 'assistant',
    createdAt: new Date(0),
    content,
    status: running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
  };
}
export function CompactFixture({
  messages,
  rootId = 'fixture-root',
  pendingToolIds = [],
  Message = CompactParts,
  children,
  extras,
}: {
  messages: ThreadMessage[];
  rootId?: string;
  pendingToolIds?: string[];
  Message?: ComponentType;
  children?: ReactNode;
  extras?: unknown;
}) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    extras,
    isRunning: messages.some((message) => message.status?.type === 'running'),
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TranscriptScopeProvider
          value={{
            rootThreadId: rootId,
            chatId: 'chat-fixture',
            ancestors: [],
            pendingToolIds: new Set(pendingToolIds),
          }}
        >
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Viewport
              data-testid="fixture-viewport"
              style={{ height: 600, overflowY: 'auto', containerType: 'size' }}
            >
              <ThreadPrimitive.Messages components={{ AssistantMessage: Message, UserMessage: () => null }} />
              {children}
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </TranscriptScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
