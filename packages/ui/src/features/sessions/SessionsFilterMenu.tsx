/**
 * SessionsFilterMenu — the tag filter, on the first group header (replaces
 * the footer's chip wall). Only tags actually in use are offered — a filter
 * that can only return nothing is noise. Picks AND together, as the chips
 * did; the menu stays open across picks (multi-select). The active filter
 * reads back as one `primary` chip beside the button: the tag's name alone,
 * or "N filters" when several are on; the chip clears them.
 *
 * Presentational over `useSessionFilters`; the sidebar decides which tags are
 * in use, because the same answer decides whether the row renders at all.
 */
import type { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { ListFilterIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';
import { useSessionFilters } from '@/store/session-filters';

interface SessionsFilterMenuProps {
  /** Tag names actually carried by the visible sessions. */
  inUse: string[];
  synthetic: (typeof SYNTHETIC_TAGS)[number][];
  registry: TagRegistry;
}

/** The chip's label: the lone filter's name, else a count. */
export function filterChipLabel(selected: readonly string[]): string | null {
  if (selected.length === 0) return null;
  return selected.length === 1 ? (selected[0] ?? null) : `${selected.length} filters`;
}

export function SessionsFilterMenu({ inUse, synthetic, registry }: SessionsFilterMenuProps) {
  const { selectedTags, selectedSynthetic, toggleTag, toggleSynthetic } = useSessionFilters();
  const selected = [...selectedTags, ...selectedSynthetic];
  const chip = filterChipLabel(selected);
  const clear = () => {
    for (const name of selectedTags) toggleTag(name);
    for (const kind of selectedSynthetic) toggleSynthetic(kind);
  };

  return (
    <>
      {chip != null && (
        <Hint label="Clear tag filters">
          <Badge asChild className="h-5 cursor-pointer">
            <button type="button" data-testid="sessions-filter-chip" aria-label={`Filters: ${chip}`} onClick={clear}>
              {chip}
            </button>
          </Badge>
        </Hint>
      )}
      <DropdownMenu>
        {/* Hint WRAPS the trigger — inside it, TooltipTrigger's asChild would
            swallow the menu's own ref and onClick. */}
        <Hint label="Filter by tag">
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="sessions-filter-button"
              aria-label="Filter by tag"
              className={cn('size-5', chip != null && 'text-primary')}
            >
              <ListFilterIcon />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent data-testid="sessions-tag-filter-bar" align="end" sideOffset={6} className="w-48">
          <DropdownMenuLabel>Filter by tag</DropdownMenuLabel>
          {inUse.map((name) => (
            <DropdownMenuCheckboxItem
              key={name}
              data-testid={`sessions-tag-filter-${name}`}
              checked={selectedTags.has(name)}
              // preventDefault keeps the menu open: a filter is several picks.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => toggleTag(name)}
            >
              {/* Inline style, not a utility: the tag palette is user-assigned, so it has no token to name. */}
              <span
                className="inline-block size-2 shrink-0 rounded-full"
                style={TAG_DOT_STYLE(registry.colorOf(name))}
              />
              <span className="min-w-0 flex-1 truncate">{name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {synthetic.map((kind) => (
            <DropdownMenuCheckboxItem
              key={kind}
              data-testid={`sessions-tag-filter-synthetic-${kind}`}
              checked={selectedSynthetic.has(kind)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => toggleSynthetic(kind)}
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{kind}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {selected.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="sessions-tag-filter-clear" onSelect={clear}>
                Clear filters
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
