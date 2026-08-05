'use client';

/**
 * WorktreePopover — composer control that isolates the active session into a
 * new or existing git worktree in-place (enable-worktree / attach-worktree).
 *
 * Distinct from the MainToolbar BranchPopover, which spawns a *new* session.
 * This control modifies the *current* session.
 *
 * Three states:
 *  1. Active-info — chat.worktreePath is set (already isolated), plus the other
 *     worktrees this session can move to
 *  2. Loading — fetching branches/worktrees on first open
 *  3. Setup — New tab (create) / Existing tab (attach)
 *
 * Built on shadcn Popover + Menu* primitives. Real mf-* tokens only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderGit2, Loader2 } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { MenuDivider, MenuLabel } from '@/components/ui/menu';
import { enableWorktree, attachWorktree, getGitBranches, getProjectWorktrees } from '@/lib/api/git';
import type { WorktreeEntry } from '@/lib/api/git';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftConfig, patchDraftConfig } from '@/features/sessions/runtime/draft-config';
import { WorktreeDraftPanel } from './WorktreeDraftPanel';
import { WorktreeNotice } from './WorktreeNotice';
import { WorktreeNewForm } from './WorktreeNewForm';
import { WorktreeTabBar, WorktreeExistingTab } from './WorktreeExistingTab';
import type { WorktreeTab } from './WorktreeExistingTab';

// ---------------------------------------------------------------------------
// Active-info panel (chat already isolated into a worktree)
// ---------------------------------------------------------------------------

function ActiveInfo({ chat }: { chat: Chat }) {
  return (
    <div data-testid="composer-worktree-active-info" className="space-y-[6px] px-[8px] py-[6px]">
      <div className="flex items-center gap-[6px]">
        <span className="inline-block size-[7px] shrink-0 rounded-full bg-mf-success" aria-hidden />
        <span className="text-caption font-medium text-foreground">Isolated in worktree</span>
      </div>
      <MenuDivider />
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-[8px] gap-y-[2px]">
        <span className="text-caption text-muted-foreground">Branch</span>
        <span className="truncate text-caption text-foreground">{chat.branchName ?? '—'}</span>
        <span className="text-caption text-muted-foreground">Path</span>
        <TruncatedWithTooltip
          text={chat.worktreePath ?? ''}
          className="text-caption text-foreground"
          contentClassName="break-all"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const BUSY_NOTE = 'Available once the current response finishes — rebinding now would cut it off.';

export interface WorktreePopoverProps {
  chat: Chat;
  hasMessages: boolean;
  /** A turn is in flight; every rebind restarts the CLI, so all of them wait. */
  busy: boolean;
}

