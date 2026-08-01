/**
 * The tag filters, at the foot of the sidebar.
 *
 * Only tags actually in use are offered — a filter that can only ever return
 * nothing is noise. Past three rows the grid scrolls instead of growing, so a
 * heavily tagged project can't push the session list off the panel.
 *
 * Tag pills carry their own hue as an inline style (the ten tag colors are
 * values, not theme tokens); the synthetic chips have no identity color, so
 * they take the neutral chip and go solid when active.
 */
import { ChevronRightIcon } from 'lucide-react';
import { SYNTHETIC_TAGS } from '@qlan-ro/mainframe-types';
import { cn } from '@v2/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@v2/components/ui/collapsible';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from '@v2/components/ui/sidebar';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { hasSynthetic, tagsInUse } from '@/features/sessions/filter/tags-in-use';
import { TAG_CHIP_ACTIVE_STYLE, TAG_CHIP_STYLE } from '@/features/sessions/tags/tag-colors';
import type { TagRegistry } from '@/features/sessions/tags/use-tag-registry';
import { isSidebarSectionCollapsed, useUiPrefs } from '@/store/ui-prefs';
import { useSessionFilters } from '@/store/session-filters';

/** Three rows of h-5 chips at gap-1.5: 3 × 20 + 2 × 6. */
const GRID_MAX_HEIGHT = 72;

const CHIP =
  'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-xs font-medium transition-[filter] hover:brightness-95';

interface TagFilterBarProps {
  items: SessionItem[];
  filterProjectId: string | null;
  registry: TagRegistry;
}

export function TagFilterBar({ items, filterProjectId, registry }: TagFilterBarProps) {
  const { selectedTags, selectedSynthetic, toggleTag, toggleSynthetic } = useSessionFilters();
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSection = useUiPrefs((s) => s.toggleSidebarSection);
  const open = !isSidebarSectionCollapsed(collapsedSections, 'tags');

  const inUse = tagsInUse(items, filterProjectId);
  const synthetic = SYNTHETIC_TAGS.filter((kind) => hasSynthetic(items, kind));

  if (inUse.length === 0 && synthetic.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={() => toggleSection('tags')} className="group/tags shrink-0">
      <SidebarGroup className="py-0">
        <SidebarGroupLabel asChild className="pl-2">
          <CollapsibleTrigger data-testid="sessions-tags-section-toggle">
            <ChevronRightIcon className="transition-transform group-data-open/tags:rotate-90" />
            Tags
          </CollapsibleTrigger>
        </SidebarGroupLabel>

        <CollapsibleContent>
          <SidebarGroupContent
            data-testid="sessions-tag-filter-bar"
            className="flex flex-wrap gap-1.5 overflow-y-auto pt-1 pr-3 pb-2 pl-5"
            style={{ maxHeight: GRID_MAX_HEIGHT }}
          >
            {inUse.map((name) => (
              <button
                key={name}
                type="button"
                data-testid={`sessions-tag-filter-${name}`}
                aria-pressed={selectedTags.has(name)}
                onClick={() => toggleTag(name)}
                style={
                  selectedTags.has(name)
                    ? TAG_CHIP_ACTIVE_STYLE(registry.colorOf(name))
                    : TAG_CHIP_STYLE(registry.colorOf(name))
                }
                className={CHIP}
              >
                {name}
              </button>
            ))}
            {synthetic.map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`sessions-tag-filter-synthetic-${kind}`}
                aria-pressed={selectedSynthetic.has(kind)}
                onClick={() => toggleSynthetic(kind)}
                className={cn(
                  CHIP,
                  selectedSynthetic.has(kind)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground',
                )}
              >
                {kind}
              </button>
            ))}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
