/**
 * Tag management popover — apply/unapply/create plus registry rename/recolor/
 * delete with the §5.5 cascade-mirror.
 *
 * Decomposed (H9): registry right-click menu → TagRegistryItemMenu; recolor →
 * TagRecolorPanel; cascade math → buildTagCascade. This file keeps apply/create,
 * the registry list, an inline rename input (SessionRowRename interaction
 * shape), and a shadcn confirm dialog for delete.
 *
 * Cascade invariant (spec §5.5):
 *   rename + delete → onCascade([{id, newTags}]) for affected threads.
 *   recolor          → registry-only; onCascade is NOT called.
 * onCascade is WIRED BY PHASE 8 (setChatTags + local custom patch per update).
 *
 * Swatches/dots paint via inline style (tag-colors.ts) — never bg-mf-tag-*.
 *
 * NOTE: The delete Dialog is rendered as a sibling of the Popover (not inside
 * PopoverContent) to avoid nested Radix FocusScope recursion in jsdom.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger, PopoverAnchor } from '../../../components/ui/popover';
import { Input } from '../../../components/ui/input';
import { MenuLabel, MenuSearchField, MenuCheckRow, MenuRow, MenuDivider } from '../../../components/ui/menu';
import { setChatTags } from '../../../lib/api/tags';
import { validateTagName, tagNameErrorMessage } from './validate-tag-name';
import { buildTagCascade, type ThreadTagSnapshot, type TagCascadeUpdate } from './build-tag-cascade';
import { TagRegistryItemMenu } from './TagRegistryItemMenu';
import { TagRecolorPanel } from './TagRecolorPanel';
import { TagDeleteConfirm } from './TagDeleteConfirm';
import { TAG_DOT_STYLE } from './tag-colors';
import type { TagRegistry } from './use-tag-registry';

interface Props {
  open: boolean;
  onClose: () => void;
  chatId: string;
  port: number;
  currentTags: string[];
  registry: TagRegistry;
  threads: ThreadTagSnapshot[];
  onCascade: (updates: TagCascadeUpdate[]) => void;
  onReload?: () => void;
  /** Viewport rect of the trigger button — used to anchor the Radix popover when
   *  the host is mounted away from the trigger (no PopoverTrigger child). */
  anchorRect?: DOMRect | null;
  children?: React.ReactNode;
}

