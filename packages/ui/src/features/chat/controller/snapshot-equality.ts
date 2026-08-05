/**
 * Field-equality checks for the reducer's re-sent snapshots.
 *
 * `chat.updated` and every subscribe/reconnect resend the whole background and
 * worktree-offer lists, so the reducer bails identity-stable when nothing moved
 * and the composer skips the re-render.
 */
import type { BackgroundActivityTask, WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';

/** True when the snapshot lists exactly the tasks already in state (field-equal). */
export function sameBackgroundTasks(
  current: Readonly<Record<string, BackgroundActivityTask>>,
  snapshot: BackgroundActivityTask[],
): boolean {
  if (Object.keys(current).length !== snapshot.length) return false;
  return snapshot.every((t) => {
    const c = current[t.id];
    return (
      c !== undefined &&
      c.kind === t.kind &&
      c.description === t.description &&
      c.startedAt === t.startedAt &&
      // A workflow's name and run id are learned after the first projection, so
      // ignoring them would freeze the reconnect snapshot on the anonymous row.
      c.workflowName === t.workflowName &&
      c.runId === t.runId
    );
  });
}

/** True when the snapshot lists exactly the offers already in state (field-equal). */
export function sameWorktreeOffers(
  current: Readonly<Record<string, WorktreeSwitchOffer>>,
  snapshot: WorktreeSwitchOffer[],
): boolean {
  if (Object.keys(current).length !== snapshot.length) return false;
  return snapshot.every((o) => {
    const c = current[o.worktreePath];
    return c !== undefined && c.branchName === o.branchName && c.detectedAt === o.detectedAt;
  });
}
