'use client';

/**
 * WorktreeDraftPanel — WorktreePopover body for a `__LOCALID_*` draft whose
 * worktree choice is stashed in the draft config (todo #223). No daemon chat
 * exists yet, so the choice applies on first send: an EXISTING worktree attach
 * goes through the createChat payload; a NEW worktree (pendingWorktree) is
 * created by the coordinator right after the chat. Cancel un-stashes so the
 * session starts in the main repo instead.
 */
import { MenuDivider } from '@/components/ui/menu';
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
    <div data-testid="composer-worktree-draft-panel" className="space-y-[6px] px-[8px] py-[6px]">
      <div className="flex items-center gap-[6px]">
        <span className="inline-block size-[7px] shrink-0 rounded-full bg-mf-success" aria-hidden />
        <span className="text-caption font-medium text-mf-success">
          {pending ? 'New worktree on first message' : 'Isolates in worktree on first message'}
        </span>
      </div>
      <MenuDivider />
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-[8px] gap-y-[2px]">
        <span className="text-caption text-mf-text-3">Branch</span>
        <span className="truncate font-mono text-caption text-foreground">{branch}</span>
        {pending ? (
          <>
            <span className="text-caption text-mf-text-3">From</span>
            <span className="truncate font-mono text-caption text-foreground">{pending.baseBranch}</span>
          </>
        ) : (
          <>
            <span className="text-caption text-mf-text-3">Path</span>
            <TruncatedWithTooltip
              text={draft.worktreePath ?? ''}
              className="font-mono text-caption text-foreground"
              contentClassName="font-mono break-all"
            />
          </>
        )}
      </div>
      <div className="flex justify-end pt-[2px]">
        <button
          type="button"
          data-testid="composer-worktree-draft-cancel"
          onClick={onCancel}
          className="rounded-[6px] px-[10px] py-[4px] text-caption text-mf-text-3 transition-colors hover:bg-accent hover:text-foreground"
        >
          Don&apos;t isolate
        </button>
      </div>
    </div>
  );
}
