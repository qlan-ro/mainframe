import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { TAG_PALETTE } from '@qlan-ro/mainframe-types';
import { useTagsStore } from '../../store/tags';
import { useChatsStore } from '../../store';
import { updateTag, deleteTag } from '../../lib/api/tags-api';
import { cn } from '../../lib/utils';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:tag-popover');

interface Props {
  chatId: string;
  anchorRect: DOMRect;
  onClose: () => void;
}

export function TagPopover({ chatId, anchorRect, onClose }: Props): React.ReactElement {
  const registry = useTagsStore((s) => s.registry);
  const refreshRegistry = useTagsStore((s) => s.refreshRegistry);
  const applyToChat = useTagsStore((s) => s.applyToChat);

  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const updateChat = useChatsStore((s) => s.updateChat);

  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [registryMenu, setRegistryMenu] = useState<{ x: number; y: number; tagName: string } | null>(null);
  const [recolorPanel, setRecolorPanel] = useState<{ x: number; y: number; tagName: string } | null>(null);

  const allChats = useChatsStore((s) => s.chats);
  const updateChatStore = useChatsStore((s) => s.updateChat);

  useEffect(() => {
    void refreshRegistry();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [refreshRegistry]);

  // Close on outside click
  useEffect(() => {
    function onDocClick(): void {
      onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  const lower = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!lower) return registry;
    return registry.filter((t) => t.name.includes(lower));
  }, [registry, lower]);

  const exactMatch = useMemo(() => registry.some((t) => t.name === lower), [registry, lower]);
  const showCreate = lower.length > 0 && !exactMatch;

  const applied = new Set(chat?.tags ?? []);
  const previousTags = chat?.tags;

  async function commit(nextTags: string[]): Promise<void> {
    if (!chat) return;
    setError(null);
    updateChat({ ...chat, tags: nextTags }); // optimistic
    try {
      await applyToChat(chat.id, nextTags);
    } catch (err) {
      // rollback
      if (previousTags !== undefined) {
        updateChat({ ...chat, tags: previousTags });
      }
      const message = err instanceof Error ? err.message : 'Failed to update tags';
      log.warn('apply tags failed', { err: String(err) });
      setError(message);
    }
  }

  async function toggle(name: string): Promise<void> {
    const next = new Set(applied);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    await commit([...next]);
  }

  async function createAndApply(): Promise<void> {
    if (!lower) return;
    const next = [...(chat?.tags ?? []), lower];
    await commit(next);
    setQuery('');
  }

  async function renameTag(from: string, to: string): Promise<void> {
    setError(null);
    try {
      await updateTag(from, { rename: to });
      for (const c of allChats) {
        if (c.tags?.includes(from)) {
          const next = Array.from(new Set(c.tags.map((t) => (t === from ? to : t))));
          updateChatStore({ ...c, tags: next });
        }
      }
      await refreshRegistry();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
    }
  }

  async function recolorTag(name: string, color: TagColor): Promise<void> {
    setError(null);
    try {
      await updateTag(name, { color });
      await refreshRegistry();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recolor failed');
    }
  }

  async function removeTag(name: string): Promise<void> {
    setError(null);
    try {
      await deleteTag(name);
      for (const c of allChats) {
        if (c.tags?.includes(name)) {
          updateChatStore({ ...c, tags: c.tags.filter((t) => t !== name) });
        }
      }
      await refreshRegistry();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div
      role="dialog"
      style={{ position: 'fixed', left: anchorRect.left, top: anchorRect.bottom + 4 }}
      className="z-50 w-64 rounded-mf-input border border-mf-border bg-mf-panel-bg shadow-lg p-2"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-mf-text-secondary uppercase tracking-wide px-2 py-1">Tag session</div>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && showCreate) void createAndApply();
        }}
        placeholder="# Find or create..."
        className="w-full bg-mf-input-bg text-sm px-2 py-1 rounded outline-none border border-mf-border text-mf-text-primary"
      />
      {error && <div className="text-xs text-mf-destructive px-2 py-1">{error}</div>}
      <div className="max-h-64 overflow-y-auto mt-1">
        {filtered.map((t: Tag) => (
          <button
            key={t.name}
            type="button"
            onClick={() => void toggle(t.name)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setRegistryMenu({ x: e.clientX, y: e.clientY, tagName: t.name });
            }}
            className={cn('w-full flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-mf-hover text-sm')}
          >
            <span className="flex items-center gap-2">
              <span className={cn('w-1.5 h-1.5 rounded-full', `bg-mf-tag-${t.color}`)} />
              <span className="text-mf-text-primary">{t.name}</span>
            </span>
            {applied.has(t.name) && <Check size={12} className="text-mf-accent" />}
          </button>
        ))}
      </div>
      {showCreate && (
        <button
          type="button"
          onClick={() => void createAndApply()}
          className="w-full text-left px-2 py-1 rounded hover:bg-mf-hover text-sm text-mf-text-secondary mt-1 border-t border-mf-border"
        >
          + Create tag &quot;{lower}&quot;
        </button>
      )}
      {registryMenu && (
        <div
          style={{ position: 'fixed', left: registryMenu.x, top: registryMenu.y }}
          className="z-[60] rounded-mf-input border border-mf-border bg-mf-panel-bg shadow-lg p-1 min-w-[140px]"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded hover:bg-mf-hover text-sm text-mf-text-primary"
            onClick={() => {
              const current = registryMenu.tagName;
              setRegistryMenu(null);
              const next = window.prompt(`Rename "${current}" to:`, current);
              if (!next || next.trim() === current) return;
              const trimmed = next.trim();
              if (registry.some((t) => t.name === trimmed)) {
                if (!window.confirm(`Merge "${current}" into "${trimmed}"?`)) return;
              }
              void renameTag(current, trimmed);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded hover:bg-mf-hover text-sm text-mf-text-primary"
            onClick={() => {
              setRecolorPanel({ x: registryMenu.x, y: registryMenu.y, tagName: registryMenu.tagName });
              setRegistryMenu(null);
            }}
          >
            Change color
          </button>
          <button
            type="button"
            className="w-full text-left px-2 py-1 rounded hover:bg-mf-hover text-sm text-mf-destructive"
            onClick={() => {
              const name = registryMenu.tagName;
              setRegistryMenu(null);
              if (!window.confirm(`Delete tag "${name}"? This removes it from all sessions.`)) return;
              void removeTag(name);
            }}
          >
            Delete from all sessions
          </button>
        </div>
      )}
      {recolorPanel && (
        <div
          style={{ position: 'fixed', left: recolorPanel.x, top: recolorPanel.y }}
          className="z-[60] rounded-mf-input border border-mf-border bg-mf-panel-bg shadow-lg p-2"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="text-xs text-mf-text-secondary uppercase tracking-wide px-1 pb-1">
            Recolor &quot;{recolorPanel.tagName}&quot;
          </div>
          <div className="grid grid-cols-5 gap-1">
            {TAG_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Set color ${c}`}
                className={`w-5 h-5 rounded-full bg-mf-tag-${c} hover:scale-110 transition-transform`}
                onClick={() => {
                  const name = recolorPanel.tagName;
                  setRecolorPanel(null);
                  void recolorTag(name, c);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
