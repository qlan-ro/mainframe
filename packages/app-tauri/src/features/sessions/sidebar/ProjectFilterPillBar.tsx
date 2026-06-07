/**
 * ProjectFilterPillBar — "All" + per-project filter pills with attention badges.
 * View-only (D12): selecting a pill filters but does NOT auto-activate the
 * project's most-recent chat. Attention badge = unread-or-pending count per project.
 * Pills are the shared FilterPill primitive.
 */
import type { Project } from '@qlan-ro/mainframe-types';
import { FilterPill } from './FilterPill';

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
  const totalAttn = Object.values(attentionCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 py-1.5">
      <FilterPill
        label="All"
        active={filterProjectId == null}
        testId="sessions-filter-pill-all"
        badgeCount={filterProjectId == null ? 0 : totalAttn}
        badgeTestId="sessions-filter-pill-attn-all"
        onClick={() => onSelect(null)}
      />
      {projects.map((p) => (
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
    </div>
  );
}
