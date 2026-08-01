import { useState } from 'react';
import { LayersIcon, PlusIcon } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@v2/components/ui/sidebar';
import type { Project } from '@qlan-ro/mainframe-types';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from './ProjectAvatar';

/** Past this many, the tail collapses behind a "Show N more" row. */
const VISIBLE_LIMIT = 5;

interface ProjectListProps {
  projects: Project[];
  /** Per-project count of sessions wanting attention; 0 hides the badge. */
  attention: Record<string, number>;
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export function ProjectList({ projects, attention, activeId, onSelect }: ProjectListProps) {
  const [expanded, setExpanded] = useState(false);
  const overflow = projects.length - VISIBLE_LIMIT;
  const visible = expanded ? projects : projects.slice(0, VISIBLE_LIMIT);

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarGroupAction data-testid="sidebar-project-add" title="Add project">
        <PlusIcon />
      </SidebarGroupAction>

      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="sidebar-project-all"
              isActive={activeId === null}
              tooltip="All projects"
              onClick={() => onSelect(null)}
            >
              <LayersIcon className="text-muted-foreground" />
              <span>All projects</span>
            </SidebarMenuButton>
          </SidebarMenuItem>

          {visible.map((project) => (
            <SidebarMenuItem key={project.id}>
              <SidebarMenuButton
                data-testid={`sidebar-project-${project.id}`}
                isActive={activeId === project.id}
                tooltip={project.name}
                onClick={() => onSelect(project.id)}
              >
                <ProjectAvatar name={project.name} color={projectColor(project.id)} />
                <span>{project.name}</span>
              </SidebarMenuButton>
              {(attention[project.id] ?? 0) > 0 && (
                <SidebarMenuBadge data-testid={`sidebar-project-badge-${project.id}`}>
                  {attention[project.id]}
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          ))}

          {overflow > 0 && (
            <SidebarMenuItem>
              <SidebarMenuButton
                data-testid="sidebar-project-more"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setExpanded((value) => !value)}
              >
                <span>{expanded ? 'Show less' : `Show ${overflow} more`}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