export function TagPopover({
  open,
  onClose,
  chatId,
  port,
  currentTags,
  registry,
  threads,
  onCascade,
  onReload,
  anchorRect,
  children,
}: Props): React.ReactElement {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [recoloring, setRecoloring] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setError(null);
    setRenaming(null);
    setRecoloring(null);
    setConfirmDelete(null);
    requestAnimationFrame(() => searchRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (renaming) requestAnimationFrame(() => renameRef.current?.focus());
  }, [renaming]);

  const lower = query.trim().toLowerCase();
  const nameError = lower.length > 0 ? validateTagName(lower) : null;
  const exactMatch = registry.tags.some((t) => t.name === lower);
  const showCreate = lower.length > 0 && !exactMatch && nameError === null;
  const filtered = lower ? registry.tags.filter((t) => t.name.includes(lower)) : registry.tags;
  const applied = new Set(currentTags);

  async function toggle(name: string): Promise<void> {
    setError(null);
    const next = new Set(applied);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    try {
      await setChatTags(port, chatId, [...next]);
      onReload?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tags');
      console.warn('[tag-popover] toggle failed', err);
    }
  }

  async function createAndApply(): Promise<void> {
    if (!lower || nameError !== null) return;
    setError(null);
    try {
      await registry.create(lower, undefined);
      await setChatTags(port, chatId, [...applied, lower]);
      setQuery('');
      onReload?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      console.warn('[tag-popover] create failed', err);
    }
  }

  async function commitRename(from: string): Promise<void> {
    const to = renameValue.trim().toLowerCase();
    setRenaming(null);
    if (!to || to === from || validateTagName(to) !== null) return;
    setError(null);
    try {
      await registry.update(from, { rename: to });
      const updates = buildTagCascade(threads, from, to);
      if (updates.length > 0) onCascade(updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed');
      console.warn('[tag-popover] rename failed', err);
    }
  }

  async function recolor(name: string, color: TagColor): Promise<void> {
    setRecoloring(null);
    setError(null);
    try {
      await registry.update(name, { color }); // registry-only — NO cascade (§5.5)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recolor failed');
      console.warn('[tag-popover] recolor failed', err);
    }
  }

  async function remove(name: string): Promise<void> {
    setConfirmDelete(null);
    setError(null);
    try {
      await registry.remove(name);
      const updates = buildTagCascade(threads, name, null);
      if (updates.length > 0) onCascade(updates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      console.warn('[tag-popover] delete failed', err);
    }
  }

  // When the delete dialog is open, keep the popover closed to avoid nested
  // Radix FocusScope conflicts (two focus-trapping layers recurse in jsdom).
  const popoverOpen = open && confirmDelete === null;

  return (
    <>
      <Popover
        open={popoverOpen}
        onOpenChange={(o) => {
          if (!o && confirmDelete === null) onClose();
        }}
      >
        {anchorRect && (
          <PopoverAnchor
            style={{
              position: 'fixed',
              left: anchorRect.left,
              top: anchorRect.bottom,
              width: anchorRect.width,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        )}
        {children && <PopoverTrigger asChild>{children}</PopoverTrigger>}
        <PopoverContent data-testid="sessions-tag-popover" className="w-64" align="start">
          <MenuLabel>Tags</MenuLabel>
          <MenuSearchField
            data-testid="sessions-tag-popover-search"
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setError(null);
            }}
            inputRef={searchRef}
            placeholder="Find or create..."
            onKeyDown={(e) => {
              // Escape: let Radix Popover handle close (fires onOpenChange → onClose).
              // Do NOT call onClose() here — the Popover's onOpenChange does it,
              // and a direct call would trigger onClose twice.
              if (e.key === 'Enter' && showCreate) void createAndApply();
            }}
          />
          {lower.length > 0 && nameError !== null && (
            <div className="text-caption text-destructive px-2 py-1">{tagNameErrorMessage(nameError)}</div>
          )}
          {error && (
            <div data-testid="sessions-tag-popover-error" className="text-caption text-destructive px-2 py-1">
              {error}
            </div>
          )}
          <div className="max-h-56 overflow-y-auto mt-1">
            {filtered.map((t) =>
              renaming === t.name ? (
                <Input
                  key={t.name}
                  ref={renameRef}
                  data-testid="sessions-tag-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename(t.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commitRename(t.name);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setRenaming(null);
                    }
                  }}
                  className="h-8 text-body my-0.5"
                />
              ) : (
                <TagRegistryItemMenu
                  key={t.name}
                  tagName={t.name}
                  onRename={(n) => {
                    setRenameValue(n);
                    setRenaming(n);
                  }}
                  onRecolor={(n) => setRecoloring(n)}
                  onDelete={(n) => setConfirmDelete(n)}
                >
                  <MenuCheckRow
                    data-testid={`sessions-tag-toggle-${t.name}`}
                    data-tag-row={t.name}
                    checked={applied.has(t.name)}
                    onClick={() => void toggle(t.name)}
                    swatch={
                      <span
                        className="size-1.5 shrink-0 rounded-full"
                        style={TAG_DOT_STYLE(t.color)}
                        aria-hidden="true"
                      />
                    }
                    label={
                      <span data-testid={`sessions-tag-registry-row-${t.name}`} className="text-foreground">
                        {t.name}
                      </span>
                    }
                  />
                </TagRegistryItemMenu>
              ),
            )}
          </div>
          {showCreate && (
            <>
              <MenuDivider />
              <MenuRow
                data-testid="sessions-tag-popover-create"
                icon={<Plus className="text-primary" />}
                label={`Create tag "${lower}"`}
                onClick={() => void createAndApply()}
              />
            </>
          )}
          {recoloring && (
            <div className="mt-1">
              <TagRecolorPanel
                tagName={recoloring}
                onPick={(c) => void recolor(recoloring, c)}
                onClose={() => setRecoloring(null)}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
      {/* TagDeleteConfirm is a sibling of Popover, not nested inside PopoverContent,
          to avoid nested Radix FocusScope conflicts (two focus-trapping layers recurse). */}
      <TagDeleteConfirm
        tagName={confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={(name) => void remove(name)}
      />
    </>
  );
}
