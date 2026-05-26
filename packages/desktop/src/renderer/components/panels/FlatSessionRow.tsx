import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Archive, FolderGit, GitPullRequest, Loader2, Pencil, Pin, Tag as TagIcon } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { useChatsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { useTagsStore } from '../../store/tags';
import { useAdaptersStore } from '../../store/adapters';
import { daemonClient } from '../../lib/client';
import { archiveChat, renameChat } from '../../lib/api';
import { getAdapterLabel } from '../../lib/adapters';
import { deleteDraft } from '../chat/assistant-ui/composer/composer-drafts.js';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { createLogger } from '../../lib/logger';
import { TagPill } from '../tags/TagPill';
import { TagPopover } from '../tags/TagPopover';

const log = createLogger('renderer:flat-session-row');

function formatRelativeTime(isoString: string): { primary: string; secondary?: string } {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return { primary: 'Today', secondary: time };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return { primary: 'Yesterday', secondary: time };
  if (diffDays < 7) return { primary: date.toLocaleDateString([], { weekday: 'short' }), secondary: time };
  if (diffDays < 14) return { primary: 'Last week' };
  if (date.getFullYear() === now.getFullYear())
    return { primary: date.toLocaleDateString([], { month: 'short', day: 'numeric' }) };
  return { primary: date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) };
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

  const handleRowClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('button, input, a, [role="button"]')) return;
      handleSelect();
    },
    [handleSelect],
  );

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

      const wasActive = activeChatId === chat.id;
      setArchiving(true);
      archiveChat(chat.id, deleteWorktree)
        .then(() => {
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
          setArchiving(false);
        })
        .catch((err) => {
          log.warn('archive failed', { err: String(err) });
          setArchiving(false);
        });
    },
    [chat, chats, removeChat, setActiveChat, activeChatId, archiving],
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
  const prUrl = useChatsStore((s) => {
    const prs = s.detectedPrs.get(chat.id);
    if (!prs || prs.length === 0) return null;
    return (prs.find((p) => p.source === 'created') ?? prs[0])?.url ?? null;
  });
  const prNumber = useChatsStore((s) => {
    const prs = s.detectedPrs.get(chat.id);
    if (!prs || prs.length === 0) return null;
    return (prs.find((p) => p.source === 'created') ?? prs[0])?.number ?? null;
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

  // Keep focus on the rename input across DOM reorders (e.g. list re-sort when
  // a new message bumps this row's updatedAt). Without this, the input loses
  // focus when React moves the row via insertBefore and onBlur would commit.
  useLayoutEffect(() => {
    if (editing && inputRef.current && document.activeElement !== inputRef.current) {
      inputRef.current.focus();
    }
  });

  // Commit on outside pointerdown instead of onBlur — blur fires on programmatic
  // focus loss (list reorder) and would exit edit mode unintentionally.
  useEffect(() => {
    if (!editing) return;
    const onPointerDown = (e: PointerEvent) => {
      const input = inputRef.current;
      if (input && e.target instanceof Node && !input.contains(e.target)) {
        handleCommitRename();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [editing, handleCommitRename]);

  const isActive = activeChatId === chat.id;
  const isWorking = chat.displayStatus === 'working' || chat.displayStatus === 'waiting';

  // Tag popover state
  const [popoverRect, setPopoverRect] = useState<DOMRect | null>(null);
  const tagButtonRef = useRef<HTMLButtonElement>(null);

  const openTagPopover = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopoverRect(rect);
  }, []);

  const closeTagPopover = useCallback(() => setPopoverRect(null), []);

  const registry = useTagsStore((s) => s.registry);
  const adapters = useAdaptersStore((s) => s.adapters);
  const colorOf = useCallback((name: string) => registry.find((t) => t.name === name)?.color ?? 'gray', [registry]);
  const tagNames = chat.tags ?? [];
  const hasTags = tagNames.length > 0;
  const adapterLabel = getAdapterLabel(chat.adapterId, adapters);
  const worktreeName = chat.worktreePath?.split('/').pop();

  // Tag-row overflow uses a +N more popover (computed via ResizeObserver below),
  // not the shared <ScrollRow> primitive. Session rows are dense list items;
  // a horizontal scrollbar inside a list row conflicts with the list's vertical
  // scroll and is fiddly to discover on hover. See
  // docs/superpowers/specs/2026-05-25-visual-glitches-overflow-design.md § Coherence exception.
  // Tag row gets a full-width dedicated row. If pills overflow, hide trailing
  // ones and render a +N overflow pill that opens the existing TagPopover.
  const tagRowRef = useRef<HTMLDivElement>(null);
  const [visibleTagCount, setVisibleTagCount] = useState(tagNames.length);

  useLayoutEffect(() => {
    setVisibleTagCount(tagNames.length);
  }, [tagNames.length]);

  useLayoutEffect(() => {
    const el = tagRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setVisibleTagCount(tagNames.length));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tagNames.length]);

  useLayoutEffect(() => {
    const el = tagRowRef.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 1 && visibleTagCount > 0) {
      setVisibleTagCount((c) => c - 1);
    }
  });

  return (
    <div
      data-testid="chat-list-item"
      onClick={handleRowClick}
      onContextMenu={(e) => onContextMenu?.(e, chat.claudeSessionId, chat.id)}
      className={cn(
        '@container group w-full rounded-mf-input transition-colors cursor-pointer',
        isActive ? 'bg-mf-hover' : 'hover:bg-mf-hover',
      )}
    >
      <div className="grid grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5">
        {/* status dot — vertically centered across title + metadata.
            Hidden when the row's container is too narrow to fit anything
            but the title (see metadata + actions hidden below). */}
        <div className="w-3 h-3 shrink-0 flex items-center justify-center @max-[360px]:hidden">
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

        <div className="min-w-0 space-y-2">
          <div data-testid="session-title-row" className="flex items-center min-w-0 gap-2">
            {/* title + select target. The rename input is rendered as a sibling
                — not a child of <button> — to keep the HTML valid. */}
            {editing ? (
              <div
                className={cn(
                  'min-w-0 flex items-center gap-1.5 min-h-[20px]',
                  hasTags && 'max-w-[50%] @max-[360px]:max-w-full',
                )}
              >
                {chat.pinned && <Pin size={10} className="shrink-0 text-mf-accent" />}
                <input
                  ref={inputRef}
                  data-testid={`chats-session-rename-input-${chat.id}`}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-mf-panel-bg text-sm text-mf-text-primary border border-mf-accent rounded px-1 py-0 outline-none"
                />
              </div>
            ) : (
              <button
                type="button"
                data-testid={`chats-session-select-${chat.id}`}
                onClick={handleSelect}
                className={cn(
                  'min-w-0 text-left flex items-center gap-1.5 min-h-[20px]',
                  hasTags && 'max-w-[50%] @max-[360px]:max-w-full',
                )}
              >
                {chat.pinned && <Pin size={10} className="shrink-0 text-mf-accent" />}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      data-testid="session-title-text"
                      className={cn(
                        'min-w-0 flex-1 truncate text-sm',
                        isActive ? 'text-mf-text-primary font-medium' : 'text-mf-text-secondary',
                        isUnread && !isActive ? 'font-semibold text-mf-text-primary' : '',
                      )}
                    >
                      {chat.title || 'Untitled session'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] whitespace-pre-wrap break-words">
                    {chat.title || 'Untitled session'}
                  </TooltipContent>
                </Tooltip>
              </button>
            )}

            {hasTags && (
              <div
                ref={tagRowRef}
                data-testid="session-row-tags"
                className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden whitespace-nowrap @max-[360px]:hidden"
              >
                {tagNames.slice(0, visibleTagCount).map((name) => (
                  <TagPill key={name} label={name} color={colorOf(name)} variant="row" />
                ))}
                {visibleTagCount < tagNames.length && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="button"
                        onClick={openTagPopover}
                        className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border border-mf-border text-xs font-medium cursor-pointer bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary"
                        aria-label="Show all tags"
                      >
                        +{tagNames.length - visibleTagCount}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Show all tags</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}
          </div>

          {/* metadata row: adapter + worktree + PR. Hidden at narrow widths
              per spec — only the title remains visible. */}
          <div
            data-testid="session-row-metadata"
            className="min-w-0 flex items-center gap-1 flex-wrap @max-[360px]:hidden"
          >
            <span className="shrink-0 text-xs font-medium text-mf-text-secondary opacity-80">{adapterLabel}</span>

            {chat.worktreePath && worktreeName && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    data-testid="worktree-pill"
                    className="shrink-0 inline-flex items-center gap-1 h-[18px] px-1.5 rounded text-[10px] font-medium bg-mf-accent text-white max-w-[180px] min-w-0"
                  >
                    <FolderGit size={10} className="shrink-0" />
                    <span className="min-w-0 truncate">{worktreeName}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{chat.worktreePath}</TooltipContent>
              </Tooltip>
            )}

            {prUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="button"
                    data-testid="pr-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(prUrl, '_blank');
                    }}
                    className="shrink-0 inline-flex items-center gap-1 h-[18px] px-1.5 rounded text-[10px] font-medium cursor-pointer transition-colors bg-[#1a7f37] text-white hover:bg-[#2ea043]"
                    aria-label="Open PR"
                  >
                    <GitPullRequest size={10} className="shrink-0" />
                    <span>#{prNumber}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Open PR</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        <div
          data-testid="session-row-actions"
          className="relative self-center flex items-center justify-end gap-2 shrink-0 @max-[360px]:hidden"
        >
          <div className="h-8 shrink-0 flex items-center justify-end">
            {/* time — visible when not hovered. Compact single-line form:
                if the day-label exists ("Yesterday", "May 4"), prefer that;
                otherwise show the time ("11:29 AM"). Narrow rows can't afford
                a stacked two-line layout — see docs/superpowers/specs/
                2026-05-25-visual-glitches-overflow-design.md. */}
            {(() => {
              const t = formatRelativeTime(chat.updatedAt);
              const label = t.primary || t.secondary || '';
              return (
                <span className="text-xs text-mf-text-secondary tabular-nums whitespace-nowrap leading-tight text-right group-hover:invisible">
                  {label}
                </span>
              );
            })()}

            {/* hover actions overlay (Tag / Rename / Archive) — absolute so the
                action slot doesn't reserve width when not hovered. The time
                element above is `invisible` (not `hidden`) so the row's height
                stays stable as the actions appear. */}
            <div
              className={cn(
                'absolute right-0 top-1/2 -translate-y-1/2 items-center gap-0.5 hidden group-hover:flex bg-mf-hover rounded-mf-input px-0.5',
                archiving && 'flex',
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={tagButtonRef}
                    data-testid={`chats-session-tags-${chat.id}`}
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
                    data-testid={`chats-session-rename-${chat.id}`}
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
                    data-testid={`chats-session-archive-${chat.id}`}
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
          </div>

          {chat.displayStatus === 'waiting' && (
            <span className="shrink-0 px-2 py-1 rounded-full text-xs font-medium border border-mf-warning text-mf-warning">
              Waiting
            </span>
          )}
        </div>
      </div>

      {popoverRect && <TagPopover chatId={chat.id} anchorRect={popoverRect} onClose={closeTagPopover} />}
    </div>
  );
});
