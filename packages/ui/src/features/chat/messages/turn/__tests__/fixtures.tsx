import { useMemo, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadAssistantMessage,
  type ThreadMessage,
  type ToolCallMessagePart,
} from '@assistant-ui/react';
import type { TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TranscriptScrollProvider, type TranscriptScrollController } from '../../../thread/transcript-scroll-context';
import { TranscriptScopeProvider } from '../transcript-scope';
import { TurnTranscript } from '../TurnTranscript';

export function tool(overrides: Partial<ToolCallMessagePart> = {}): ToolCallMessagePart {
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
export const bash = (toolCallId: string, command: string, overrides: Partial<ToolCallMessagePart> = {}) =>
  tool({ toolCallId, toolName: 'Bash', args: { command }, result: 'done', ...overrides });
export const running = { result: undefined, providerMetadata: { mainframe: { acpStatus: 'in_progress' } } } as const;
export const failed = {
  isError: true,
  result: 'Exit code 1\nboom',
  providerMetadata: { mainframe: { acpStatus: 'failed' } },
} as const;

export const text = (value: string) => ({ type: 'text', text: value }) as const;

export function assistant(
  content: ThreadAssistantMessage['content'],
  id = 'message',
  options: { running?: boolean; presentation?: Partial<TranscriptPresentation>; custom?: object; timing?: number } = {},
): ThreadAssistantMessage {
  const presentation = options.presentation && {
    version: 1,
    provider: 'claude',
    turnId: 'turn',
    state: 'completed',
    finalEligible: false,
    ...options.presentation,
  };
  const partSources = presentation
    ? Object.fromEntries(
        content.map((_, index) => [index, [{ sourceMessageId: id, sourceBlockIndex: index, presentation }]]),
      )
    : undefined;
  return {
    id,
    role: 'assistant',
    createdAt: new Date(2026, 10, 24, 11, 18),
    content,
    status: options.running ? { type: 'running' } : { type: 'complete', reason: 'stop' },
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { mainframe: { ...(partSources && { partSources }), ...options.custom } },
      ...(options.timing !== undefined && {
        timing: { streamStartTime: 0, totalStreamTime: options.timing, totalChunks: 0, toolCallCount: 0 },
      }),
    },
  } as ThreadAssistantMessage;
}
export const user = (value: string, id = 'user', custom: object = {}): ThreadMessage =>
  ({
    id,
    role: 'user',
    createdAt: new Date(2026, 10, 24, 11, 17),
    content: [{ type: 'text', text: value }],
    attachments: [],
    metadata: { custom: { mainframe: custom } },
  }) as unknown as ThreadMessage;
export const system = (id: string, custom: object): ThreadMessage =>
  ({
    id,
    role: 'system',
    createdAt: new Date(2026, 10, 24, 11, 18),
    content: [{ type: 'text', text: '' }],
    metadata: { custom: { mainframe: custom } },
  }) as unknown as ThreadMessage;

interface Props {
  messages: readonly ThreadMessage[];
  rootId: string;
  isRunning?: boolean;
  extras?: unknown;
  pending?: string[];
  scroll?: TranscriptScrollController;
  children?: ReactNode;
}

/** The transcript over a real runtime. `rootId` scopes the disclosure stores, so give each test its own. */
export function TurnFixture({ messages, rootId, isRunning, extras, pending, scroll, children }: Props) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages,
    extras,
    isRunning: isRunning ?? messages.some((message) => message.status?.type === 'running'),
    onNew: async () => {},
  });
  const scope = useMemo(
    () => ({ rootThreadId: rootId, chatId: 'chat-fixture', ancestors: [], pendingToolIds: new Set(pending) }),
    [rootId, pending],
  );
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TranscriptScopeProvider value={scope}>
          <TranscriptScrollProvider value={scroll ?? null}>
            <ThreadPrimitive.Root>
              <ThreadPrimitive.Viewport
                data-testid="turn-viewport"
                data-mf-chat-thread=""
                data-mf-chat-id="chat-fixture"
              >
                <TurnTranscript />
                {children}
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>
          </TranscriptScrollProvider>
        </TranscriptScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
