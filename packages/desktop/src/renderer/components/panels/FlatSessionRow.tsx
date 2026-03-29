import React, { useCallback, useRef, useState } from 'react';
import { Archive, FolderOpen, GitBranch, Clock, Loader2, Pencil } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { useChatsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { daemonClient } from '../../lib/client';
import { archiveChat, renameChat } from '../../lib/api';
import { cn } from '../../lib/utils';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:flat-session-row');

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

interface FlatSessionRowProps {
  chat: Chat;
  projectName?: string;
  onContextMenu?: (e: React.MouseEvent, sessionId: string | undefined) => void;
}

export function FlatSessionRow({ chat, projectName, onContextMenu }: FlatSessionRowProps): React.ReactElement {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chats = useChatsStore((s) => s.chats);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const removeChat = useChatsStore((s) => s.removeChat);

  const handleSelect = useCallback(() => {
    setActiveChat(chat.id);
    useTabsStore.getState().openChatTab(chat.id, chat.title);
    daemonClient.resumeChat(chat.id);
  }, [chat.id, chat.title, setActiveChat]);

  const [archiving, setArchiving] = useState(false);

  const handleArchive = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (archiving) return;
      let deleteWorktree = true;
      if (chat.worktreePath) {
        const choice = window.confirm(
          `This session has a worktree at:\n${chat.worktreePath}\n\nOK = Archive and delete worktree\nCancel = Archive only (keep worktree)`,
        );
        deleteWorktree = choice;
      }
      setArchiving(true);
      archiveChat(chat.id, deleteWorktree)
        .then(() => {
          const wasActive = activeChatId === chat.id;
          removeChat(chat.id);
          useTabsStore.getState().closeTab(`chat:${chat.id}`);
          if (wasActive) {
            const next = chats
              .filter((c) => c.id !== chat.id && c.projectId === chat.projectId)
              .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
            if (next) {
              setActiveChat(next.id);
              useTabsStore.getState().openChatTab(next.id, next.title);
            }
          }
        })
        .catch((err) => {
          log.warn('archive failed', { err: String(err) });
          setArchiving(false);
        });
    },
    [chat.id, chat.projectId, chat.worktreePath, chats, removeChat, setActiveChat, activeChatId, archiving],
  );

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setEditTitle(chat.title || '');
      setEditing(true);
      requestAnimationFrame(() => inputRef.current?.select());
    },
    [chat.title],
  );

  const updateChat = useChatsStore((s) => s.updateChat);

  const handleCommitRename = useCallback(() => {
    setEditing(false);
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== chat.title) {
      updateChat({ ...chat, title: trimmed });
      useTabsStore.getState().updateTabLabel(`chat:${chat.id}`, trimmed);
      renameChat(chat.id, trimmed).catch((err) => log.warn('rename failed', { err: String(err) }));
    }
  }, [chat, editTitle, updateChat]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleCommitRename();
      if (e.key === 'Escape') setEditing(false);
    },
    [handleCommitRename],
  );

  const isActive = activeChatId === chat.id;
  const isWorking = chat.displayStatus === 'working' || chat.displayStatus === 'waiting';

  return (
    <div
      data-testid="chat-list-item"
      onContextMenu={(e) => onContextMenu?.(e, chat.claudeSessionId)}
      title={chat.claudeSessionId ? `Session: ${chat.claudeSessionId}` : undefined}
      className={cn(
        'group w-full rounded-mf-input transition-colors flex items-center gap-2',
        isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
      )}
    >
      <button type="button" onClick={handleSelect} className="flex-1 min-w-0 px-3 py-1.5 text-left">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-2 h-2 rounded-full shrink-0',
              chat.worktreeMissing
                ? 'bg-mf-destructive'
                : isWorking
                  ? 'bg-mf-accent animate-pulse motion-reduce:animate-none'
                  : 'bg-mf-text-secondary opacity-40',
            )}
          />
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                ref={inputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleCommitRename}
                onKeyDown={handleRenameKeyDown}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-mf-panel-bg text-mf-small text-mf-text-primary border border-mf-accent rounded px-1 py-0 outline-none"
              />
            ) : (
              <div
                className={cn(
                  'text-mf-small truncate',
                  isActive ? 'text-mf-text-primary font-medium' : 'text-mf-text-secondary',
                )}
              >
                {chat.title || 'New Chat'}
              </div>
            )}
            <div className="text-mf-status text-mf-text-secondary mt-0.5 flex items-center gap-1">
              {projectName && (
                <>
                  <FolderOpen size={10} className="shrink-0" />
                  <span className="truncate max-w-[100px]" title={projectName}>
                    {projectName}
                  </span>
                  <span>{'·'}</span>
                </>
              )}
              {chat.worktreePath && (
                <>
                  <GitBranch size={10} className="shrink-0" />
                  <span className="truncate max-w-[100px]" title={chat.worktreePath}>
                    {chat.worktreePath.split('/').pop()}
                  </span>
                  <span>{'·'}</span>
                </>
              )}
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
        onClick={handleStartRename}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-all shrink-0"
        title="Rename session"
        aria-label="Rename session"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={handleArchive}
        disabled={archiving}
        className={cn(
          'mr-2 p-1 rounded text-mf-text-secondary transition-all shrink-0',
          archiving ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:bg-mf-hover hover:text-mf-text-primary',
        )}
        title="Archive session"
        aria-label="Archive session"
      >
        {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
      </button>
    </div>
  );
}
