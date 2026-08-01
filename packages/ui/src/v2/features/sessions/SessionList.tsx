/**
 * The grouped session list.
 *
 * Selection, the active highlight and the row actions are all native — this
 * only arranges the groups the view-model produced. Virtualization and sticky
 * headers land with the list group.
 */
import type { TagColor } from '@qlan-ro/mainframe-types';
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu } from '@v2/components/ui/sidebar';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import { SessionRow } from './SessionRow';

const PINNED_GROUP_LABEL = 'Pinned';

interface SessionListProps {
  groups: SessionGroupResult[];
  /** Project id → name, for the hover card. */
  projectNames?: Record<string, string>;
  colorOf?: (name: string) => TagColor;
}

export function SessionList({ groups, projectNames, colorOf }: SessionListProps) {
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
          <SidebarGroupLabel className="pl-2">{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SessionRow
                  key={item.id}
                  item={item}
                  colorOf={colorOf}
                  inPinnedGroup={group.label === PINNED_GROUP_LABEL}
                  projectName={item.custom.projectId ? projectNames?.[item.custom.projectId] : undefined}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