export function WorktreePopover({ chat, hasMessages, busy }: WorktreePopoverProps) {
  const port = useDaemonPort();

  // Draft mode (todo #223): a __LOCALID_* thread has no daemon chat, so the
  // choice is stashed in the draft config — an existing-worktree attach rides
  // the createChat payload; a new worktree is created by the coordinator right
  // after createChat on first send. Never call the chat-scoped endpoints here.
  const isLocalDraft = chat.id.startsWith('__LOCALID_');
  const draft = useDraftConfig(isLocalDraft ? chat.id : null);
  const pendingWorktree = draft?.pendingWorktree;

  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<WorktreeTab>('new');
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Fetch on popover open (not mount). An isolated chat only lists worktrees to
  // move between, so it skips the branch fetch the New form would need.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setApiError(null);

    Promise.all([
      chat.worktreePath ? Promise.resolve(null) : getGitBranches(port, chat.projectId),
      getProjectWorktrees(port, chat.projectId),
    ])
      .then(([branchRes, wtRes]) => {
        if (cancelled) return;
        if (branchRes !== null) {
          setBranches(branchRes.local.map((b) => b.name));
          setCurrentBranch(branchRes.current);
        }
        setWorktrees(wtRes);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setApiError(err instanceof Error ? err.message : 'Failed to load branch data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, chat.worktreePath, chat.projectId, port]);

  const handleEnable = useCallback(
    async (baseBranch: string, branchName: string) => {
      if (isLocalDraft) {
        patchDraftConfig(chat.id, { pendingWorktree: { baseBranch, branchName } });
        setOpen(false);
        return;
      }
      setSubmitting(true);
      setApiError(null);
      try {
        await enableWorktree(port, chat.id, baseBranch, branchName);
        setOpen(false);
      } catch (err: unknown) {
        setApiError(err instanceof Error ? err.message : 'Failed to enable worktree');
      } finally {
        setSubmitting(false);
      }
    },
    [port, chat.id, isLocalDraft],
  );

  const handleAttach = useCallback(
    async (wt: WorktreeEntry) => {
      const branch = wt.branch ? wt.branch.replace('refs/heads/', '') : 'detached';
      if (isLocalDraft) {
        patchDraftConfig(chat.id, { worktreePath: wt.path, branchName: branch });
        setOpen(false);
        return;
      }
      setSubmitting(true);
      setApiError(null);
      try {
        await attachWorktree(port, chat.id, wt.path, branch);
        setOpen(false);
      } catch (err: unknown) {
        setApiError(err instanceof Error ? err.message : 'Failed to attach worktree');
      } finally {
        setSubmitting(false);
      }
    },
    [port, chat.id, isLocalDraft],
  );

  // Cancel a stashed draft choice — the session starts in the main repo instead.
  const handleDraftCancel = useCallback(() => {
    patchDraftConfig(chat.id, { worktreePath: undefined, branchName: undefined, pendingWorktree: undefined });
  }, [chat.id]);

  const isIsolated = Boolean(chat.worktreePath);
  // The chat's own worktree is already the destination — never offer it as one.
  const otherWorktrees = useMemo(
    () => worktrees.filter((wt) => wt.path !== chat.worktreePath),
    [worktrees, chat.worktreePath],
  );
  const isPendingDraft = isLocalDraft && pendingWorktree != null;
  const showIsolated = isIsolated || isPendingDraft;
  const branchLabel = isIsolated ? (chat.branchName ?? 'Worktree') : isPendingDraft ? pendingWorktree.branchName : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-testid="composer-worktree-trigger"
              aria-label={showIsolated ? `Worktree: ${branchLabel}` : 'Isolate in worktree'}
              className={[
                'relative flex h-[20px] w-[26px] shrink-0 items-center justify-center gap-[3px]',
                'rounded-sm border-[0.5px] text-muted-foreground',
                showIsolated ? 'border-mf-success text-mf-success' : 'border-border',
                'hover:bg-accent hover:text-accent-foreground',
                'data-[state=open]:border-primary data-[state=open]:bg-mf-selection',
                'transition-colors focus-visible:outline-none',
              ].join(' ')}
            >
              <FolderGit2 size={13} />
              {showIsolated && (
                <span className="absolute right-0.5 top-0.5 size-[5px] rounded-full bg-primary" aria-hidden />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">
          {showIsolated ? `Worktree: ${branchLabel}` : 'Isolate session in a worktree'}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        data-testid="composer-worktree-popover"
        align="start"
        side="top"
        sideOffset={6}
        className="w-[280px] p-[5px]"
      >
        {isLocalDraft && draft != null && showIsolated ? (
          <WorktreeDraftPanel draft={draft} onCancel={handleDraftCancel} />
        ) : isIsolated ? (
          <>
            <ActiveInfo chat={chat} />
            <div className="mt-[6px]">
              <MenuLabel>Move to another worktree</MenuLabel>
              {busy && <WorktreeNotice testId="composer-worktree-busy">{BUSY_NOTE}</WorktreeNotice>}
              {loading ? (
                <div className="flex items-center justify-center py-[20px]">
                  <Loader2 size={14} className="animate-spin text-mf-text-3" />
                </div>
              ) : (
                <WorktreeExistingTab
                  worktrees={otherWorktrees}
                  disabled={submitting || busy}
                  onAttach={handleAttach}
                  error={apiError}
                />
              )}
            </div>
          </>
        ) : loading ? (
          <div className="flex items-center justify-center py-[20px]">
            <Loader2 size={14} className="animate-spin text-mf-text-3" />
          </div>
        ) : (
          <>
            {busy ? (
              <WorktreeNotice testId="composer-worktree-busy">{BUSY_NOTE}</WorktreeNotice>
            ) : (
              hasMessages && (
                <WorktreeNotice testId="composer-worktree-mid-session-warning">
                  Session will pause and resume in the worktree.
                </WorktreeNotice>
              )
            )}
            <MenuLabel>Isolate session</MenuLabel>
            <WorktreeTabBar active={tab} onChange={setTab} />
            <div className="mt-[6px]">
              {tab === 'new' ? (
                <WorktreeNewForm
                  branches={branches}
                  currentBranch={currentBranch}
                  submitting={submitting}
                  disabled={busy}
                  apiError={apiError}
                  onEnable={handleEnable}
                  onCancel={() => setOpen(false)}
                />
              ) : (
                <WorktreeExistingTab
                  worktrees={worktrees}
                  disabled={submitting || busy}
                  onAttach={handleAttach}
                  error={apiError}
                />
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
