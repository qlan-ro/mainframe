/**
 * The list's filter, on the first group header: what to show by status, then
 * the tags in use. Only tags actually in use are offered — a filter that can
 * only return nothing is noise. Tag picks AND together and the menu stays open
 * across them (multi-select).
 *
 * An active filter keeps the button on screen, in blue (L4); its tooltip and
 * accessible name say what is filtered, and "Clear filters" drops it all.
 *
 * Presentational over `useSessionFilters`; the sidebar decides which tags are
 * in use, because the same answer decides whether a synthetic kind is offered.
 */
import type { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { ListFilterIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import type { StatusFilter } from '@/features/sessions/filter/apply-session-filters';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';
import { JUMP_ACTION } from '@/features/shared/SidebarJumpSection';
import { useSessionFilters } from '@/store/session-filters';

interface SessionsFilterMenuProps {
  /** Tag names actually carried by the visible sessions. */
  inUse: string[];
  synthetic: (typeof SYNTHETIC_TAGS)[number][];
  registry: TagRegistry;
}

const STATUS_FILTERS: readonly { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All sessions' },
  { id: 'running', label: 'Running' },
  { id: 'needs-you', label: 'Needs you' },
];

/** The button's tooltip and accessible name: the action, then what is filtered. */
export function filterButtonLabel(status: StatusFilter, tags: readonly string[]): string {
  const statusLabel = STATUS_FILTERS.find((f) => f.id === status)?.label;
  const active = [...(status === 'all' || statusLabel == null ? [] : [statusLabel]), ...tags];
  return active.length === 0 ? 'Filter sessions' : `Filter sessions: ${active.join(', ')}`;
}

export function SessionsFilterMenu({ inUse, synthetic, registry }: SessionsFilterMenuProps) {
  const { statusFilter, setStatusFilter, selectedTags, selectedSynthetic, toggleTag, toggleSynthetic } =
    useSessionFilters();
  const selected = [...selectedTags, ...selectedSynthetic];
  const active = statusFilter !== 'all' || selected.length > 0;
  const label = filterButtonLabel(statusFilter, selected);
  const clear = () => {
    setStatusFilter('all');
    for (const name of selectedTags) toggleTag(name);
    for (const kind of selectedSynthetic) toggleSynthetic(kind);
  };

  return (
    <DropdownMenu>
      {/* Hint WRAPS the trigger — inside it, TooltipTrigger's asChild would
          swallow the menu's own ref and onClick. */}
      <Hint label={label}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="sessions-filter-button"
            data-filtered={active || undefined}
            aria-label={label}
            className={cn(JUMP_ACTION, active && 'text-primary opacity-100 hover:text-primary')}
          >
            <ListFilterIcon />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent data-testid="sessions-tag-filter-bar" align="end" sideOffset={6} className="w-48">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          {STATUS_FILTERS.map((filter) => (
            <DropdownMenuRadioItem
              key={filter.id}
              data-testid={`sessions-status-filter-${filter.id}`}
              value={filter.id}
              // preventDefault keeps the menu open: a filter is several picks.
              onSelect={(e) => e.preventDefault()}
            >
              {filter.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {(inUse.length > 0 || synthetic.length > 0) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Tags</DropdownMenuLabel>
          </>
        )}
        {inUse.map((name) => (
          <DropdownMenuCheckboxItem
            key={name}
            data-testid={`sessions-tag-filter-${name}`}
            checked={selectedTags.has(name)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggleTag(name)}
          >
            {/* Inline style, not a utility: the tag palette is user-assigned, so it has no token to name. */}
            <span className="inline-block size-2 shrink-0 rounded-full" style={TAG_DOT_STYLE(registry.colorOf(name))} />
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
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="sessions-tag-filter-clear" onSelect={clear}>
              Clear filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
