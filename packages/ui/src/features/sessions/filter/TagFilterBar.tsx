/**
 * Tag + synthetic filter bar pinned at the BOTTOM of the sidebar, just above
 * the daemon selector. All in-use tags + synthetic (has-pr/has-worktree)
 * chips render at once, wrapping into a grid; once that grid exceeds
 * TAG_GRID_MAX_HEIGHT_PX (3 rows) it scrolls internally instead of growing
 * further — no "+N more"/"Less" toggle. The scrollbar itself is invisible
 * until hover (globals.css's universal `scrollbar-color: transparent`), so
 * a long tag list doesn't add visible chrome when it's not being scrolled.
 * Reads the in-use tag set from the loaded items and dispatches toggles into
 * the session-filters store.
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
import { TAG_CHIP_STYLE, TAG_CHIP_ACTIVE_STYLE } from '../tags/tag-colors';
import type { TagRegistry } from '../tags/use-tag-registry';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { sidebarIndentPx } from '../../../layout/sidebar-indent';
import { useUiPrefs, isSidebarSectionCollapsed } from '../../../store/ui-prefs';
import { SidebarSectionChevron } from '../../../layout/SidebarSectionChevron';

// 3 rows of h-[20px] pills at gap-1.5 (6px) row spacing: 3*20 + 2*6.
const TAG_GRID_MAX_HEIGHT_PX = 72;

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
  'inline-flex h-[20px] shrink-0 items-center rounded-[11px] px-[9px] text-caption tracking-normal transition-[filter] hover:brightness-95';
const CHIP_ACTIVE = 'font-semibold';
const CHIP_IDLE = 'font-medium';

// Synthetic chips (has-pr/has-worktree) have no per-item identity color, so —
// unlike TagPill — they use a neutral (not hue-tinted) filled pill instead of
// TAG_CHIP_STYLE. text-foreground (not muted-foreground) at rest matches the
// tag pills' full-saturation text weight; no hover: color class, matching
// TagPill's hover (CHIP_BASE's shared hover:brightness-95 filter only — an
// inline `style` color has no hover variant, so TagPill never changes color
// on hover either).
const SYNTHETIC_ACTIVE = 'bg-mf-selection font-semibold text-primary';
const SYNTHETIC_IDLE = 'bg-mf-chip font-medium text-foreground';

/** Color lives in the pill itself (TAG_CHIP_STYLE/TAG_CHIP_ACTIVE_STYLE) —
 *  no separate dot swatch. */
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
      style={active ? TAG_CHIP_ACTIVE_STYLE(color) : TAG_CHIP_STYLE(color)}
      className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE)}
    >
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
      className={cn(CHIP_BASE, active ? SYNTHETIC_ACTIVE : SYNTHETIC_IDLE)}
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
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSidebarSection = useUiPrefs((s) => s.toggleSidebarSection);
  const sectionOpen = !isSidebarSectionCollapsed(collapsedSections, 'tags');

  if (inUse.length === 0 && visibleSynthetic.length === 0) return null;

  return (
    // The gap above this section (the user's requested <GAP>) is a flexible
    // spacer in SessionSidebar.tsx, not a fixed margin here — it needs to
    // absorb leftover vertical space so Tags + the daemon selector stay
    // glued together at the sidebar's bottom regardless of content length.
    <div className="flex flex-col">
      <button
        type="button"
        data-testid="sessions-tags-section-toggle"
        aria-expanded={sectionOpen}
        onClick={() => toggleSidebarSection('tags')}
        style={{ paddingLeft: sidebarIndentPx(0), paddingRight: sidebarIndentPx(0) }}
        className="flex w-full items-center gap-[4px] pb-1 pt-[8px] text-left"
      >
        <SidebarSectionChevron open={sectionOpen} />
        <span className="select-none text-caption font-medium text-muted-foreground">Tags</span>
      </button>
      {sectionOpen && (
        <div style={{ paddingLeft: sidebarIndentPx(1) }}>
          <div
            data-testid="sessions-tag-filter-bar"
            className="flex w-full min-w-0 flex-wrap gap-1.5 overflow-y-auto pr-[12px] pb-[7px]"
            style={{ maxHeight: TAG_GRID_MAX_HEIGHT_PX }}
          >
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
        </div>
      )}
    </div>
  );
}
