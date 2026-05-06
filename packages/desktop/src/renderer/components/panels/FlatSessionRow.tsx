import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, GitBranch, GitPullRequest, Loader2, Pencil, Pin, Tag as TagIcon } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { useChatsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { useTagsStore } from '../../store/tags';
import { daemonClient } from '../../lib/client';
import { archiveChat, renameChat } from '../../lib/api';
import { deleteDraft } from '../chat/assistant-ui/composer/composer-drafts.js';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { createLogger } from '../../lib/logger';
import { TagPill } from '../tags/TagPill';
import { TagPopover } from '../tags/TagPopover';

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
  registerOpenTagPopover?: (chatId: string, trigger: (rect: DOMRect) => void) => void;
  unregisterOpenTagPopover?: (chatId: string) => void;
}

export const FlatSessionRow = React.memo(function FlatSessionRow({
  chat,
  projectName: _projectName,
  onContextMenu,
  registerRenameCallback,
  unregisterRenameCallback,
  registerOpenTagPopover,
  unregisterOpenTagPopover,
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

  const addChat = useChatsStore((s) => s.addChat);

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

      // Optimistically remove the chat from the UI immediately so switching to
      // another session is never blocked by the in-flight archive HTTP request.
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

      setArchiving(true);
      archiveChat(chat.id, deleteWorktree)
        .then(() => {
          setArchiving(false);
        })
        .catch((err) => {
          log.warn('archive failed', { err: String(err) });
          // Restore the chat to the store so the user can retry.
          addChat(chat);
          setArchiving(false);
        });
    },
    [chat, chats, removeChat, addChat, setActiveChat, activeChatId, archiving],
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

  useEffect(() => {
    registerOpenTagPopover?.(chat.id, (rect) => setPopoverRect(rect));
    return () => unregisterOpenTagPopover?.(chat.id);
  }, [chat.id, registerOpenTagPopover, unregisterOpenTagPopover]);

  const updateChat = useChatsStore((s) => s.updateChat);
  const unreadChatIds = useChatsStore((s) => s.unreadChatIds);
  const isUnread = unreadChatIds.has(chat.id);
  const createdPrUrl = useChatsStore((s) => {
    const prs = s.detectedPrs.get(chat.id);
    return prs?.find((p) => p.source === 'created')?.url ?? null;
  });

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

  // Tag popover state
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  const tagButtonRef = useRef<HTMLButtonElement>(null);
  const tagRowRef = useRef<HTMLDivElement>(null);

  const openTagPopover = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverRect(rect);
  }, []);

  const closeTagPopover = useCallback(() => setPopoverRect(null), []);

  const registry = useTagsStore((s) => s.registry);
  const colorOf = useCallback((name: string) => registry.find((t) => t.name === name)?.color ?? 'gray', [registry]);

  return (
    <div
      data-testid="chat-list-item"
      onContextMenu={(e) => onContextMenu?.(e, chat.claudeSessionId, chat.id)}
      className={cn('group w-full rounded-mf-input transition-colors', isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover')}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* status dot */}
        <div className="w-3 h-3 shrink-0 flex items-center justify-center">
          {chat.worktreeMissing ? (
            <div className="w-2 h-2 rounded-full bg-mf-destructive" />
          ) : isWorking ? (
            <Loader2 size={12} className="text-mf-accent animate-spin" />
          ) : (
            <div
              className={cn('w-2 h-2 rounded-full', isUnread ? 'bg-mf-accent' : 'bg-mf-text-secondary')}
              style={!isUnread ? { opacity: 0.4 } : undefined}
            />
          )}
        </div>

        {/* title + select target */}
        <button
          type="button"
          onClick={handleSelect}
          className="flex-1 min-w-0 text-left flex items-center gap-1.5 min-h-[20px]"
        >
          {chat.pinned && <Pin size={10} className="shrink-0 text-mf-accent" />}
          {editing ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleCommitRename}
              onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-mf-panel-bg text-sm text-mf-text-primary border border-mf-accent rounded px-1 py-0 outline-none"
            />
          ) : (
            <span
              className={cn(
                'truncate text-sm',
                isActive ? 'text-mf-text-primary font-medium' : 'text-mf-text-secondary',
                isUnread && !isActive ? 'font-semibold text-mf-text-primary' : '',
              )}
            >
              {chat.title || 'Untitled session'}
            </span>
          )}
        </button>

        {/* worktree pill */}
        {chat.worktreePath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-mf-input-bg border border-mf-border font-mono text-xs text-mf-text-secondary max-w-[140px] truncate"
                tabIndex={0}
              >
                <GitBranch size={10} className="shrink-0" />
                {chat.worktreePath.split('/').pop()}
              </span>
            </TooltipTrigger>
            <TooltipContent>{chat.worktreePath}</TooltipContent>
          </Tooltip>
        )}

        {/* PR badge */}
        {createdPrUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(createdPrUrl, '_blank');
                }}
                className="shrink-0 text-[#1a7f37] hover:opacity-70 cursor-pointer"
                aria-label="Open PR"
              >
                <GitPullRequest size={12} />
              </span>
            </TooltipTrigger>
            <TooltipContent>Open PR</TooltipContent>
          </Tooltip>
        )}

        {/* time — visible when not hovered */}
        <span className="shrink-0 text-xs text-mf-text-secondary tabular-nums group-hover:hidden">
          {formatRelativeTime(chat.updatedAt)}
        </span>

        {/* hover actions (Tag / Rename / Archive) */}
        <div className={cn('shrink-0 items-center gap-0.5 hidden group-hover:flex', archiving && 'flex')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={tagButtonRef}
                onClick={openTagPopover}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                aria-label="Edit tags"
              >
                <TagIcon size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Tags</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleStartRename}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                aria-label="Rename session"
              >
                <Pencil size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Rename</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className={cn(
                  'w-6 h-6 rounded flex items-center justify-center text-mf-text-secondary transition-colors',
                  archiving ? '' : 'hover:bg-mf-hover hover:text-mf-text-primary',
                )}
                aria-label="Archive session"
              >
                {archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
              </button>
            </TooltipTrigger>
            <TooltipContent>Archive</TooltipContent>
          </Tooltip>
        </div>

        {chat.displayStatus === 'waiting' && (
          <span className="shrink-0 px-2 py-1 rounded-full text-xs font-medium border border-mf-warning text-mf-warning">
            Waiting
          </span>
        )}
      </div>

      {/* tag row — visible if has tags, OR on hover (with ghost when empty) */}
      <div
        ref={tagRowRef}
        onClick={openTagPopover}
        className={cn(
          'items-center gap-1 px-3 pb-1.5 flex-wrap',
          chat.tags && chat.tags.length > 0 ? 'flex' : 'hidden group-hover:flex',
        )}
      >
        {(chat.tags ?? []).map((name) => (
          <TagPill key={name} label={name} color={colorOf(name)} variant="row" />
        ))}
        {(!chat.tags || chat.tags.length === 0) && (
          <span className="text-xs text-mf-text-secondary opacity-60">+ tag</span>
        )}
      </div>

      {popoverRect && <TagPopover chatId={chat.id} anchorRect={popoverRect} onClose={closeTagPopover} />}
    </div>
  );
});
