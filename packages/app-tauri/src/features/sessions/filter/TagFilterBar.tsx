/**
 * Wrapping, collapsible tag + synthetic filter bar pinned at the BOTTOM of the
 * sidebar (artboard "Tag filter row … sits above bottom panel"). Wraps to
 * multiple lines and collapses to the first 4 tags with a compact "+N more"/
 * "Less" text control (synthetic has-pr/has-worktree chips reveal when expanded) — no
 * horizontal scroll. Reads the in-use tag set from the loaded items and
 * dispatches toggles into the session-filters store.
 *
 * Color swatches use an inline style from tag-colors.ts — never a
 * `bg-mf-tag-*` utility, which has no token in app-tauri's globals.css and
 * would silently render nothing (MEMORY Tailwind trap).
 */
import React, { useState } from 'react';
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

const CHIP_BASE =
  'inline-flex h-[20px] shrink-0 items-center gap-[5px] rounded-[11px] px-[9px] text-caption tracking-normal transition-colors';
const CHIP_ACTIVE = 'bg-mf-selection font-semibold text-primary';
const CHIP_IDLE = 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground';

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
      <span className="size-[6px] rounded-full" style={TAG_DOT_STYLE(color)} aria-hidden="true" />
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
      <span className="size-1.5 shrink-0 rounded-full bg-mf-text-3" aria-hidden="true" />
      {SYNTHETIC_LABELS[kind]}
    </button>
  );
}

export function TagFilterBar({ items, filterProjectId, registry }: Props): React.ReactElement | null {
  const selectedTags = useSessionFilters((s) => s.selectedTags);
  const selectedSynthetic = useSessionFilters((s) => s.selectedSynthetic);
  const toggleTag = useSessionFilters((s) => s.toggleTag);
  const toggleSynthetic = useSessionFilters((s) => s.toggleSynthetic);

  const [expanded, setExpanded] = useState(false);

  const inUse = tagsInUse(items, filterProjectId);
  const visibleSynthetic = SYNTHETIC_TAGS.filter((kind) => hasSynthetic(items, kind));

  if (inUse.length === 0 && visibleSynthetic.length === 0) return null;

  const COLLAPSE_AT = 4;
  const shownTags = expanded ? inUse : inUse.slice(0, COLLAPSE_AT);
  const hiddenCount = Math.max(0, inUse.length - COLLAPSE_AT) + visibleSynthetic.length;
  const collapsible = hiddenCount > 0;

  return (
    <div
      data-testid="sessions-tag-filter-bar"
      className="flex flex-shrink-0 flex-wrap items-center gap-1.5 border-t-[0.5px] border-border/75 px-[12px] pb-[7px] pt-1.5"
    >
      <span className="shrink-0 select-none text-micro font-semibold uppercase tracking-wide text-mf-text-3">
        Tags
      </span>
      {shownTags.map((name) => (
        <TagPill
          key={name}
          name={name}
          active={selectedTags.has(name)}
          color={registry.colorOf(name)}
          onClick={() => toggleTag(name)}
        />
      ))}
      {expanded &&
        visibleSynthetic.map((kind) => (
          <SyntheticChip
            key={kind}
            kind={kind}
            active={selectedSynthetic.has(kind)}
            onClick={() => toggleSynthetic(kind)}
          />
        ))}
      {collapsible && (
        <button
          type="button"
          data-testid="sessions-tag-filter-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center px-1 text-caption font-semibold tracking-normal text-primary transition-colors hover:underline"
        >
          {expanded ? 'Less' : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
