export interface DraftTarget {
  daemonId: string;
  projectId: string | null;
  worktreePath?: string;
  projectPath?: string;
  projectName?: string;
  pendingBranch?: string;
}

export interface DraftProvenance {
  origin?: DraftTarget;
  removed?: boolean;
  includedFor?: readonly string[];
}

export function targetKey({ daemonId, projectId, worktreePath, pendingBranch }: DraftTarget): string {
  return JSON.stringify([daemonId, projectId, worktreePath ?? null, pendingBranch ?? null]);
}

export function partitionDraftItems<T extends DraftProvenance>(items: readonly T[], target?: DraftTarget) {
  const key = target && targetKey(target);
  const active: T[] = [];
  const setAside: T[] = [];
  for (const item of items) {
    const allowed =
      !item.removed && (!item.origin || (key && (targetKey(item.origin) === key || item.includedFor?.includes(key))));
    (allowed ? active : setAside).push(item);
  }
  return { active, setAside };
}
