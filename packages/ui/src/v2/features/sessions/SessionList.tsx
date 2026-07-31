import { GitBranchIcon, GitPullRequestIcon, MoreHorizontalIcon } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@v2/components/ui/sidebar';
import { cn } from '@v2/lib/utils';
import { SESSION_GROUPS, STATUS_COLOR, type V2Session } from './fixtures';

interface SessionRowProps {
  session: V2Session;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function SessionRow({ session, isActive, onSelect }: SessionRowProps) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid={`sidebar-session-${session.id}`}
        isActive={isActive}
        tooltip={session.title}
        onClick={() => onSelect(session.id)}
        // The variants reserve pr-8 for an overlaid row action, but this row's
        // meta cluster is in-flow and the action lands on top of it — keeping
        // the reserve would spend the gutter twice and cost the title 24px.
        className="pr-2!"
      >
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATUS_COLOR[session.status])} />
        <span className="min-w-0 flex-1 truncate">{session.title}</span>

        {/* Meta yields to the row action on hover — the same slot, not a second column. */}
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground transition-opacity group-hover/menu-item:opacity-0">
          {session.branch && <GitBranchIcon className="size-3!" />}
          {session.pr && <GitPullRequestIcon className="size-3!" />}
          <span className="text-caption tabular-nums">{session.time}</span>
        </span>
      </SidebarMenuButton>

      <SidebarMenuAction showOnHover data-testid={`sidebar-session-menu-${session.id}`} title="Session actions">
        <MoreHorizontalIcon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

interface SessionListProps {
  projectId: string | null;
  activeId: string;
  onSelect: (id: string) => void;
}

export function SessionList({ projectId, activeId, onSelect }: SessionListProps) {
  const groups = SESSION_GROUPS.map((group) => ({
    ...group,
    sessions: projectId ? group.sessions.filter((s) => s.project === projectId) : group.sessions,
  })).filter((group) => group.sessions.length > 0);

  if (groups.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupContent className="px-2 py-6 text-center text-caption text-muted-foreground">
          No sessions in this project yet.
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  return (
    <>
      {groups.map((group) => (
        <SidebarGroup key={group.label} className="py-0">
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.sessions.map((session) => (
                <SessionRow key={session.id} session={session} isActive={session.id === activeId} onSelect={onSelect} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
