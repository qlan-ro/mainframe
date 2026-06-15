/**
 * BranchGroupSection — a labeled group (Local / Remote) of BranchRows.
 * Handles sub-groups (prefix/ sections) and ungrouped branches.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { BranchRow } from './BranchRow';
import { groupBranches } from './branch-grouping';

export interface BranchGroupSectionProps {
  title: string;
  branches: BranchInfo[];
  currentBranch: string;
  isRemote?: boolean;
  onSelect: (branch: BranchInfo) => void;
}

function PrefixGroup({
  prefix,
  branches,
  currentBranch,
  onSelect,
}: {
  prefix: string;
  branches: BranchInfo[];
  currentBranch: string;
  onSelect: (branch: BranchInfo) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        data-testid={`git-branch-group-toggle-${prefix}`}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-caption text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{prefix}</span>
      </button>
      {expanded &&
        branches.map((b) => (
          <div key={b.name} className="pl-3">
            <BranchRow branch={b} isCurrent={b.name === currentBranch} grouped onSelect={onSelect} />
          </div>
        ))}
    </div>
  );
}

export function BranchGroupSection({
  title,
  branches,
  currentBranch,
  isRemote = false,
  onSelect,
}: BranchGroupSectionProps) {
  const [expanded, setExpanded] = useState(title !== 'Remote');
  const { groups, ungrouped } = groupBranches(branches);

  return (
    <div>
      <button
        data-testid={`git-branch-section-toggle-${title.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-1 text-caption font-semibold text-muted-foreground uppercase"
      >
        {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>

      {expanded && (
        <>
          {isRemote ? (
            branches.map((b) => <BranchRow key={b.name} branch={b} isCurrent={false} isRemote onSelect={onSelect} />)
          ) : (
            <>
              {ungrouped.map((b) => (
                <BranchRow key={b.name} branch={b} isCurrent={b.name === currentBranch} onSelect={onSelect} />
              ))}
              {groups.map((g) => (
                <PrefixGroup
                  key={g.prefix}
                  prefix={g.prefix}
                  branches={g.branches}
                  currentBranch={currentBranch}
                  onSelect={onSelect}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
