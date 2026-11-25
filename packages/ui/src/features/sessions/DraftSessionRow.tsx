/**
 * The synthetic "New Session" row, pinned above the time groups.
 *
 * Purely presentational — the sidebar injects the state. It reads as a session
 * row that hasn't happened yet: the same project letter and title, a
 * fixed "now" for its time, and a discard that takes the time's place on hover.
 *
 * The shipped row carried a second line explaining that the draft clears if you
 * leave. v2 rows are single-line, so that moved to the row's hint.
 */
import type { MouseEvent } from 'react';
import { XIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { FadeLabel } from '@/components/ui/fade-label';
import { SessionProjectTile } from './SessionProjectTile';

interface DraftSessionRowProps {
  /** null for a draft explicitly set to "No project" (todo #346). */
  projectId: string | null;
  projectName: string;
  selected: boolean;
  onSelect: () => void;
  onDiscard: () => void;
}

export function DraftSessionRow({ projectId, projectName, selected, onSelect, onDiscard }: DraftSessionRowProps) {
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
          className="pr-2! pl-1.5 hover:bg-sidebar-accent data-active:bg-chrome-selected data-active:hover:bg-chrome-selected data-active:font-normal"
        >
          <SessionProjectTile projectName={projectId != null ? projectName : undefined} />
          <FadeLabel
            data-testid="sessions-draft-row-title"
            className={cn('flex-1', selected ? 'text-sidebar-foreground' : 'text-sidebar-foreground/85')}
          >
            New Session
          </FadeLabel>
          <span className="sr-only">, {projectName},</span>
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 motion-reduce:transition-none',
              selected ? 'text-sidebar-foreground/80' : 'text-muted-foreground',
            )}
          >
            now
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
