/**
 * The synthetic "New Session" row, pinned above the time groups.
 *
 * Purely presentational — the sidebar injects the state. It reads as a session
 * row that hasn't happened yet: the provider mark is a hollow dashed dot, the
 * relative time is a fixed "now", and the trailing slot swaps to a discard on
 * hover the way a real row's meta yields to its actions.
 *
 * The shipped row carried a second line explaining that the draft clears if you
 * leave. v2 rows are single-line, so that moved to the row's hint.
 */
import type { MouseEvent } from 'react';
import { XIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { ProjectAvatar } from './ProjectAvatar';

/** Level 2 — the same rung as the session rows it sits above. */
const ROW_INDENT = 'pl-2';

interface DraftSessionRowProps {
  projectId: string;
  projectName: string;
  selected: boolean;
  /** True in "All" view, where the row has to say which project it belongs to. */
  showProject: boolean;
  onSelect: () => void;
  onDiscard: () => void;
}

export function DraftSessionRow({
  projectId,
  projectName,
  selected,
  showProject,
  onSelect,
  onDiscard,
}: DraftSessionRowProps) {
  const discard = (e: MouseEvent) => {
    // The row is the select target; the discard must not also open the draft.
    e.stopPropagation();
    e.preventDefault();
    onDiscard();
  };

  return (
    <SidebarMenuItem>
      <Hint label="Draft — clears if you leave without sending">
        <SidebarMenuButton
          data-testid="sessions-draft-row"
          size="sm"
          isActive={selected}
          onClick={onSelect}
          className={cn(ROW_INDENT, 'pr-2! data-active:bg-sidebar-selection')}
        >
          {/* Same 24px slot as StatusDot, so the titles line up with real rows. */}
          <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center">
            <span
              className={cn(
                'size-2 rounded-full border-[1.5px] border-dashed',
                selected ? 'border-primary' : 'border-muted-foreground',
              )}
            />
          </span>
          <span
            data-testid="sessions-draft-row-title"
            className={cn(
              'min-w-0 flex-1 truncate group-data-active/menu-item:text-primary',
              selected ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            New Session
          </span>
          <span className="flex shrink-0 items-center gap-1.5 transition-opacity group-hover/menu-item:opacity-0">
            {showProject && <ProjectAvatar name={projectName} color={projectColor(projectId)} size={14} />}
            <span className="tabular-nums">now</span>
          </span>
        </SidebarMenuButton>
      </Hint>
      <SidebarMenuAction
        showOnHover
        data-testid="sessions-draft-row-discard"
        aria-label="Discard draft"
        onClick={discard}
      >
        <XIcon />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}
