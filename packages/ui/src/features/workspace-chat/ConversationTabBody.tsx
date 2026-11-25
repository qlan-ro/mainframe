/**
 * ConversationTabBody — the body of a chat or agent tab. Mounted from its first
 * showing until it closes, hidden like a terminal while another tab is in front,
 * so an unsent message, the scroll position and open rows stay as they were.
 */
import { useRef, useState } from 'react';
import { conversationProps } from '@/lib/conversation-focus';
import { cn } from '@/lib/utils';
import type { RunTab } from '@/store/run-pane';
import { ChatTabBody } from './ChatTabBody';
import { SideChatTabBody } from './SideChatTabBody';
import { SubagentTabBody } from './SubagentTabBody';
import { useTabBodyFocus } from './tab-focus';

function Body({ tab, active }: { tab: RunTab; active: boolean }) {
  // A corrupt persisted tab says so rather than mounting a chat on `undefined`.
  if (!tab.chatId) return <p className="p-4 text-sm text-muted-foreground">{tab.title}: no chat to show</p>;
  if (tab.kind === 'agent') {
    if (!tab.toolCallId) return <p className="p-4 text-sm text-muted-foreground">{tab.title}: no agent to show</p>;
    return (
      <SubagentTabBody
        chatId={tab.chatId}
        toolCallId={tab.toolCallId}
        messageId={tab.messageId}
        title={tab.title}
        active={active}
      />
    );
  }
  if (tab.role === 'side') return <SideChatTabBody chatId={tab.chatId} active={active} />;
  return <ChatTabBody tab={tab} chatId={tab.chatId} active={active} />;
}

export function ConversationTabBody({ tab, active }: { tab: RunTab; active: boolean }) {
  const [shown, setShown] = useState(active);
  if (active && !shown) setShown(true);
  const ref = useRef<HTMLDivElement>(null);
  useTabBodyFocus(ref, tab.id, active);
  if (!shown) return null;
  return (
    <div
      ref={ref}
      {...conversationProps(tab.kind === 'chat' ? tab.chatId : undefined)}
      tabIndex={-1}
      data-testid={`workspace-conversation-${tab.id}`}
      data-conversation-tab={active ? 'active' : 'hidden'}
      inert={!active}
      className={cn(
        'absolute inset-0 flex flex-col overflow-hidden bg-background outline-none focus-visible:focus-line-inset',
        !active && 'invisible',
      )}
    >
      <Body tab={tab} active={active} />
    </div>
  );
}
