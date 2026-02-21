import React, { useCallback } from 'react';
import { Plus, Archive } from 'lucide-react';
import { useChatsStore, useProjectsStore } from '../../store';
import type { SessionStatus } from '../../store/chats';
import { useTabsStore } from '../../store/tabs';
import { useProject } from '../../hooks/useDaemon';
import { daemonClient } from '../../lib/client';
import { archiveChat } from '../../lib/api';
import { cn } from '../../lib/utils';
import { getAdapterLabel } from '../../lib/adapters';
import { useAdaptersStore } from '../../store/adapters';

function SessionStatusDot({ status }: { status: SessionStatus }) {
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

export function ChatsPanel(): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const { chats, activeChatId, setActiveChat, removeChat } = useChatsStore();
  const adapters = useAdaptersStore((s) => s.adapters);
  const { createChat } = useProject(activeProjectId);

  const handleSelectChat = useCallback(
    (chatId: string, title?: string) => {
      setActiveChat(chatId);
      useTabsStore.getState().openChatTab(chatId, title);
      daemonClient.resumeChat(chatId);
    },
    [setActiveChat],
  );

  const handleArchiveChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation();
      archiveChat(chatId)
        .then(() => {
          removeChat(chatId);
          useTabsStore.getState().closeTab(`chat:${chatId}`);
        })
        .catch((err) => console.warn('[chats] archive failed:', err));
    },
    [removeChat],
  );

  const formatRelativeTime = (isoString: string): string => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (date.toDateString() === now.toDateString()) return `Today ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
    if (diffDays < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
    if (diffDays < 14) return 'Last week';
    if (date.getFullYear() === now.getFullYear())
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 px-[10px] flex items-center justify-between">
        <div className="text-mf-small text-mf-text-secondary uppercase tracking-wider">Sessions</div>
        <button
          data-tutorial="step-2"
          onClick={() => createChat('claude')}
          disabled={!activeProjectId}
          className="w-7 h-7 rounded-mf-input flex items-center justify-center text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="New Session"
          aria-label="New session"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-[10px]">
        {!activeProjectId ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">Select a project to view sessions</div>
        ) : chats.length === 0 ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">No conversations yet</div>
        ) : (
          <div className="space-y-1">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={cn(
                  'group w-full rounded-mf-input transition-colors flex items-center gap-2',
                  activeChatId === chat.id ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectChat(chat.id, chat.title)}
                  className="flex-1 min-w-0 px-3 py-2 text-left rounded-mf-input"
                >
                  <div className="flex items-center gap-2">
                    <SessionStatusDot status={chat.displayStatus ?? 'idle'} />
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-mf-small truncate',
                          activeChatId === chat.id ? 'text-mf-text-primary font-medium' : 'text-mf-text-secondary',
                        )}
                        title={chat.title || 'New Chat'}
                      >
                        {chat.title || 'New Chat'}
                      </div>
                      <div className="text-mf-status text-mf-text-secondary mt-0.5">
                        {getAdapterLabel(chat.adapterId, adapters)}
                        <span className="mx-0.5">•</span>
                        {formatRelativeTime(chat.updatedAt)}
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => handleArchiveChat(e, chat.id)}
                  className="opacity-0 group-hover:opacity-100 mr-2 p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-all shrink-0"
                  title="Archive session"
                  aria-label="Archive session"
                >
                  <Archive size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
