import React, { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, GitBranch, Star } from 'lucide-react';
import type { BranchInfo } from '@qlan-ro/mainframe-types';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

interface BranchGroup {
  prefix: string;
  branches: BranchInfo[];
}

interface BranchListProps {
  local: BranchInfo[];
  remote: string[];
  currentBranch: string;
  search: string;
  onSelectBranch: (branch: string, isCurrent: boolean, isRemote: boolean) => void;
}

function groupBranches(branches: BranchInfo[]): { groups: BranchGroup[]; ungrouped: BranchInfo[] } {
  const map = new Map<string, BranchInfo[]>();
  const ungrouped: BranchInfo[] = [];

  for (const b of branches) {
    const slashIdx = b.name.indexOf('/');
    if (slashIdx > 0) {
      const prefix = b.name.slice(0, slashIdx);
      const existing = map.get(prefix) ?? [];
      existing.push(b);
      map.set(prefix, existing);
    } else {
      ungrouped.push(b);
    }
  }

  const groups: BranchGroup[] = [];
  for (const [prefix, branchList] of map) {
    groups.push({ prefix, branches: branchList });
  }

  return { groups, ungrouped };
}

function filterBranches(branches: BranchInfo[], search: string): BranchInfo[] {
  if (!search) return branches;
  const lower = search.toLowerCase();
  return branches.filter((b) => b.name.toLowerCase().includes(lower));
}

function filterRemote(remote: string[], search: string): string[] {
  if (!search) return remote;
  const lower = search.toLowerCase();
  return remote.filter((r) => r.toLowerCase().includes(lower));
}

function BranchRow({
  name,
  isCurrent,
  isMain,
  tracking,
  onClick,
}: {
  name: string;
  isCurrent: boolean;
  isMain: boolean;
  tracking?: string;
  onClick: () => void;
}): React.ReactElement {
  const displayName = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-1.5 px-3 py-1 text-left text-xs',
        'hover:bg-mf-hover rounded transition-colors',
        isCurrent && 'bg-mf-hover text-mf-accent',
      )}
    >
      {isMain ? <Star size={12} className="text-mf-warning shrink-0" /> : <GitBranch size={12} className="shrink-0" />}
      <span className="truncate">{displayName}</span>
      {tracking && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-auto shrink-0 text-[10px] text-mf-text-secondary truncate max-w-[120px]">
              {tracking}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{tracking}</TooltipContent>
        </Tooltip>
      )}
      <ChevronRight size={12} className={cn('shrink-0 text-mf-text-secondary', !tracking && 'ml-auto')} />
    </button>
  );
}

function GroupSection({
  prefix,
  branches,
  currentBranch,
  onSelectBranch,
}: {
  prefix: string;
  branches: BranchInfo[];
  currentBranch: string;
  onSelectBranch: (branch: string, isCurrent: boolean, isRemote: boolean) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-xs text-mf-text-secondary hover:text-mf-text-primary"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{prefix}</span>
      </button>
      {expanded &&
        branches.map((b) => (
          <div key={b.name} className="pl-3">
            <BranchRow
              name={b.name}
              isCurrent={b.name === currentBranch}
              isMain={false}
              tracking={b.tracking}
              onClick={() => onSelectBranch(b.name, b.name === currentBranch, false)}
            />
          </div>
        ))}
    </div>
  );
}

const MAIN_BRANCHES = new Set(['main', 'master', 'develop']);

export function BranchList({
  local,
  remote,
  currentBranch,
  search,
  onSelectBranch,
}: BranchListProps): React.ReactElement {
  const filtered = useMemo(() => filterBranches(local, search), [local, search]);
  const filteredRemote = useMemo(() => filterRemote(remote, search), [remote, search]);
  const { groups, ungrouped } = useMemo(() => groupBranches(filtered), [filtered]);
  const [remoteExpanded, setRemoteExpanded] = useState(false);

  return (
    <div className="max-h-60 overflow-y-auto">
      {/* Local branches */}
      <div className="px-2 py-1 text-[10px] font-semibold text-mf-text-secondary uppercase tracking-wider">
        Local Branches
      </div>

      {/* Ungrouped (including main/master) */}
      {ungrouped.map((b) => (
        <BranchRow
          key={b.name}
          name={b.name}
          isCurrent={b.name === currentBranch}
          isMain={MAIN_BRANCHES.has(b.name)}
          tracking={b.tracking}
          onClick={() => onSelectBranch(b.name, b.name === currentBranch, false)}
        />
      ))}

      {/* Grouped */}
      {groups.map((g) => (
        <GroupSection
          key={g.prefix}
          prefix={g.prefix}
          branches={g.branches}
          currentBranch={currentBranch}
          onSelectBranch={onSelectBranch}
        />
      ))}

      {filtered.length === 0 && <div className="px-3 py-2 text-xs text-mf-text-secondary">No matching branches</div>}

      {/* Remote branches */}
      {filteredRemote.length > 0 && (
        <>
          <div className="border-t border-mf-border my-1" />
          <button
            onClick={() => setRemoteExpanded(!remoteExpanded)}
            className="w-full flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-mf-text-secondary uppercase tracking-wider"
          >
            {remoteExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Remote Branches
          </button>
          {remoteExpanded &&
            filteredRemote.map((r) => (
              <button
                key={r}
                onClick={() => onSelectBranch(r, false, true)}
                className="w-full flex items-center gap-1.5 px-3 py-1 text-left text-xs text-mf-text-secondary hover:bg-mf-hover rounded transition-colors"
              >
                <GitBranch size={12} className="shrink-0" />
                <span className="truncate">{r}</span>
                <ChevronRight size={12} className="ml-auto shrink-0" />
              </button>
            ))}
        </>
      )}
    </div>
  );
}
