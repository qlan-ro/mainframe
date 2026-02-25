import React from 'react';
import { useTabsStore } from '../../store/tabs';
import { useProjectsStore, useChatsStore } from '../../store';
import { useProject } from '../../hooks/useAppInit';
import { ChatContainer } from '../chat/ChatContainer';
import { cn } from '../../lib/utils';

function ChatTabDot({ chatId }: { chatId: string }): React.ReactElement {
  const status = useChatsStore((s) => {
    const chat = s.chats.find((c) => c.id === chatId);
    return chat?.displayStatus ?? 'idle';
  });
  if (status === 'waiting') {
    return <div className="w-2 h-2 rounded-full shrink-0 bg-mf-accent animate-pulse motion-reduce:animate-none" />;
  }
  return (
    <div
      className={cn(
        'w-2 h-2 rounded-full shrink-0',
        status === 'working'
          ? 'bg-mf-accent animate-pulse motion-reduce:animate-none'
          : 'bg-mf-text-secondary opacity-40',
      )}
    />
  );
}

export function CenterPanel(): React.ReactElement {
  const { tabs, activePrimaryTabId } = useTabsStore();
  const { activeProjectId } = useProjectsStore();
  const { activeChatId, addPendingPermission } = useChatsStore();
  const { createChat } = useProject(activeProjectId);

  React.useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activePrimaryTabId);
    if (activeTab?.type === 'chat') {
      useChatsStore.getState().setActiveChat(activeTab.chatId);
    } else {
      useChatsStore.getState().setActiveChat(null);
    }
  }, [activePrimaryTabId, tabs]);

  React.useEffect(() => {
    if (activeChatId) {
      // @ts-expect-error debug helper attached to window
      window.askMeAQuestion = () => {
        addPendingPermission(activeChatId, {
          requestId: 'manual-' + Date.now(),
          toolName: 'AskUserQuestion',
          toolUseId: 'manual-use-' + Date.now(),
          input: {
            questions: [
              {
                question: 'What is your favorite programming language?',
                header: 'Quick Poll',
                options: [
                  { label: 'TypeScript', description: 'Strongly typed JavaScript' },
                  { label: 'Rust', description: 'Performance and safety' },
                  { label: 'Go', description: 'Simplicity and concurrency' },
                  { label: 'Python', description: 'Versatile and readable' },
                ],
                multiSelect: false,
              },
            ],
          },
          suggestions: [],
        });
      };
    }
  }, [activeChatId, addPendingPermission]);

  const activePrimaryTab = tabs.find((t) => t.id === activePrimaryTabId);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 overflow-hidden">
        {!activePrimaryTab ? (
          <div className="h-full flex flex-col items-center justify-center text-mf-text-secondary gap-4">
            <div className="w-14 h-14 rounded-full bg-mf-accent/10 flex items-center justify-center">
              <span className="text-2xl font-bold text-mf-accent">M</span>
            </div>
            <div className="text-mf-body space-y-1">
              <div className="flex items-center justify-between gap-6 h-[28px] px-2 rounded-mf-input hover:bg-mf-hover/50 transition-colors">
                <span>New Session</span>
                <kbd className="bg-mf-hover/50 px-2 py-0.5 rounded font-mono text-mf-small">&#x2318;N</kbd>
              </div>
              <div className="flex items-center justify-between gap-6 h-[28px] px-2 rounded-mf-input hover:bg-mf-hover/50 transition-colors">
                <span>Search Sessions</span>
                <kbd className="bg-mf-hover/50 px-2 py-0.5 rounded font-mono text-mf-small">&#x2318;F</kbd>
              </div>
              <div className="flex items-center justify-between gap-6 h-[28px] px-2 rounded-mf-input hover:bg-mf-hover/50 transition-colors">
                <span>Open Settings</span>
                <kbd className="bg-mf-hover/50 px-2 py-0.5 rounded font-mono text-mf-small">&#x2318;,</kbd>
              </div>
            </div>
          </div>
        ) : (
          <ChatContainer key={activePrimaryTab.chatId} chatId={activePrimaryTab.chatId} />
        )}
      </div>
    </div>
  );
}
