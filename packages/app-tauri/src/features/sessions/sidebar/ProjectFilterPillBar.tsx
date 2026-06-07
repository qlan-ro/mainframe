/**
 * ProjectFilterPillBar — "All" + per-project filter pills with attention badges.
 *
 * Collapsible (artboard: COLLAPSE_AT = 2): shows "All" + the first 2 project pills,
 * then a "+N more" / "Less" toggle pill that expands/collapses the rest. View-only
 * (D12): selecting a pill filters but does NOT auto-activate the project's
 * most-recent chat. Attention badge = unread-or-pending count per project. Pills
 * are the shared FilterPill primitive.
 *
 * NOTE: the artboard also shows a dashed "Add project" button here; that needs the
 * add-project flow (not yet ported) and is intentionally deferred — out of scope.
 */
import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { FilterPill } from './FilterPill';

const COLLAPSE_AT = 2;

interface ProjectFilterPillBarProps {
  projects: Project[];
  filterProjectId: string | null;
  attentionCounts: Record<string, number>;
  onSelect: (projectId: string | null) => void;
}

export function ProjectFilterPillBar({
  projects,
  filterProjectId,
  attentionCounts,
  onSelect,
}: ProjectFilterPillBarProps) {
  const [expanded, setExpanded] = useState(false);
  const totalAttn = Object.values(attentionCounts).reduce((a, b) => a + b, 0);

  const hiddenCount = Math.max(0, projects.length - COLLAPSE_AT);
  const collapsible = hiddenCount > 0;
  const shownProjects = expanded ? projects : projects.slice(0, COLLAPSE_AT);

  return (
    <div className="flex flex-wrap gap-1 px-2.5 pb-1.5 pt-1">
      <FilterPill
        label="All"
        active={filterProjectId == null}
        testId="sessions-filter-pill-all"
        badgeCount={filterProjectId == null ? 0 : totalAttn}
        badgeTestId="sessions-filter-pill-attn-all"
        onClick={() => onSelect(null)}
      />
      {shownProjects.map((p) => (
        <FilterPill
          key={p.id}
          label={p.name}
          active={filterProjectId === p.id}
          testId={`sessions-filter-pill-${p.id}`}
          badgeCount={attentionCounts[p.id] ?? 0}
          badgeTestId={`sessions-filter-pill-attn-${p.id}`}
          onClick={() => onSelect(filterProjectId === p.id ? null : p.id)}
        />
      ))}
      {collapsible && (
        <button
          data-testid="sessions-projects-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-[11px] bg-accent px-2.5 text-[11px] font-semibold tracking-[-0.05px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronDownIcon className="size-[9px] flex-shrink-0 rotate-180 text-mf-text-3" />
              Less
            </>
          ) : (
            `+${hiddenCount} more`
          )}
        </button>
      )}
    </div>
  );
}
