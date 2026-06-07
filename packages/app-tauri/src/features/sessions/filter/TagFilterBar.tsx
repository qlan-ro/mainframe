/**
 * Horizontal scrollable tag + synthetic filter bar shown below the project
 * pill bar. Reads the in-use tag set from the loaded items and dispatches
 * toggles into the session-filters store.
 *
 * Color swatches use an inline style from tag-colors.ts — never a
 * `bg-mf-tag-*` utility, which has no token in app-tauri's globals.css and
 * would silently render nothing (MEMORY Tailwind trap).
 */
import React from 'react';
import type { SyntheticTag } from '@qlan-ro/mainframe-types';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { cn } from '../../../lib/utils';
import { useSessionFilters } from '../../../store/session-filters';
import { tagsInUse, hasSynthetic } from './tags-in-use';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import type { TagRegistry } from '../tags/use-tag-registry';
import type { SessionItem } from '../view-model/chat-to-thread-custom';

interface Props {
  items: SessionItem[];
  filterProjectId: string | null;
  registry: TagRegistry;
}

const SYNTHETIC_LABELS: Record<SyntheticTag, string> = {
  'has-pr': 'has-pr',
  'has-worktree': 'has-worktree',
};

const CHIP_BASE = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs transition-colors shrink-0 border';
const CHIP_ACTIVE = 'bg-mf-selection text-primary border-transparent';
const CHIP_IDLE = 'bg-mf-chip text-muted-foreground hover:bg-accent hover:text-accent-foreground border-transparent';

function TagPill({
  name,
  active,
  color,
  onClick,
}: {
  name: string;
  active: boolean;
  color: ReturnType<TagRegistry['colorOf']>;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={`sessions-tag-filter-${name}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE)}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={TAG_DOT_STYLE(color)} aria-hidden="true" />
      {name}
    </button>
  );
}

function SyntheticChip({
  kind,
  active,
  onClick,
}: {
  kind: SyntheticTag;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={`sessions-tag-filter-synthetic-${kind}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE)}
    >
      {SYNTHETIC_LABELS[kind]}
    </button>
  );
}

export function TagFilterBar({ items, filterProjectId, registry }: Props): React.ReactElement | null {
  const selectedTags = useSessionFilters((s) => s.selectedTags);
  const selectedSynthetic = useSessionFilters((s) => s.selectedSynthetic);
  const toggleTag = useSessionFilters((s) => s.toggleTag);
  const toggleSynthetic = useSessionFilters((s) => s.toggleSynthetic);

  const inUse = tagsInUse(items, filterProjectId);
  const visibleSynthetic = SYNTHETIC_TAGS.filter((kind) => hasSynthetic(items, kind));

  if (inUse.length === 0 && visibleSynthetic.length === 0) return null;

  return (
    <div
      data-testid="sessions-tag-filter-bar"
      className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border overflow-x-auto scrollbar-none"
    >
      <span className="text-xs text-mf-text-3 uppercase tracking-wide shrink-0 select-none">Tags</span>
      {inUse.map((name) => (
        <TagPill
          key={name}
          name={name}
          active={selectedTags.has(name)}
          color={registry.colorOf(name)}
          onClick={() => toggleTag(name)}
        />
      ))}
      {visibleSynthetic.map((kind) => (
        <SyntheticChip
          key={kind}
          kind={kind}
          active={selectedSynthetic.has(kind)}
          onClick={() => toggleSynthetic(kind)}
        />
      ))}
    </div>
  );
}
