import { SubagentFind } from './SubagentFind';
import { ProseBlock, TextBlock } from './SubagentTextBlocks';
import { ConversationExportButton } from './ConversationExportButton';
/**
 * SubagentTabBody — a sub-agent in a workspace tab (W8): its title, kind and
 * status, Stop while it is live, the brief it was given, its steps as
 * transcript rows, and its result. Read-only: a sub-agent has no composer, and
 * its requests are answered above the parent's (G5).
 *
 * Everything is read from the parent chat's transcript, where the call and its
 * nested messages live. A call outside the loaded window loads the history that
 * holds it.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { Bot } from 'lucide-react';
import { TranscriptScopeProvider } from '@/features/chat/messages/turn/transcript-scope';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
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
import { findSubagentCall, type SubagentCall } from './find-subagent-call';
import { useHoldConversation } from './mounted-conversations';
import { OwnFiles } from './OwnFiles';
import { ownTasks, useChatTasks } from './use-chat-tasks';
import { useKeepAttached } from './use-conversation-thread';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Pages history back until the call is loaded. The text to show when it is not there, or null. */
function useLoadCall(
  controller: AcpChatController,
  state: ChatThreadState,
  messages: readonly ThreadMessage[],
  call: SubagentCall | null,
  target: { toolCallId: string; messageId?: string },
): string | null {
  const [error, setError] = useState<string | null>(null);
  const { toolCallId, messageId } = target;
  const partial = controller.isHistoryContext(toolCallId);
  const ready = state.loadState?.type === 'ready';
  const hasMore = state.historyWindow?.hasMore ?? false;
  useEffect(() => {
    if (!ready || (call != null && !partial)) return undefined;
    if (!hasMore || (!partial && messages.some((message) => message.id === messageId))) {
      setError('Not in this transcript');
      return undefined;
    }
    let cancelled = false;
    void controller.loadEarlier(toolCallId).then(
      (found) => {
        if (!cancelled && !found) setError('Not in this transcript');
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the transcript');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [controller, partial, ready, hasMore, call, messages, messageId, toolCallId]);
  return error;
}

/** Where the call stands: what its own row says of it, from the same evidence (T1c). */
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
): Place | null {
  const cache = useMemo(() => new TurnCache(), []);
  const pending = useMemo(() => pendingCalls(state), [state]);
  const turns = useMemo(() => chatTurns(messages, state, cache), [messages, state, cache]);
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
}: {
  call: SubagentCall;
  work: AgentWork;
  result: string;
  chatId: string;
}) {
  const steps = call.part.messages ?? [];
  const historical = subagentFact(call.part) && work.outcome !== 'going';
  if (!historical && steps.length === 0) return null;
  const Content = historical ? HistoricalAgentSteps : AgentSteps;
  return (
    <Content
      chatId={chatId}
      bare
      messages={steps}
      messageId={call.messageId}
      toolCallId={call.part.toolCallId}
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

/** Everything in the tab is the parent's: no thread is bound here, so without this it would read the chat column's. */
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
  title: string;
  /** In front in its pane. */
  active: boolean;
}

export function SubagentTabBody({ chatId, toolCallId, messageId, title, active }: SubagentTabBodyProps) {
  const root = useRef<HTMLDivElement>(null);
  const controller = useChatController(chatId, useDaemonPort());
  useKeepAttached(controller);
  useHoldConversation(chatId);
  const state = useControllerState(controller);
  const messages = useNativeThreadMessages(state);
  const call = useMemo(() => findSubagentCall(messages, toolCallId), [messages, toolCallId]);
  const error = useLoadCall(controller, state, messages, call, { toolCallId, messageId });
  const { tasks: listed, live } = useChatTasks(chatId, state.backgroundTasks, active);
  const runs = sessionRuns(state);
  const adapterId = state.chatConfig?.adapterId;
  const world = useMemo(() => ({ runs, tasks: listed, live, adapterId }), [runs, listed, live, adapterId]);
  const place = usePlace(call, messages, state, world);
  const tasks = ownTasks(listed, toolCallId);
  const agent = call && place && describeAgent({ call, state, tasks, partLive: place.partLive }, live);
  const shown = agent?.status;
  // An answer is prose. An error, and the receipt of a call launched in the background, are shown as they came.
  const ResultBlock = call != null && (isFailed(call) || isBackgroundLaunch(call)) ? TextBlock : ProseBlock;
  const args = (call?.part.args ?? {}) as Record<string, unknown>;
  const shownTitle = (call && subagentFact(call.part)?.title) || text(args['description']) || title;
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
        {call && subagentFact(call.part) && shown?.status !== 'running' && (
          <>
            <SubagentFind controller={controller} agentId={toolCallId} chatId={chatId} root={root} active={active} />
            <ConversationExportButton
              label="Export sub-agent as Markdown"
              testId="workspace-agent-export"
              load={() => controller.subagentHistory.export(toolCallId)}
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
            <Steps chatId={chatId} call={call} work={place.work} result={agent?.result ?? ''} />
            <ResultBlock label="Result" testId={`workspace-agent-result-${toolCallId}`} source={agent?.result ?? ''} />
            {agent?.reports.map(({ source, text: report }, i) => {
              // A final answer is the agent's prose by its source; a summary is the CLI's.
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
