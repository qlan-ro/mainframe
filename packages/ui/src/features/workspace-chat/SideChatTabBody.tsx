/**
 * SideChatTabBody — a session's side chat in a workspace tab (W9). It used to be
 * a panel beside or below its parent's thread.
 *
 * A side chat is never in the thread list, so `threadListItem` stays unbound and
 * its identity comes from `SideChatScopeProvider` (see `side-chat-scope`). Its
 * controller is also kept live by `useSideChatTab` while the parent is on
 * screen, so the header toggle knows its state with the tab closed.
 *
 * Closing the tab keeps the side chat. Discard, here, deletes it, and asks
 * first: it cannot be undone.
 */
import { useCallback, useMemo, useState } from 'react';
import { AuiProvider, useAui } from '@assistant-ui/react';
import { MessagesSquare, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useChatTitle } from '@/features/chat/orchestration/use-session-items';
import { ChatThread } from '@/features/chat/thread/ChatThread';
import { useChatController } from '@/features/sessions/runtime/use-chat-controller';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { SideChatNotice } from '@/features/side-chat/SideChatNotice';
import { SideChatScopeProvider } from '@/features/side-chat/side-chat-scope';
import { parentOfSideChat, unregisterSideChat } from '@/features/side-chat/side-chat-ids';
import { discardChat } from '@/lib/api/chats';
import { requestConfirm } from '@/lib/confirm-bridge';
import { mfToast } from '@/lib/toast';
import { useLayoutStore } from '@/store/layout';
import { ConversationHeader } from './ConversationHeader';
import { closeChatTab } from './conversation-tabs';
import { DraftKeeper } from './DraftKeeper';
import { useDeclareConversation } from './mounted-conversations';
import { useConversationThread } from './use-conversation-thread';

function DiscardButton({ chatId }: { chatId: string }) {
  const port = useDaemonPort();
  const [busy, setBusy] = useState(false);
  const discard = useCallback(async () => {
    const ok = await requestConfirm({
      title: 'Discard this side chat?',
      body: 'Its messages are deleted. Closing the tab instead keeps them.',
      confirmLabel: 'Discard',
      destructive: true,
      testid: 'side-chat-discard-dialog',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await discardChat(port, chatId);
      unregisterSideChat(chatId);
      closeChatTab(chatId);
    } catch (err) {
      setBusy(false);
      mfToast.error(err instanceof Error ? err.message : 'Could not discard the side chat');
    }
  }, [port, chatId]);
  return (
    <Hint label="Discard side chat">
      <Button
        data-testid={`side-chat-discard-${chatId}`}
        aria-label="Discard side chat"
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        className="text-muted-foreground"
        onClick={() => void discard()}
      >
        <Trash2 className="size-4" />
      </Button>
    </Hint>
  );
}

export function SideChatTabBody({ chatId, active }: { chatId: string; active: boolean }) {
  const aui = useAui();
  const controller = useChatController(chatId, useDaemonPort());
  const config = useConversationThread(controller);
  useDeclareConversation(chatId, chatId, active);
  // After a restart the registry fills from the session list; until then the session on screen is the parent.
  const sessionId = useLayoutStore((s) => s.activeSessionId);
  const parentChatId = parentOfSideChat(chatId) ?? sessionId ?? '';
  const parentTitle = useChatTitle(parentChatId);
  const scope = useMemo(() => ({ parentChatId, sideChatId: chatId }), [parentChatId, chatId]);
  return (
    <AuiProvider extends={aui} config={config}>
      <SideChatScopeProvider value={scope}>
        <DraftKeeper chatId={chatId} />
        <ConversationHeader
          testId={`side-chat-header-${chatId}`}
          glyph={<MessagesSquare aria-hidden />}
          title="Side chat"
          kind={parentTitle == null ? 'Temporary' : `Beside “${parentTitle}”`}
        >
          <DiscardButton chatId={chatId} />
        </ConversationHeader>
        <SideChatNotice parentChatId={parentChatId} />
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <ChatThread variant="side" />
        </div>
      </SideChatScopeProvider>
    </AuiProvider>
  );
}
