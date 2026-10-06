'use client';

/**
 * SideChatPanelHeader — "Side chat" title, live status dot, collapse, close,
 * and the compact context notices sitting directly under this row (todo #344).
 * The parent's fork-parent link is deliberately not rendered here, so no
 * forked-from link ever appears inside the panel (AC 22).
 *
 * Close hard-deletes through #346's existing discard route and asks for no
 * confirmation (spec decision) — a failed discard leaves the row (and this
 * panel) in place and surfaces a toast; the panel itself only disappears once
 * the parent's own `sideChatId` clears, which `SideChatHost` reacts to on the
 * next `chat.updated` broadcast.
 */
import { ChevronDown, X } from 'lucide-react';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { mfToast } from '@/lib/toast';
import { discardChat } from '@/lib/api/chats';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { hasPendingGate, isRunningFromState, useOptionalControllerState } from './use-side-chat-controller';
import { useSideChatCollapseStore } from './side-chat-collapse-store';
import { unregisterSideChat } from './side-chat-ids';
import { SideChatNotice } from './SideChatNotice';

export function SideChatPanelHeader({
  parentChatId,
  sideChatId,
  controller,
}: {
  parentChatId: string;
  sideChatId: string;
  controller: AcpChatController;
}) {
  const port = useDaemonPort();
  const state = useOptionalControllerState(controller);
  const isRunning = state != null && isRunningFromState(state);
  const isWaiting = state != null && hasPendingGate(state);
  const setCollapsed = useSideChatCollapseStore((s) => s.setCollapsed);

  const close = () => {
    void discardChat(port, sideChatId)
      .then(() => unregisterSideChat(sideChatId))
      .catch((err: unknown) => {
        mfToast.error(err instanceof Error ? err.message : 'Could not close the side chat');
      });
  };

  return (
    <div className="flex flex-col border-b border-border">
      <div data-testid={`side-chat-header-${parentChatId}`} className="flex h-8 shrink-0 items-center gap-1.5 px-2">
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            isRunning || isWaiting ? 'bg-primary animate-pulse' : 'bg-muted-foreground',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">Side chat</span>
        <Hint label="Collapse">
          <Button
            data-testid={`side-chat-collapse-${parentChatId}`}
            variant="ghost"
            size="icon-xs"
            onClick={() => setCollapsed(parentChatId, true)}
          >
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </Hint>
        <Hint label="Close side chat">
          <Button data-testid={`side-chat-close-${parentChatId}`} variant="ghost" size="icon-xs" onClick={close}>
            <X className="text-muted-foreground" />
          </Button>
        </Hint>
      </div>
      <SideChatNotice parentChatId={parentChatId} />
    </div>
  );
}
