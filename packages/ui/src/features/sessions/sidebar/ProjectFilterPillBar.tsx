/**
 * ProjectFilterPillBar — the one-click project switcher list (2026-07 rebuild).
 *
 * Was a horizontal pill-cloud (width-measured overflow via useRowOverflow);
 * is now a vertical list: an "All" row (clears the filter) atop one
 * row per project (colored initial avatar + name + attention badge), a plain
 * single-select switch — clicking a row always narrows to that project;
 * only "All" clears it (no toggle-to-deselect, unlike the old pill
 * bar). Collapsible past DEFAULT_VISIBLE_PROJECTS via a count-based "Show N
 * more"/"Show less" toggle — no width measurement needed for a vertical list.
 * "Add project" is the first row in the section (header → create action →
 * list, matching Sessions/Tasks), name kept the same (`sessions-add-project`)
 * for e2e/page-object compatibility.
 *
 * Right-click management (rename disabled / remove) is unchanged — still
 * ProjectPillContextMenu, restyled from a pill to a full-width row.
 */
import { useState } from 'react';
import { FolderPlus, LayoutGrid } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { CountBadge } from '@/components/ui/count-badge';
import { useUiPrefs, isSidebarSectionCollapsed } from '@/store/ui-prefs';
import { SidebarSectionChevron } from '@/layout/SidebarSectionChevron';
import { ProjectPillContextMenu } from './ProjectPillContextMenu';
import { projectColor } from './project-color';
import { sidebarIndentPx, SIDEBAR_INDENT_STEP_PX } from '@/layout/sidebar-indent';

const DEFAULT_VISIBLE_PROJECTS = 3;

interface ProjectFilterPillBarProps {
  projects: Project[];
  filterProjectId: string | null;
  attentionCounts: Record<string, number>;
  onSelect: (projectId: string | null) => void;
  onRemoveProject?: (project: Project) => void;
  onAddProject?: () => void;
}

/** Level 0 section title — matches SessionsGroupHeader/TasksSidebarSection's header treatment. */
function ProjectsGroupHeader({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="sessions-projects-section-toggle"
      aria-expanded={open}
      onClick={onToggle}
      style={{ paddingLeft: sidebarIndentPx(0), paddingRight: sidebarIndentPx(0) }}
      className="flex w-full items-center gap-[4px] pb-1 pt-[8px] text-left"
    >
      <SidebarSectionChevron open={open} />
      <span className="text-caption font-medium text-muted-foreground">Projects</span>
    </button>
  );
}

function AllProjectsRow({ active, totalAttn, onSelect }: { active: boolean; totalAttn: number; onSelect: () => void }) {
  return (
    <button
      data-testid="sessions-filter-pill-all"
      aria-pressed={active}
      type="button"
      onClick={onSelect}
      className={[
        'flex h-[28px] w-full items-center gap-[9px] rounded-md px-[12px] text-label font-medium tracking-normal transition-colors',
        active ? 'bg-mf-selection text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {/* Neutral grid-icon avatar (same 18px footprint as ProjectAvatar,
          untinted since "All" isn't tied to one project's color) so the
          row lines up with the project name text below it. */}
      <span
        className="inline-flex size-[18px] flex-shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <LayoutGrid className="size-[11px]" />
      </span>
      <span>All</span>
      <div className="flex-1" />
      {active && totalAttn > 0 && (
        <CountBadge count={totalAttn} variant="unread" data-testid="sessions-filter-pill-attn-all" />
      )}
    </button>
  );
}

function AddProjectRow({ onAddProject }: { onAddProject: () => void }) {
  return (
    <button
      data-testid="sessions-add-project"
      type="button"
      onClick={onAddProject}
      className="flex h-[28px] w-full items-center gap-[9px] rounded-md px-[12px] text-label font-medium tracking-normal text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {/* 18px box (matches ProjectAvatar/the "All" spacer) so the
          icon is centered in the same footprint an avatar occupies, and
          "Add project" lines up with the project name text below it. */}
      <span className="inline-flex size-[18px] flex-shrink-0 items-center justify-center" aria-hidden="true">
        <FolderPlus className="size-[13px]" />
      </span>
      <span>Add project</span>
    </button>
  );
}

function ShowMoreToggle({
  expanded,
  hiddenCount,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  return (
    <button
      data-testid="sessions-projects-more"
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      // px-[12px] (not px-2/4px): matches SIDEBAR_BASE_INSET_PX, keeping this
      // row's content at the same Level-1 position as its sibling rows.
      className="flex h-[24px] w-full items-center px-[12px] text-caption font-semibold tracking-normal text-primary transition-colors hover:underline"
    >
      {expanded ? 'Show less' : `Show ${hiddenCount} more`}
    </button>
  );
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
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSidebarSection = useUiPrefs((s) => s.toggleSidebarSection);
  const sectionOpen = !isSidebarSectionCollapsed(collapsedSections, 'projects');

  const collapsible = projects.length > DEFAULT_VISIBLE_PROJECTS;
  const shownProjects = expanded || !collapsible ? projects : projects.slice(0, DEFAULT_VISIBLE_PROJECTS);
  const hiddenCount = projects.length - shownProjects.length;

  return (
    <>
      <ProjectsGroupHeader open={sectionOpen} onToggle={() => toggleSidebarSection('projects')} />
      {sectionOpen && (
        <div
          className="flex w-full flex-col gap-[2px] pr-2 pb-1.5 pt-[4px]"
          style={{ paddingLeft: SIDEBAR_INDENT_STEP_PX }}
        >
          {/* Add Project first, matching Sessions/Tasks: header → the section's
              "create new" action → its list content. */}
          {onAddProject != null && <AddProjectRow onAddProject={onAddProject} />}
          <AllProjectsRow active={filterProjectId == null} totalAttn={totalAttn} onSelect={() => onSelect(null)} />
          {shownProjects.map((p) => (
            <ProjectPillContextMenu
              key={p.id}
              project={p}
              active={filterProjectId === p.id}
              badgeCount={attentionCounts[p.id] ?? 0}
              badgeTestId={`sessions-filter-pill-attn-${p.id}`}
              avatarColor={projectColor(p.id)}
              onSelect={() => onSelect(p.id)}
              onRemoveProject={onRemoveProject}
            />
          ))}
          {collapsible && (
            <ShowMoreToggle expanded={expanded} hiddenCount={hiddenCount} onToggle={() => setExpanded((v) => !v)} />
          )}
        </div>
      )}
    </>
  );
}
