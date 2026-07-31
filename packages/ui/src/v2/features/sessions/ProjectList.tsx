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
import { PROJECTS } from './fixtures';

/** Past this many, the tail collapses behind a "Show N more" row. */
const VISIBLE_LIMIT = 5;

interface ProjectListProps {
  activeId: string | null;
  onSelect: (id: string | null) => void;
}

export function ProjectList({ activeId, onSelect }: ProjectListProps) {
  const [expanded, setExpanded] = useState(false);
  const overflow = PROJECTS.length - VISIBLE_LIMIT;
  const visible = expanded ? PROJECTS : PROJECTS.slice(0, VISIBLE_LIMIT);

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
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-semibold text-white uppercase"
                  style={{ background: project.color }}
                >
                  {project.name[0]}
                </span>
                <span>{project.name}</span>
              </SidebarMenuButton>
              {project.attention > 0 && (
                <SidebarMenuBadge data-testid={`sidebar-project-badge-${project.id}`}>
                  {project.attention}
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
