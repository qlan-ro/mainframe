/**
 * ChatTabBody — a chat of the session list in a workspace tab (W9): a fork, a
 * delegated task, or another session shown beside the conversation. The whole
 * chat: transcript, gates and composer, each resolving to this chat because
 * `threadListItem` and `thread` are rebound (`use-conversation-thread`).
 *
 * Nothing here closes the tab. A chat that left the list says so and waits for
 * the user, and one that became the conversation itself steps aside: the chat
 * column owns its composer now.
 */
import { useEffect, useState } from 'react';
import { AuiProvider, useAui, useAuiState } from '@assistant-ui/react';
import { ArrowLeftToLine, Bot, MessageSquare, Split } from 'lucide-react';
import { useIsConnected } from '@/app/ConnectionStatusContext';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { findByChatId } from '@/features/chat/orchestration/use-session-items';
import { ChatThread } from '@/features/chat/thread/ChatThread';
import { useSessionListLoadState } from '@/features/sessions/runtime/list-load-state';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useStop } from '@/features/session-panel/use-stop';
import { SideChatToggle } from '@/features/side-chat/SideChatToggle';
import { useSideChatTab } from '@/features/side-chat/use-side-chat-tab';
import { cancelDelegatedTask } from '@/lib/api/background-tasks';
import { useAdaptersStore } from '@/store/adapters';
import { useLayoutStore } from '@/store/layout';
import type { ChatTabRole, RunTab } from '@/store/run-pane';
import { AgentStatusLabel, ConversationHeader, StopButton, type AgentStatus } from './ConversationHeader';
import { ChatHeaderParentLink } from '@/features/chat/thread/ChatHeaderParentLink';
import { DraftKeeper } from './DraftKeeper';
import { useDeclareConversation } from './mounted-conversations';
import { useConversationThread } from './use-conversation-thread';
import { OwnFiles } from './OwnFiles';

/** How long a chat may take to reach the session list (a new fork's reload) before its tab calls it gone. */
const LISTING_GRACE_MS = 5_000;

const GLYPH: Record<Exclude<ChatTabRole, 'side'>, React.ReactNode> = {
  fork: <Split aria-hidden className="rotate-90" />,
  task: <Bot aria-hidden className="fill-current/25" />,
  session: <MessageSquare aria-hidden />,
};

export interface ChatTabBodyProps {
  tab: RunTab;
  chatId: string;
  active: boolean;
}

/** Whether the list on screen is the daemon's answer, rather than one still loading or out of reach. */
function useListSettled(): boolean {
  const isLoading = useAuiState((s) => s.threads.isLoading);
  return useSessionListLoadState((s) => s.loaded) && !isLoading;
}

function Unlisted({ chatId }: { chatId: string }) {
  const connected = useIsConnected();
  const settled = useListSettled() && connected;
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!settled) return undefined;
    const timer = setTimeout(() => setLate(true), LISTING_GRACE_MS);
    return () => {
      clearTimeout(timer);
      setLate(false);
    };
  }, [settled]);
  const waiting = connected ? 'Opening the chat…' : 'Waiting for the connection…';
  return (
    <div
      data-testid={`workspace-chat-unlisted-${chatId}`}
      role="status"
      className="grid h-full place-items-center p-4 text-center text-sm text-muted-foreground"
    >
      {late && settled ? 'This chat is no longer here.' : waiting}
    </div>
  );
}

function taskStatus(custom: SessionCustom): AgentStatus {
  const status = custom.delegation?.status ?? 'completed';
  if (status === 'interrupted') return 'stopped';
  if (status === 'waiting') return 'needs-you';
  if (status === 'running' && (custom.hasPending || custom.delegatedWaiting)) return 'needs-you';
  return status;
}

const LIVE: ReadonlySet<AgentStatus> = new Set(['running', 'needs-you', 'queued']);

function TaskControls({ chatId, title, custom }: { chatId: string; title: string; custom: SessionCustom }) {
  const status = taskStatus(custom);
  const { delegation, parentChatId } = custom;
  const { onStop, stopping } = useStop(
    title,
    delegation != null && parentChatId != null && LIVE.has(status)
      ? () => cancelDelegatedTask(parentChatId, delegation.taskId)
      : undefined,
  );
  return (
    <>
      <AgentStatusLabel status={status} testId={`workspace-chat-status-${chatId}`} />
      {onStop && <StopButton title={title} busy={stopping} onStop={onStop} testId={`workspace-chat-stop-${chatId}`} />}
    </>
  );
}

/** "Delegated task · Codex" names the provider too (T1c); a fork names its parent. */
function useKindLine(role: ChatTabRole, custom: SessionCustom | undefined): React.ReactNode {
  const provider = useAdaptersStore((s) => (custom ? s.byId[custom.adapterId]?.name : undefined));
  if (role === 'task') return ['Delegated task', provider ?? custom?.adapterId].filter(Boolean).join(' · ');
  if (role === 'fork') return <ChatHeaderParentLink />;
  return provider ?? 'Session';
}

function ThreadHeader({ tab, chatId, itemId }: { tab: RunTab; chatId: string; itemId: string }) {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem?.title) || tab.title;
  const custom = useAuiState((s) => s.threadListItem?.custom as SessionCustom | undefined);
  const role = tab.role === 'side' ? 'session' : (tab.role ?? 'session');
  return (
    <ConversationHeader
      testId={`workspace-chat-header-${chatId}`}
      glyph={GLYPH[role]}
      title={title}
      kind={useKindLine(role, custom)}
    >
      {custom?.delegation != null && <TaskControls chatId={chatId} title={title} custom={custom} />}
      {custom?.delegation == null && <SideChatToggle />}
      <Hint label="Open in the chat column">
        <Button
          data-testid={`workspace-chat-promote-${chatId}`}
          aria-label="Open in the chat column"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          onClick={() => aui.threads.switchToThread(itemId)}
        >
          <ArrowLeftToLine className="size-4" />
        </Button>
      </Hint>
    </ConversationHeader>
  );
}

/** The chat's own side chat opens beside it, in the workspace it is shown in. */
function SideChatFollower({ chatId }: { chatId: string }): null {
  const sessionId = useLayoutStore((s) => s.activeSessionId);
  useSideChatTab({ parentChatId: chatId, sessionId });
  return null;
}

function Conversation({ tab, chatId, itemId, active }: ChatTabBodyProps & { itemId: string }) {
  const aui = useAui();
  const controller = useChatController(itemId, useDaemonPort());
  const config = useConversationThread(controller, itemId);
  useDeclareConversation(itemId, chatId, active);
  return (
    <AuiProvider extends={aui} config={config}>
      <DraftKeeper chatId={itemId} />
      <SideChatFollower chatId={chatId} />
      <ThreadHeader tab={tab} chatId={chatId} itemId={itemId} />
      <OwnFiles chatId={chatId}>
        <div className="min-h-0 flex-1">
          <ChatThread />
        </div>
      </OwnFiles>
    </AuiProvider>
  );
}

export function ChatTabBody(props: ChatTabBodyProps) {
  const { chatId } = props;
  const itemId = useAuiState((s) => findByChatId(s.threads.threadItems, chatId)?.id ?? null);
  const isConversation = useAuiState((s) => itemId != null && s.threads.mainThreadId === itemId);
  if (isConversation) return null;
  if (itemId == null) return <Unlisted chatId={chatId} />;
  return <Conversation key={itemId} {...props} itemId={itemId} />;
}
