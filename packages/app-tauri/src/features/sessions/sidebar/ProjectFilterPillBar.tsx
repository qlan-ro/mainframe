/**
 * ProjectFilterPillBar — "All" + per-project filter pills with attention badges.
 *
 * Collapsible (artboard: COLLAPSE_AT = 2): shows "All" + the first 2 project pills,
 * then a compact accent text control that expands/collapses the rest. View-only
 * (D12): selecting a pill filters but does NOT auto-activate the project's
 * most-recent chat. Attention badge = unread-or-pending count per project. Pills
 * are the shared FilterPill primitive.
 *
 * Includes the dashed "Add project" affordance (artboard 02-chrome.jsx) when an
 * onAddProject handler is provided; the bar stays presentational (no daemon calls).
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { FilterPill } from './FilterPill';
import { ProjectPillContextMenu } from './ProjectPillContextMenu';

const COLLAPSE_AT = 2;

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

  const hiddenCount = Math.max(0, projects.length - COLLAPSE_AT);
  const collapsible = hiddenCount > 0;
  const shownProjects = expanded ? projects : projects.slice(0, COLLAPSE_AT);

  return (
    <div className="flex flex-wrap gap-[4px] px-2.5 pb-1.5 pt-[4px]">
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
      {collapsible && (
        <button
          data-testid="sessions-projects-more"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex shrink-0 items-center px-1 text-caption font-semibold tracking-normal text-primary transition-colors hover:underline"
        >
          {expanded ? 'Less' : `+${hiddenCount} more`}
        </button>
      )}
      {onAddProject != null && (
        <button
          data-testid="sessions-add-project"
          type="button"
          onClick={onAddProject}
          className="inline-flex h-[22px] shrink-0 items-center gap-[5px] rounded-[11px] border border-dashed border-border px-2.5 text-caption font-medium tracking-normal text-mf-text-3 transition-colors hover:border-primary hover:text-foreground"
        >
          <Plus className="size-[12px]" aria-hidden />
          <span>Add project</span>
        </button>
      )}
    </div>
  );
}
