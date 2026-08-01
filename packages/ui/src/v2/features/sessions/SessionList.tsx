/**
 * The grouped session list.
 *
 * Selection, the active highlight and the row actions are all native — this
 * only feeds the windowed list the groups the view-model produced.
 */
import type { TagColor } from '@qlan-ro/mainframe-types';
import { SidebarGroup, SidebarGroupContent } from '@v2/components/ui/sidebar';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import { SessionListVirtuoso } from './SessionListVirtuoso';
import { SessionRow } from './SessionRow';

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
    <SessionListVirtuoso
      groups={groups}
      renderItem={(item, { inPinnedGroup }) => (
        <SessionRow
          item={item}
          colorOf={colorOf}
          inPinnedGroup={inPinnedGroup}
          projectName={item.custom.projectId ? projectNames?.[item.custom.projectId] : undefined}
        />
      )}
    />
  );
}
