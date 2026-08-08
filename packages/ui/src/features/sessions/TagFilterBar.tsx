/**
 * The tag filters, in the sidebar footer.
 *
 * A footer component, not a section: the chips label themselves, so a "Tags"
 * title over them says nothing the row doesn't. It sits out of the scroll region
 * for the same reason quota does — a filter you reach for mid-scroll should not
 * have to be scrolled to.
 *
 * Presentational: the sidebar decides which tags are in use, because the same
 * answer decides whether the row renders at all.
 *
 * Only tags actually in use are offered — a filter that can only ever return
 * nothing is noise. Past three rows the grid scrolls instead of growing, so a
 * heavily tagged project can't turn the footer into a wall of chips.
 *
 * Every chip is a `Badge`. The synthetic ones take its variants outright —
 * `secondary` at rest, `default` when active. The tag ones keep an inline style
 * on top, because the ten tag hues are user-assigned values with no token to
 * name; the inline colours simply win over whichever variant carries them.
 */
import type { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { TAG_CHIP_ACTIVE_STYLE, TAG_CHIP_STYLE } from '@/features/sessions/tags/tag-colors';
import { useSessionFilters } from '@/store/session-filters';

/** Three rows of h-5 chips at gap-1.5: 3 × 20 + 2 × 6. */
const GRID_MAX_HEIGHT = 72;

interface TagFilterBarProps {
  /** Tag names actually carried by the visible sessions. */
  inUse: string[];
  synthetic: (typeof SYNTHETIC_TAGS)[number][];
  registry: TagRegistry;
}

export function TagFilterBar({ inUse, synthetic, registry }: TagFilterBarProps) {
  const { selectedTags, selectedSynthetic, toggleTag, toggleSynthetic } = useSessionFilters();

  return (
    <div
      data-testid="sessions-tag-filter-bar"
      className="flex flex-wrap gap-1.5 overflow-y-auto px-2"
      style={{ maxHeight: GRID_MAX_HEIGHT }}
    >
      {inUse.map((name) => (
        <Badge
          key={name}
          asChild
          variant="secondary"
          className="transition-[filter] hover:brightness-95"
          style={
            selectedTags.has(name)
              ? TAG_CHIP_ACTIVE_STYLE(registry.colorOf(name))
              : TAG_CHIP_STYLE(registry.colorOf(name))
          }
        >
          <button
            type="button"
            data-testid={`sessions-tag-filter-${name}`}
            aria-pressed={selectedTags.has(name)}
            onClick={() => toggleTag(name)}
          >
            {name}
          </button>
        </Badge>
      ))}
      {synthetic.map((kind) => (
        <Badge
          key={kind}
          asChild
          variant={selectedSynthetic.has(kind) ? 'default' : 'secondary'}
          className={cn(
            'transition-[filter] hover:brightness-95',
            !selectedSynthetic.has(kind) && 'text-muted-foreground',
          )}
        >
          <button
            type="button"
            data-testid={`sessions-tag-filter-synthetic-${kind}`}
            aria-pressed={selectedSynthetic.has(kind)}
            onClick={() => toggleSynthetic(kind)}
          >
            {kind}
          </button>
        </Badge>
      ))}
    </div>
  );
}
