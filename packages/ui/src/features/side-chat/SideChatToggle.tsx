'use client';

/**
 * SideChatToggle — the chat header's side-chat affordance (todo #344,
 * `side-chat-toggle-<parentChatId>`). With no side chat, it opens one. With one,
 * it shows its workspace tab, or takes the tab away while it is in front; the
 * side chat itself stays. Its status reads the side chat's running/waiting state
 * off the controller `useSideChatTab` keeps live, tab open or not (UI rule 8).
 * Renders nothing for a draft or a non-regular (archived) thread (AC 19) —
 * mirrors the session/tab context-menu guards.
 */
import { MessagesSquare } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { closeChatTab, useChatTabInFront } from '@/features/workspace-chat/conversation-tabs';
import { useOpenSideChat } from './use-open-side-chat';
import { openSideChatTab } from './use-side-chat-tab';
import {
  hasPendingGate,
  isRunningFromState,
  useOptionalControllerState,
  useSideChatController,
} from './use-side-chat-controller';

export function SideChatToggle() {
  const parentChatId = useAuiState((s) => s.threadListItem?.id ?? null);
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const sideChatId = useAuiState(
    (s) => activeSessionCustom(s.threadListItem, s.threads.threadItems)?.sideChatId ?? null,
  );
  const openSideChat = useOpenSideChat();
  const inFront = useChatTabInFront(sideChatId);
  const controller = useSideChatController(sideChatId);
  const state = useOptionalControllerState(controller);
  const isRunning = state != null && isRunningFromState(state);
  const isWaiting = state != null && hasPendingGate(state);

  if (parentChatId == null || itemStatus !== 'regular') return null;

  const status: 'none' | 'idle' | 'running' | 'waiting' =
    sideChatId == null ? 'none' : isWaiting ? 'waiting' : isRunning ? 'running' : 'idle';
  const label = sideChatId == null ? 'Open side chat' : inFront ? 'Hide side chat' : 'Show side chat';

  return (
    <Hint label={label}>
      <Button
        data-testid={`side-chat-toggle-${parentChatId}`}
        data-side-chat-status={status}
        aria-label={label}
        aria-pressed={inFront}
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          if (sideChatId == null) void openSideChat(parentChatId, false);
          else if (inFront) closeChatTab(sideChatId);
          else openSideChatTab(sideChatId);
        }}
      >
        <MessagesSquare
          className={cn(
            status === 'none' ? 'text-muted-foreground' : 'text-accent-ink',
            status !== 'idle' && status !== 'none' && 'animate-pulse motion-reduce:animate-none',
          )}
        />
      </Button>
    </Hint>
  );
}
