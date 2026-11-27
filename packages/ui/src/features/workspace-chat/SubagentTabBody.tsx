import { SubagentFind } from './SubagentFind';
import { ProseBlock, TextBlock } from './SubagentTextBlocks';
import { ConversationExportButton } from './ConversationExportButton';
import { useMemo, useRef, type ReactNode } from 'react';
import type { ThreadMessage, ToolCallMessagePart } from '@assistant-ui/react';
import { Bot } from 'lucide-react';
import { TranscriptScopeProvider } from '@/features/chat/messages/turn/transcript-scope';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { useControllerState } from '@/features/chat/runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '@/features/chat/runtime/use-native-thread-messages';
import { HistoricalAgentSteps } from '@/features/chat/messages/turn/HistoricalAgentSteps';
import { subagentFact } from '@/features/chat/view-model/subagent-facts';
import { AgentSteps } from '@/features/chat/messages/turn/AgentSteps';
import {
  AgentWorldProvider,
  readAgentWork,
  type AgentWork,
  type AgentWorld,
} from '@/features/chat/messages/turn/agent-world';
import { asToolPart, chatTurns, holderLive } from '@/features/chat/messages/turn/chat-turns';
import { OwnChatStateProvider } from '@/features/chat/runtime/own-chat-state';
import { TurnCache } from '@/features/chat/view-model/turn/turn-cache';
import { backgroundStopKey, useStop } from '@/features/session-panel/use-stop';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { stopBackgroundTask } from '@/lib/api/background-tasks';
import {
  describeAgent,
  isBackgroundLaunch,
  isCodexAgent,
  isFailed,
  pendingCalls,
  sessionRuns,
  stoppableTask,
} from './agent-status';
import { AgentStatusLabel, ConversationHeader, StopButton } from './ConversationHeader';
import type { SubagentCall } from './find-subagent-call';
import { useHoldConversation } from './mounted-conversations';
import { OwnFiles } from './OwnFiles';
import { ownTasks, useChatTasks } from './use-chat-tasks';
import { useKeepAttached } from './use-conversation-thread';
import { useSubagentCall } from './use-subagent-call';
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
interface Place {
  pending: ReadonlySet<string>;
  partLive: boolean;
  work: AgentWork;
}

function usePlace(
  call: SubagentCall | null,
  messages: readonly ThreadMessage[],
  state: ChatThreadState,
  world: AgentWorld,
  /** The parent's window, when the call is a copy outside it. */
  window: readonly ThreadMessage[] | null,
): Place | null {
  const cache = useMemo(() => new TurnCache(), []);
  const pending = useMemo(() => pendingCalls(state), [state]);
  const turns = useMemo(() => chatTurns(messages, state, cache, window), [messages, state, cache, window]);
  return useMemo(() => {
    if (call === null) return null;
    const partLive = holderLive(turns, call, pending, world);
    return { pending, partLive, work: readAgentWork(asToolPart(call.part), pending, partLive, world) };
  }, [call, turns, pending, world]);
}

function Steps({
  call,
  work,
  result,
  chatId,
  nativeAgentId,
}: {
  call: SubagentCall;
  work: AgentWork;
  result: string;
  chatId: string;
  nativeAgentId?: string | null;
}) {
  const steps = call.part.messages ?? [];
  const fact = subagentFact(call.part);
  const historical = fact && work.outcome !== 'going';
  if (!historical && steps.length === 0) return null;
  const Content = historical ? HistoricalAgentSteps : AgentSteps;
  return (
    <Content
      chatId={chatId}
      bare
      messages={steps}
      messageId={call.messageId}
      toolCallId={call.part.toolCallId}
      {...(historical ? { nativeAgentId } : {})}
      outcome={work.outcome}
      prompt={text((call.part.args as Record<string, unknown>)['prompt'])}
      result={result}
    />
  );
}

interface ParentScopeProps {
  chatId: string;
  state: ChatThreadState;
  world: AgentWorld;
  pending: ReadonlySet<string>;
  children: ReactNode;
}

function ParentScope({ chatId, state, world, pending, children }: ParentScopeProps) {
  const scope = useMemo(
    () => ({ rootThreadId: chatId, chatId, ancestors: [], pendingToolIds: pending }),
    [chatId, pending],
  );
  return (
    <TranscriptScopeProvider value={scope}>
      <AgentWorldProvider value={world}>
        <OwnChatStateProvider value={state}>
          <OwnFiles chatId={chatId}>{children}</OwnFiles>
        </OwnChatStateProvider>
      </AgentWorldProvider>
    </TranscriptScopeProvider>
  );
}

function kindLine(call: SubagentCall | null): string {
  if (call == null) return 'Sub-agent';
  const args = call.part.args as Record<string, unknown>;
  const name = isCodexAgent(call) ? 'Codex agent' : text(args['subagent_type']);
  return ['Sub-agent', name, text(args['model'])].filter(Boolean).join(' · ');
}

