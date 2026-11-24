/**
 * What a chat tab's pill says about its chat: the title as the session list has
 * it now, and whether it works or needs you. A side chat is in no list, so it
 * has a fixed title and its state comes from its own controller.
 */
import { useAuiState } from '@assistant-ui/react';
import { findByChatId, useChatTitle } from '@/features/chat/orchestration/use-session-items';
import {
  hasPendingGate,
  isRunningFromState,
  useOptionalControllerState,
  useSideChatController,
} from '@/features/side-chat/use-side-chat-controller';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { cn } from '@/lib/utils';
import type { RunTab } from '@/store/run-pane';

type TabState = 'working' | 'waiting' | null;

export function useConversationTitle(tab: RunTab): string {
  const listed = tab.kind === 'chat' && tab.role !== 'side' ? (tab.chatId ?? '') : '';
  return useChatTitle(listed) ?? tab.title;
}

function Dot({ tabId, state }: { tabId: string; state: TabState }) {
  if (state == null) return null;
  return (
    <span
      data-testid={`workspace-tab-state-${tabId}`}
      data-state={state}
      role="img"
      aria-label={state === 'waiting' ? 'Needs you' : 'Running'}
      className={cn(
        'absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-sidebar',
        state === 'waiting' ? 'bg-warning' : 'bg-primary',
      )}
    />
  );
}

function ListedDot({ tab }: { tab: RunTab }) {
  const state = useAuiState((s): TabState => {
    const custom = findByChatId(s.threads.threadItems, tab.chatId ?? '')?.custom as SessionCustom | undefined;
    // As the session tabs' dot (L3): needs-you outranks running, and a side chat's or task's request counts.
    if (custom?.hasPending || custom?.sideChatWaiting || custom?.delegatedWaiting) return 'waiting';
    return custom?.displayStatus === 'working' ? 'working' : null;
  });
  return <Dot tabId={tab.id} state={state} />;
}

function SideDot({ tab }: { tab: RunTab }) {
  const state = useOptionalControllerState(useSideChatController(tab.chatId));
  if (state == null) return null;
  return (
    <Dot tabId={tab.id} state={hasPendingGate(state) ? 'waiting' : isRunningFromState(state) ? 'working' : null} />
  );
}

export function ConversationTabDot({ tab }: { tab: RunTab }) {
  return tab.role === 'side' ? <SideDot tab={tab} /> : <ListedDot tab={tab} />;
}
