/**
 * The session list's sort control, on the first group header.
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
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { SESSION_SORTS, type SortMode } from '@/features/sessions/view-model/group-sessions';

interface SessionSortMenuProps {
  mode: SortMode;
  onChange: (mode: SortMode) => void;
}

export function SessionSortMenu({ mode, onChange }: SessionSortMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          data-testid="sessions-sort-button"
          aria-label="Sort sessions"
          title="Sort sessions"
          className="size-6"
        >
          <ArrowUpDownIcon />
        </Button>
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