export interface SubagentTabBodyProps {
  chatId: string;
  toolCallId: string;
  messageId?: string;
  savedNestedCall?: ToolCallMessagePart;
  title: string;
  active: boolean;
}

export function SubagentTabBody({
  chatId,
  toolCallId,
  messageId,
  title,
  active,
  savedNestedCall,
}: SubagentTabBodyProps) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useChatController(chatId, useDaemonPort());
  useKeepAttached(controller);
  useHoldConversation(chatId);
  const state = useControllerState(controller);
  const messages = useNativeThreadMessages(state);
  const { tasks: listed, live } = useChatTasks(chatId, state.backgroundTasks, active);
  const taskKey = (ownTasks(listed, toolCallId) ?? [])
    .map((task) => `${task.id}:${task.status}:${task.endedAt}`)
    .join();
  const {
    call,
    messages: callMessages,
    detached,
    error,
  } = useSubagentCall({
    controller,
    state,
    messages,
    toolCallId,
    messageId,
    savedNestedCall,
    taskKey,
    active,
  });
  const historical = call ? subagentFact(call.part) : undefined;
  const nativeAgentId = savedNestedCall ? (historical?.nativeAgentId ?? null) : historical?.nativeAgentId;
  const runs = sessionRuns(state);
  const adapterId = state.chatConfig?.adapterId;
  const world = useMemo(() => ({ runs, tasks: listed, live, adapterId }), [runs, listed, live, adapterId]);
  const place = usePlace(call, callMessages, state, world, detached ? messages : null);
  const tasks = ownTasks(listed, toolCallId);
  const agent = call && place && describeAgent({ call, state, tasks, partLive: place.partLive }, live);
  const shown = agent?.status;
  const ResultBlock =
    call && (historical?.status === 'failed' || isFailed(call) || isBackgroundLaunch(call)) ? TextBlock : ProseBlock;
  const args = (call?.part.args ?? {}) as Record<string, unknown>;
  const shownTitle = historical?.title || text(args['description']) || title;
  const task = agent && stoppableTask(tasks, live, adapterId);
  const { onStop, stopping } = useStop(
    shownTitle,
    task ? () => stopBackgroundTask(chatId, task.id) : undefined,
    backgroundStopKey(chatId, task),
  );
  return (
    <div
      ref={root}
      data-testid={`workspace-agent-${toolCallId}`}
      className="flex h-full min-h-0 flex-col text-foreground"
    >
      <ConversationHeader
        testId={`workspace-agent-header-${toolCallId}`}
        glyph={<Bot aria-hidden />}
        title={shownTitle}
        kind={kindLine(call)}
      >
        {shown != null && <AgentStatusLabel {...shown} testId={`workspace-agent-status-${toolCallId}`} />}
        {nativeAgentId !== null && historical && place?.work.outcome !== 'going' && (
          <>
            <SubagentFind
              controller={controller}
              agentId={nativeAgentId ?? toolCallId}
              toolCallId={toolCallId}
              chatId={chatId}
              root={root}
              active={active}
            />
            <ConversationExportButton
              label="Export sub-agent as Markdown"
              testId="workspace-agent-export"
              load={() => controller.subagentHistory.export(nativeAgentId ?? toolCallId)}
              name="sub-agent"
            />
          </>
        )}
        {onStop && (
          <StopButton
            title={shownTitle}
            busy={stopping}
            onStop={onStop}
            testId={`workspace-agent-stop-${toolCallId}`}
          />
        )}
      </ConversationHeader>
      <div
        data-conversation-scroller
        role="region"
        aria-label={shownTitle}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[22px] pt-3 pb-4 outline-none focus-visible:focus-line-inset [&_.mf-tr-mono]:translate-y-0"
      >
        {call == null || place == null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {error ?? 'Loading the sub-agent…'}
          </p>
        ) : (
          <ParentScope chatId={chatId} state={state} world={world} pending={place.pending}>
            <ProseBlock label="Brief" testId={`workspace-agent-brief-${toolCallId}`} source={text(args['prompt'])} />
            <Steps
              chatId={chatId}
              call={call}
              work={place.work}
              result={agent?.result ?? ''}
              nativeAgentId={nativeAgentId}
            />
            <ResultBlock label="Result" testId={`workspace-agent-result-${toolCallId}`} source={agent?.result ?? ''} />
            {agent?.reports.map(({ source, text: report }, i) => {
              const ReportBlock = source === 'Final answer' ? ProseBlock : TextBlock;
              return (
                <ReportBlock
                  key={`${source}-${i}`}
                  label={source}
                  testId={`workspace-agent-report-${toolCallId}`}
                  source={report}
                />
              );
            })}
          </ParentScope>
        )}
      </div>
    </div>
  );
}
