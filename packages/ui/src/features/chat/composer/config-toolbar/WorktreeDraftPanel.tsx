'use client';

/**
 * WorktreeDraftPanel — WorktreePopover body for a `__LOCALID_*` draft whose
 * worktree choice is stashed in the draft config (todo #223). No daemon chat
 * exists yet, so the choice applies on first send: an EXISTING worktree attach
 * goes through the createChat payload; a NEW worktree (pendingWorktree) is
 * created by the coordinator right after the chat. Cancel un-stashes so the
 * session starts in the main repo instead.
 */
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import type { DraftCfg } from '@/features/sessions/runtime/draft-config';

export interface WorktreeDraftPanelProps {
  draft: DraftCfg;
  onCancel: () => void;
}

export function WorktreeDraftPanel({ draft, onCancel }: WorktreeDraftPanelProps) {
  const pending = draft.pendingWorktree;
  const branch = pending?.branchName ?? draft.branchName ?? '—';

  return (
    <div data-testid="composer-worktree-draft-panel" className="flex flex-col gap-1.5 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
        <span className="text-xs font-medium text-foreground">
          {pending ? 'New worktree on first message' : 'Isolates in worktree on first message'}
        </span>
      </div>
      <Separator />
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Branch</span>
        <span className="truncate text-foreground">{branch}</span>
        {pending ? (
          <>
            <span className="text-muted-foreground">From</span>
            <span className="truncate text-foreground">{pending.baseBranch}</span>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">Path</span>
            <TruncatedWithTooltip
              text={draft.worktreePath ?? ''}
              className="text-foreground"
              contentClassName="break-all"
            />
          </>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" data-testid="composer-worktree-draft-cancel" onClick={onCancel}>
          Don&apos;t isolate
        </Button>
      </div>
    </div>
  );
}
