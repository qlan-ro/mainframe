/**
 * BranchGroupSection — a labeled, collapsible group (Local / Remote) of
 * BranchRows inside the branch menu. The header is a Collapsible trigger (a
 * non-item, so toggling never closes the menu); an active search forces the
 * section open so a filter can't hide its matches. Prefix groups (feature/,
 * fix/ …) render as nested labels with indented rows.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DropdownMenuGroup, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { BranchRow } from './BranchRow';
import type { BranchRowActions } from './BranchSubmenu';
import { groupBranches } from './branch-grouping';

export interface BranchGroupSectionProps {
  title: string;
  branches: BranchInfo[];
  currentBranch: string;
  isRemote?: boolean;
  /** Initial expansion; Remote starts collapsed. */
  defaultOpen?: boolean;
  /** True while a search filter is active — the section must show its matches. */
  forceOpen?: boolean;
  actions: BranchRowActions;
}

export function BranchGroupSection({
  title,
  branches,
  currentBranch,
  isRemote = false,
  defaultOpen = true,
  forceOpen = false,
  actions,
}: BranchGroupSectionProps) {
  const [expanded, setExpanded] = useState(defaultOpen);
  if (branches.length === 0) return null;
  const { groups, ungrouped } = groupBranches(branches);
  const open = forceOpen || expanded;
  const slug = title.toLowerCase().replace(/\s+/g, '-');

  return (
    <DropdownMenuGroup>
      <Collapsible open={open} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          data-testid={`git-branch-section-toggle-${slug}`}
          className="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-xs font-medium text-muted-foreground outline-none hover:text-foreground"
        >
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {title}
        </CollapsibleTrigger>
        <CollapsibleContent>
          {isRemote ? (
            branches.map((b) => <BranchRow key={b.name} branch={b} isCurrent={false} isRemote actions={actions} />)
          ) : (
            <>
              {ungrouped.map((b) => (
                <BranchRow key={b.name} branch={b} isCurrent={b.name === currentBranch} actions={actions} />
              ))}
              {groups.map((g) => (
                <DropdownMenuGroup key={g.prefix}>
                  <DropdownMenuLabel data-testid={`git-branch-group-${g.prefix}`} className="py-1 pl-4">
                    {g.prefix}
                  </DropdownMenuLabel>
                  {g.branches.map((b) => (
                    <BranchRow key={b.name} branch={b} isCurrent={b.name === currentBranch} grouped actions={actions} />
                  ))}
                </DropdownMenuGroup>
              ))}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
    </DropdownMenuGroup>
  );
}
