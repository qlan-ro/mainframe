/**
 * ProjectFilterPillBar — "All" + per-project filter pills with attention badges.
 *
 * Collapsible by available width (not a hardcoded count): the row fills with as
 * many project pills as fit on a single line, then a compact accent "+N more"
 * control — placed AFTER the "Add project" affordance — expands/collapses the
 * rest. Expanding wraps the bar to multiple lines. View-only (D12): selecting a
 * pill filters but does NOT auto-activate the project's most-recent chat.
 * Attention badge = unread-or-pending count per project. Pills are the shared
 * FilterPill primitive.
 *
 * Includes the dashed "Add project" affordance (artboard 02-chrome.jsx) when an
 * onAddProject handler is provided; the bar stays presentational (no daemon calls).
 */
import { useState } from 'react';
import { ChevronDown, FolderPlus } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { FilterPill } from './FilterPill';
import { ProjectPillContextMenu } from './ProjectPillContextMenu';
import { useRowOverflow } from '../use-row-overflow';

const ROW_GAP_PX = 4;

interface ProjectFilterPillBarProps {
  projects: Project[];
  filterProjectId: string | null;
  attentionCounts: Record<string, number>;
  onSelect: (projectId: string | null) => void;
  onRemoveProject?: (project: Project) => void;
  onAddProject?: () => void;
}

export function ProjectFilterPillBar({
  projects,
  filterProjectId,
  attentionCounts,
  onSelect,
  onRemoveProject,
  onAddProject,
}: ProjectFilterPillBarProps) {
  const [expanded, setExpanded] = useState(false);
  const totalAttn = Object.values(attentionCounts).reduce((a, b) => a + b, 0);

  // Re-measure only on width-affecting changes: the project set, whether each
  // pill shows a badge at all (0↔non-0), whether the "All" pill shows its total
  // badge, and the add-project affordance. The EXACT count and the active
  // styling don't change a pill's width, so excluding them keeps a plain pill
  // click (which only flips active state / re-tallies counts) off the measuring
  // path — previously every click and every unread tick forced a full re-measure.
  const allBadge = filterProjectId != null && totalAttn > 0;
  const signature = `${allBadge ? 'A' : ''}|${projects
    .map((p) => `${p.id}:${(attentionCounts[p.id] ?? 0) > 0 ? '1' : '0'}`)
    .join(',')}|${onAddProject != null ? 'add' : ''}`;
  const { containerRef, visibleCount, measuring } = useRowOverflow({
    itemCount: projects.length,
    leadingCount: 1, // the "All" pill
    trailingCount: onAddProject != null ? 1 : 0, // the "Add project" affordance
    gapPx: ROW_GAP_PX,
    signature,
  });

  const showAll = measuring || expanded;
  const shownProjects = showAll ? projects : projects.slice(0, visibleCount);
  const overflow = visibleCount < projects.length;
  const hiddenCount = projects.length - visibleCount;
  const collapsible = measuring || overflow;
  const moreLabel = measuring ? `+${projects.length} more` : expanded ? 'Less' : `+${hiddenCount} more`;

  return (
    <div
      ref={containerRef}
      className={`flex w-full min-w-0 items-center gap-[4px] px-2.5 pb-1.5 pt-[4px] ${expanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}
    >
      <FilterPill
        label="All"
        active={filterProjectId == null}
        testId="sessions-filter-pill-all"
        badgeCount={filterProjectId == null ? 0 : totalAttn}
        badgeTestId="sessions-filter-pill-attn-all"
        onClick={() => onSelect(null)}
      />
      {shownProjects.map((p) => {
        const active = filterProjectId === p.id;
        const selectProject = () => onSelect(active ? null : p.id);
        if (onRemoveProject != null) {
          return (
            <ProjectPillContextMenu
              key={p.id}
              project={p}
              active={active}
              badgeCount={attentionCounts[p.id] ?? 0}
              badgeTestId={`sessions-filter-pill-attn-${p.id}`}
              onSelect={selectProject}
              onRemoveProject={onRemoveProject}
            />
          );
        }
        return (
          <FilterPill
            key={p.id}
            label={p.name}
            active={active}
            testId={`sessions-filter-pill-${p.id}`}
            badgeCount={attentionCounts[p.id] ?? 0}
            badgeTestId={`sessions-filter-pill-attn-${p.id}`}
            onClick={selectProject}
          />
        );
      })}
      {onAddProject != null && (
        <button
          data-testid="sessions-add-project"
          type="button"
          onClick={onAddProject}
          className="inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-[11px] border border-dashed border-mf-border-hover px-2.5 text-caption font-semibold tracking-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <FolderPlus className="size-[12px]" aria-hidden />
          <span>Add project</span>
        </button>
      )}
      {collapsible && (
        <button
          data-testid="sessions-projects-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center gap-[3px] px-1 text-caption font-semibold tracking-normal text-primary transition-colors hover:underline"
        >
          {moreLabel}
          {expanded && <ChevronDown className="size-[10px] rotate-180" aria-hidden />}
        </button>
      )}
    </div>
  );
}
