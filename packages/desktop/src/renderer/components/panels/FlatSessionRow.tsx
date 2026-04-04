import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, FolderOpen, GitBranch, Clock, Loader2, Pencil } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { useChatsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { daemonClient } from '../../lib/client';
import { archiveChat, renameChat } from '../../lib/api';
import { deleteDraft } from '../chat/assistant-ui/composer/composer-drafts.js';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
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
  onContextMenu?: (e: React.MouseEvent, sessionId: string | undefined, chatId?: string) => void;
  registerRenameCallback?: (chatId: string, trigger: () => void) => void;
  unregisterRenameCallback?: (chatId: string) => void;
}

export function FlatSessionRow({
  chat,
  projectName,
  onContextMenu,
  registerRenameCallback,
  unregisterRenameCallback,
}: FlatSessionRowProps): React.ReactElement {
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
          deleteDraft(chat.id);
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
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      setEditTitle(chat.title || '');
      setEditing(true);
      requestAnimationFrame(() => inputRef.current?.select());
    },
    [chat.title],
  );

  useEffect(() => {
    registerRenameCallback?.(chat.id, handleStartRename);
    return () => unregisterRenameCallback?.(chat.id);
  }, [chat.id, handleStartRename, registerRenameCallback, unregisterRenameCallback]);

  const updateChat = useChatsStore((s) => s.updateChat);
  const unreadChatIds = useChatsStore((s) => s.unreadChatIds);
  const isUnread = unreadChatIds.has(chat.id);

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
      onContextMenu={(e) => onContextMenu?.(e, chat.claudeSessionId, chat.id)}
      className={cn(
        'group w-full rounded-mf-input transition-colors flex items-center gap-2',
        isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
      )}
    >
      <button type="button" onClick={handleSelect} className="flex-1 min-w-0 px-3 py-1.5 text-left">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 shrink-0 flex items-center justify-center">
            {chat.worktreeMissing ? (
              <div className="w-2 h-2 rounded-full bg-mf-destructive" />
            ) : isWorking ? (
              <Loader2 size={12} className="text-mf-accent animate-spin" />
            ) : (
              <div
                className={cn('w-2 h-2 rounded-full', isUnread ? 'bg-mf-accent' : 'bg-mf-text-secondary opacity-40')}
              />
            )}
          </div>
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
                  isUnread && !isActive ? 'font-semibold text-mf-text-primary' : '',
                )}
              >
                {chat.title || 'Untitled session'}
              </div>
            )}
            <div className="text-mf-status text-mf-text-secondary mt-0.5 flex items-center gap-1 overflow-hidden">
              {projectName && (
                <>
                  <FolderOpen size={10} className="shrink-0" />
                  <span className="truncate">{projectName}</span>
                  <span className="shrink-0">{'·'}</span>
                </>
              )}
              {chat.worktreePath && (
                <>
                  <GitBranch size={10} className="shrink-0" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate max-w-[100px]" tabIndex={0}>
                        {chat.worktreePath.split('/').pop()}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{chat.worktreePath}</TooltipContent>
                  </Tooltip>
                  <span className="shrink-0">{'·'}</span>
                </>
              )}
              <Clock size={10} className="shrink-0" />
              <span className="shrink-0">{formatRelativeTime(chat.updatedAt)}</span>
            </div>
          </div>
        </div>
      </button>
      {chat.displayStatus === 'waiting' && (
        <span className="shrink-0 mr-2 px-2 py-1 rounded-full text-xs font-medium border border-mf-warning text-mf-warning">
          Waiting
        </span>
      )}
      <div className={cn('shrink-0 mr-1 flex items-center gap-0.5', archiving ? 'flex' : 'hidden group-hover:flex')}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStartRename}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
              aria-label="Rename session"
            >
              <Pencil size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Rename session</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleArchive}
              disabled={archiving}
              className={cn(
                'w-6 h-6 rounded flex items-center justify-center text-mf-text-secondary transition-colors shrink-0',
                archiving ? '' : 'hover:bg-mf-hover hover:text-mf-text-primary',
              )}
              aria-label="Archive session"
            >
              {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
            </button>
          </TooltipTrigger>
          <TooltipContent>Archive session</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
