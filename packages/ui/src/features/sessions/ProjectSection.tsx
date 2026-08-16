/**
 * The projects switcher section.
 *
 * Two independent collapses, as shipped: the section itself (persisted in
 * ui-prefs, shared with the other sidebar sections) and a local "Show N more"
 * tail past the first few projects. The list is vertical, so the tail is a
 * plain count — no width measurement.
 */
import { useState } from 'react';
import { FolderPlus, LayoutGridIcon } from 'lucide-react';
import type { Project } from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Hint } from '@/components/ui/hint';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { isSidebarSectionCollapsed, useUiPrefs } from '@/store/ui-prefs';
import { AllProjectsRow, ProjectRow } from './ProjectRow';

/** Past this many, the tail collapses behind a "Show N more" row. */
const VISIBLE_LIMIT = 3;

interface ProjectSectionProps {
  projects: Project[];
  /** Per-project count of sessions wanting attention; 0 hides the badge. */
  attention: Record<string, number>;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onRemoveProject?: (project: Project) => void;
  onAddProject?: () => void;
}

export function ProjectSection({
  projects,
  attention,
  activeId,
  onSelect,
  onRemoveProject,
  onAddProject,
}: ProjectSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const collapsedSections = useUiPrefs((s) => s.collapsedSidebarSections);
  const toggleSection = useUiPrefs((s) => s.toggleSidebarSection);
  const open = !isSidebarSectionCollapsed(collapsedSections, 'projects');

  const collapsible = projects.length > VISIBLE_LIMIT;
  const visible = expanded || !collapsible ? projects : projects.slice(0, VISIBLE_LIMIT);
  const hidden = projects.length - visible.length;
  const totalAttention = Object.values(attention).reduce((a, b) => a + b, 0);

  return (
    <Collapsible open={open} onOpenChange={() => toggleSection('projects')}>
      {/* p-0: this section lives in SidebarHeader, which already supplies the 8px
          inset. Keeping the group's own padding would double it and push the
          switcher a rung deeper than every label below it. */}
      <SidebarGroup className="p-0">
        <SidebarGroupLabel asChild className="pl-2">
          <CollapsibleTrigger data-testid="sidebar-projects-toggle">Projects</CollapsibleTrigger>
        </SidebarGroupLabel>
        {onAddProject != null && (
          <Hint label="Add project">
            {/* top/right retuned: stock's offsets assume the group's own p-2,
                which this section drops in favour of the header's inset. */}
            {/* FolderPlus, matching the first-run hero's Add-project CTA. */}
            <SidebarGroupAction
              data-testid="sidebar-projects-add"
              data-tut="add-project"
              className="top-1 right-0"
              onClick={onAddProject}
            >
              <FolderPlus />
              <span className="sr-only">Add project</span>
            </SidebarGroupAction>
          </Hint>
        )}

        <CollapsibleContent>
          <SidebarGroupContent>
            <SidebarMenu>
              <AllProjectsRow
                active={activeId === null}
                attention={totalAttention}
                icon={<LayoutGridIcon className="size-3" />}
                onSelect={() => onSelect(null)}
              />
              {visible.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  active={activeId === project.id}
                  attention={attention[project.id] ?? 0}
                  onSelect={() => onSelect(project.id)}
                  onRemove={onRemoveProject == null ? undefined : () => onRemoveProject(project)}
                />
              ))}
              {collapsible && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-testid="sidebar-project-more"
                    size="sm"
                    aria-expanded={expanded}
                    className="pl-8 text-primary hover:bg-transparent hover:underline"
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? 'Show less' : `Show ${hidden} more`}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
