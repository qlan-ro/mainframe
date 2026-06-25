/**
 * Pure helpers for grouping and filtering branch lists.
 * Ported from packages/desktop BranchList.tsx — no React or UI deps.
 */
import type { BranchInfo } from '@qlan-ro/mainframe-types';

export const BRANCH_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

export interface BranchGroup {
  prefix: string;
  branches: BranchInfo[];
}

export function groupBranches(branches: BranchInfo[]): {
  groups: BranchGroup[];
  ungrouped: BranchInfo[];
} {
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

export function filterBranches(branches: BranchInfo[], search: string): BranchInfo[] {
  if (!search) return branches;
  const lower = search.toLowerCase();
  return branches.filter((b) => b.name.toLowerCase().includes(lower));
}

export function filterRemote(remote: string[], search: string): string[] {
  if (!search) return remote;
  const lower = search.toLowerCase();
  return remote.filter((r) => r.toLowerCase().includes(lower));
}
