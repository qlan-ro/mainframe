import React, { useCallback, useState } from 'react';
import { Plus, Archive, ChevronDown, ChevronRight, Bot, GitBranch, Clock, Loader2 } from 'lucide-react';
import type { Project, Chat } from '@qlan-ro/mainframe-types';
import type { SessionStatus } from '../../store/chats';
import { useChatsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { useAdaptersStore } from '../../store/adapters';
import { daemonClient } from '../../lib/client';
import { archiveChat } from '../../lib/api';
import { cn } from '../../lib/utils';
import { getAdapterLabel } from '../../lib/adapters';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:project-group');

function SessionStatusDot({ status, worktreeMissing }: { status: SessionStatus; worktreeMissing?: boolean }) {
  if (worktreeMissing) {
    return <div data-testid="chat-status-missing" className="w-2 h-2 rounded-full shrink-0 bg-mf-destructive" />;
  }
  const isWorking = status === 'working' || status === 'waiting';
  return (
    <div
      data-testid={isWorking ? 'chat-status-working' : 'chat-status-idle'}
      className={cn(
        'w-2 h-2 rounded-full shrink-0',
        isWorking ? 'bg-mf-accent animate-pulse motion-reduce:animate-none' : 'bg-mf-text-secondary opacity-40',
      )}
    />
  );
}

function formatRelativeTime(isoString: string): string {
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
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ProjectGroupProps {
  project: Project;
  chats: Chat[];
  parentName?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onContextMenu?: (e: React.MouseEvent, sessionId: string | undefined) => void;
}

export function ProjectGroup({
  project,
  chats,
  parentName,
  collapsed,
  onToggleCollapse,
  onContextMenu,
}: ProjectGroupProps): React.ReactElement {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const removeChat = useChatsStore((s) => s.removeChat);
  const adapters = useAdaptersStore((s) => s.adapters);

  const handleSelectChat = useCallback(
    (chatId: string, title?: string) => {
      setActiveChat(chatId);
      useTabsStore.getState().openChatTab(chatId, title);
      daemonClient.resumeChat(chatId);
    },
    [setActiveChat],
  );

  const [archivingIds, setArchivingIds] = useState<Set<string>>(new Set());

  const handleArchiveChat = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation();
      if (archivingIds.has(chatId)) return;
      const chat = chats.find((c) => c.id === chatId);
      let deleteWorktree = true;
      if (chat?.worktreePath) {
        const choice = window.confirm(
          `This session has a worktree at:\n${chat.worktreePath}\n\nOK = Archive and delete worktree\nCancel = Archive only (keep worktree)`,
        );
        deleteWorktree = choice;
      }
      setArchivingIds((prev) => new Set(prev).add(chatId));
      archiveChat(chatId, deleteWorktree)
        .then(() => {
          const wasActive = activeChatId === chatId;
          removeChat(chatId);
          useTabsStore.getState().closeTab(`chat:${chatId}`);
          if (wasActive) {
            const next = chats
              .filter((c) => c.id !== chatId)
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
            if (next) {
              setActiveChat(next.id);
              useTabsStore.getState().openChatTab(next.id, next.title);
            }
          }
        })
        .catch((err) => {
          log.warn('archive failed', { err: String(err) });
          setArchivingIds((prev) => {
            const next = new Set(prev);
            next.delete(chatId);
            return next;
          });
        });
    },
    [chats, removeChat, archivingIds, activeChatId, setActiveChat],
  );

  const handleNewSession = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      daemonClient.createChat(project.id, 'claude');
    },
    [project.id],
  );

  return (
    <div data-testid={`project-group-${project.id}`}>
      {/* Group header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-mf-input text-mf-label hover:bg-mf-hover/50 transition-colors cursor-pointer"
      >
        {collapsed ? <ChevronRight size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />}
        <div className="flex-1 min-w-0 text-left">
          <span className="text-mf-text-primary truncate block text-mf-small font-medium">{project.name}</span>
          {parentName && (
            <span className="text-mf-status text-mf-text-secondary truncate block">
              {'↳ branch of '}
              {parentName}
            </span>
          )}
        </div>
        <span className="text-mf-status bg-mf-hover text-mf-text-secondary px-1.5 py-0.5 rounded-full shrink-0">
          {chats.length}
        </span>
        <button
          type="button"
          onClick={handleNewSession}
          className="w-6 h-6 rounded-mf-input flex items-center justify-center text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors shrink-0"
          title="New Session"
          aria-label={`New session in ${project.name}`}
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Chat list */}
      {!collapsed && (
        <div className="space-y-0.5 mt-0.5">
          {chats.length === 0 ? (
            <div className="pl-6 py-1 text-mf-status text-mf-text-secondary">No sessions</div>
          ) : (
            chats.map((chat) => (
              <div
                key={chat.id}
                data-testid="chat-list-item"
                onContextMenu={(e) => onContextMenu?.(e, chat.claudeSessionId)}
                title={chat.claudeSessionId ? `Session: ${chat.claudeSessionId}` : undefined}
                className={cn(
                  'group w-full rounded-mf-input transition-colors flex items-center gap-2 ml-2',
                  activeChatId === chat.id ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
                )}
              >
                <button
                  type="button"
                  onClick={() => handleSelectChat(chat.id, chat.title)}
                  className="flex-1 min-w-0 px-3 py-1.5 text-left rounded-mf-input"
                >
                  <div className="flex items-center gap-2">
                    <SessionStatusDot status={chat.displayStatus ?? 'idle'} worktreeMissing={chat.worktreeMissing} />
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
                      <div className="text-mf-status text-mf-text-secondary mt-0.5 flex items-center gap-1">
                        <Bot size={10} className="shrink-0" />
                        <span>{getAdapterLabel(chat.adapterId, adapters)}</span>
                        {chat.worktreePath && (
                          <>
                            <span>{'·'}</span>
                            <GitBranch size={10} className="shrink-0" />
                            <span className="truncate max-w-[100px]" title={chat.worktreePath}>
                              {chat.worktreePath.split('/').pop()}
                            </span>
                          </>
                        )}
                        <span>{'·'}</span>
                        <Clock size={10} className="shrink-0" />
                        <span>{formatRelativeTime(chat.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </button>
                {chat.displayStatus === 'waiting' && (
                  <span className="shrink-0 mr-2 px-2 py-1 rounded-full text-xs font-medium border border-mf-warning text-mf-warning">
                    Waiting
                  </span>
                )}
                <button
                  onClick={(e) => handleArchiveChat(e, chat.id)}
                  disabled={archivingIds.has(chat.id)}
                  className={cn(
                    'mr-2 p-1 rounded text-mf-text-secondary transition-all shrink-0',
                    archivingIds.has(chat.id)
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 hover:bg-mf-hover hover:text-mf-text-primary',
                  )}
                  title="Archive session"
                  aria-label="Archive session"
                >
                  {archivingIds.has(chat.id) ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
