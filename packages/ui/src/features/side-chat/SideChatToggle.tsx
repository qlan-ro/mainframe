'use client';

/**
 * SideChatToggle — the parent chat header's side-chat affordance (todo #344,
 * `side-chat-toggle-<parentChatId>`). With no side chat, it opens one. With
 * one, it toggles the panel's collapse state; while collapsed, its status
 * still reflects the side chat's running/waiting state (UI rule 8), read off
 * the SAME shared controller `SideChatHost` keeps alive, so status is visible
 * without opening the panel. Renders nothing for a draft or a non-regular
 * (archived) thread (AC 19) — mirrors the session/tab context-menu guards.
 */
import { MessagesSquare } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useOpenSideChat } from './use-open-side-chat';
import { useSideChatCollapseStore } from './side-chat-collapse-store';
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
  const collapsed = useSideChatCollapseStore((s) => (parentChatId != null ? s.isCollapsed(parentChatId) : true));
  const setCollapsed = useSideChatCollapseStore((s) => s.setCollapsed);
  const controller = useSideChatController(sideChatId);
  const state = useOptionalControllerState(controller);
  const isRunning = state != null && isRunningFromState(state);
  const isWaiting = state != null && hasPendingGate(state);

  if (parentChatId == null || itemStatus !== 'regular') return null;

  const status: 'none' | 'idle' | 'running' | 'waiting' =
    sideChatId == null ? 'none' : isWaiting ? 'waiting' : isRunning ? 'running' : 'idle';
  const label = sideChatId == null ? 'Open side chat' : collapsed ? 'Show side chat' : 'Hide side chat';

  return (
    <Hint label={label}>
      <Button
        data-testid={`side-chat-toggle-${parentChatId}`}
        data-side-chat-status={status}
        aria-pressed={sideChatId != null && !collapsed}
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          if (sideChatId == null) void openSideChat(parentChatId);
          else setCollapsed(parentChatId, !collapsed);
        }}
      >
        <MessagesSquare
          className={cn(
            status === 'none' ? 'text-muted-foreground' : 'text-primary',
            status !== 'idle' && status !== 'none' && 'animate-pulse',
          )}
        />
      </Button>
    </Hint>
  );
}
