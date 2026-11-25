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
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { Bot } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { TranscriptScopeProvider } from '@/features/chat/messages/compact/transcript-scope';
import { markdownComponents } from '@/features/chat/parts/markdown-text';
import { remarkAppLinks, urlTransform } from '@/features/chat/parts/markdown-url-transform';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import { useControllerState } from '@/features/chat/runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '@/features/chat/runtime/use-native-thread-messages';
import { SubagentTranscript } from '@/features/chat/tools/cards/SubagentTranscript';
import { useStop } from '@/features/session-panel/use-stop';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { stopBackgroundTask } from '@/lib/api/background-tasks';
import { agentResult, agentState, isCodexAgent } from './agent-status';
import { AgentStatusLabel, ConversationHeader, StopButton } from './ConversationHeader';
import { findSubagentCall, type SubagentCall } from './find-subagent-call';
import { useHoldConversation } from './mounted-conversations';
import { OwnFiles } from './OwnFiles';
import { useAgentTasks } from './use-agent-tasks';
import { useKeepAttached } from './use-conversation-thread';

const REMARK_PLUGINS = [remarkGfm, remarkAppLinks, remarkBreaks];

/** The only CLI that can stop one background agent on its own. */
const STOP_ADAPTER = 'claude';

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

function Block({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="min-w-0">
      <h3 className="pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="aui-md text-sm break-words">{children}</div>
    </section>
  );
}

function ProseBlock({ label, testId, source }: { label: string; testId: string; source: string }) {
  if (source === '') return null;
  return (
    <Block label={label} testId={testId}>
      <Markdown remarkPlugins={REMARK_PLUGINS} urlTransform={urlTransform} components={markdownComponents}>
        {source}
      </Markdown>
    </Block>
  );
}

function Steps({ call }: { call: SubagentCall }) {
  const steps = call.part.messages ?? [];
  if (steps.length === 0) return null;
  return <SubagentTranscript messages={steps} messageId={call.messageId} toolCallId={call.part.toolCallId} inZone />;
}

/** Everything in the tab is the parent's: no thread is bound here, so without this it would read the chat column's. */
function ParentScope({ chatId, state, children }: { chatId: string; state: ChatThreadState; children: ReactNode }) {
  const permissions = state.interactions.permissions;
  const scope = useMemo(
    () => ({
      rootThreadId: chatId,
      chatId,
      ancestors: [],
      pendingToolIds: new Set(
        Object.values(permissions).flatMap((entry) => (entry.request.toolUseId ? [entry.request.toolUseId] : [])),
      ),
    }),
    [chatId, permissions],
  );
  return (
    <TranscriptScopeProvider value={scope}>
      <OwnFiles chatId={chatId}>{children}</OwnFiles>
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
  const controller = useChatController(chatId, useDaemonPort());
  useKeepAttached(controller);
  useHoldConversation(chatId);
  const state = useControllerState(controller);
  const messages = useNativeThreadMessages(state);
  const call = useMemo(() => findSubagentCall(messages, toolCallId), [messages, toolCallId]);
  const error = useLoadCall(controller, state, messages, call, { toolCallId, messageId });
  const tasks = useAgentTasks(chatId, toolCallId, state.backgroundTasks, active);
  const shown = call == null ? null : agentState({ call, state, messages, tasks });
  const args = (call?.part.args ?? {}) as Record<string, unknown>;
  const shownTitle = text(args['description']) || title;
  const running = tasks?.find((task) => task.status === 'running');
  const canStop = running != null && state.chatConfig?.adapterId === STOP_ADAPTER;
  const { onStop, stopping } = useStop(shownTitle, canStop ? () => stopBackgroundTask(chatId, running.id) : undefined);

  return (
    <div data-testid={`workspace-agent-${toolCallId}`} className="flex h-full min-h-0 flex-col text-foreground">
      <ConversationHeader
        testId={`workspace-agent-header-${toolCallId}`}
        glyph={<Bot aria-hidden />}
        title={shownTitle}
        kind={kindLine(call)}
      >
        {shown != null && <AgentStatusLabel {...shown} testId={`workspace-agent-status-${toolCallId}`} />}
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
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-3 pb-4 outline-none focus-visible:focus-line-inset"
      >
        {call == null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {error ?? 'Loading the sub-agent…'}
          </p>
        ) : (
          <ParentScope chatId={chatId} state={state}>
            <ProseBlock label="Brief" testId={`workspace-agent-brief-${toolCallId}`} source={text(args['prompt'])} />
            <Steps call={call} />
            <ProseBlock
              label="Result"
              testId={`workspace-agent-result-${toolCallId}`}
              source={agentResult(call, tasks, shown)}
            />
          </ParentScope>
        )}
      </div>
    </div>
  );
}
