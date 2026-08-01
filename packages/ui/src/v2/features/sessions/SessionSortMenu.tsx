/**
 * The Sessions section's sort control.
 *
 * A radio group rather than the shipped hand-rolled check rows — the modes are
 * mutually exclusive, which is what `DropdownMenuRadioGroup` already encodes,
 * including the roving focus and the ARIA the check rows never had.
 */
import { ArrowUpDownIcon } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
import { SidebarGroupAction } from '@v2/components/ui/sidebar';
import { SESSION_SORTS, type SortMode } from '@/features/sessions/view-model/group-sessions';

interface SessionSortMenuProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
  /** Placement within the section header, which owns the action row. */
  className?: string;
}

export function SessionSortMenu({ mode, onChange, className }: SessionSortMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarGroupAction
          data-testid="sessions-sort-button"
          aria-label="Sort sessions"
          title="Sort sessions"
          className={className}
        >
          <ArrowUpDownIcon />
        </SidebarGroupAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent data-testid="sessions-sort-popover" align="end" sideOffset={6} className="w-44">
        <DropdownMenuLabel className="text-muted-foreground">Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => onChange(value as SortMode)}>
          {SESSION_SORTS.map((sort) => (
            <DropdownMenuRadioItem key={sort.id} data-testid={`sessions-sort-${sort.id}`} value={sort.id}>
              {sort.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
