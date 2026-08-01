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
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import { deriveSessionBadge, type SessionBase } from '@/features/sessions/view-model/session-status';
import { isSessionUnreadById } from '@/features/sessions/view-model/session-unread';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';

/**
 * Stock ships one semantic hue — `destructive`. Green-for-working and
 * amber-for-waiting have no equivalent, so the states separate on the accent's
 * intensity instead of on hue, per the locked "collapse to stock" decision.
 */
const STATUS_COLOR: Record<SessionBase, string> = {
  working: 'bg-primary',
  waiting: 'bg-primary/40',
  'worktree-missing': 'bg-destructive',
  'transcript-missing': 'bg-destructive',
  idle: 'bg-muted-foreground/40',
};

interface SessionRowProps {
  item: SessionItem;
  isActive: boolean;
  unread: boolean;
  now: number;
  onSelect: (id: string) => void;
}

function SessionRow({ item, isActive, unread, now, onSelect }: SessionRowProps) {
  const badge = deriveSessionBadge(item.custom, unread);
  const title = item.title ?? 'Untitled session';

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        data-testid={`sidebar-session-${item.id}`}
        isActive={isActive}
        tooltip={title}
        onClick={() => onSelect(item.id)}
        // The variants reserve pr-8 for an overlaid row action, but this row's
        // meta cluster is in-flow and the action lands on top of it — keeping
        // the reserve would spend the gutter twice and cost the title 24px.
        className="pr-2!"
      >
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', STATUS_COLOR[badge.base])} />
        <span className={cn('min-w-0 flex-1 truncate', unread && 'font-semibold text-foreground')}>{title}</span>

        {/* Meta yields to the row action on hover — the same slot, not a second column. */}
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground transition-opacity group-hover/menu-item:opacity-0">
          {item.custom.worktreePath && <GitBranchIcon className="size-3!" />}
          {item.custom.detectedPrs.length > 0 && <GitPullRequestIcon className="size-3!" />}
          <span className="text-xs tabular-nums">{formatRelativeTime(item.custom.updatedAt, now)}</span>
        </span>
      </SidebarMenuButton>

      <SidebarMenuAction showOnHover data-testid={`sidebar-session-menu-${item.id}`} title="Session actions">
        <MoreHorizontalIcon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

interface SessionListProps {
  groups: SessionGroupResult[];
  activeId: string | null;
  isUnread: (id: string) => boolean;
  onSelect: (id: string) => void;
}

export function SessionList({ groups, activeId, isUnread, onSelect }: SessionListProps) {
  const now = Date.now();

  if (groups.length === 0) {
    return (
      <SidebarGroup>
        <SidebarGroupContent
          data-testid="sidebar-sessions-empty"
          className="px-2 py-6 text-center text-xs text-muted-foreground"
        >
          No sessions yet.
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
              {group.items.map((item) => (
                <SessionRow
                  key={item.id}
                  item={item}
                  isActive={item.id === activeId}
                  unread={isSessionUnreadById(item, isUnread)}
                  now={now}
                  onSelect={onSelect}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
