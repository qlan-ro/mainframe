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
 * A Popover, not a DropdownMenu: the body is a FORM (base-branch select, branch
 * name, validation), and forms never live inside a Radix menu.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderGit2, Loader2 } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Hint } from '@/components/ui/hint';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { enableWorktree, attachWorktree, getGitBranches, getProjectWorktrees } from '@/lib/api/git';
import type { WorktreeEntry } from '@/lib/api/git';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useDraftConfig, patchDraftConfig } from '@/features/sessions/runtime/draft-config';
import { WorktreeDraftPanel } from './WorktreeDraftPanel';
import { WorktreeNotice } from './WorktreeNotice';
import { WorktreeNewForm } from './WorktreeNewForm';
import { WorktreeTabBar, WorktreeExistingTab, WorktreeSectionLabel } from './WorktreeExistingTab';
import type { WorktreeTab } from './WorktreeExistingTab';

/** Centered spinner for the first-open fetch. */
function WorktreeLoading() {
  return (
    <div className="flex items-center justify-center py-5">
      <Loader2 size={14} className="animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active-info panel (chat already isolated into a worktree)
// ---------------------------------------------------------------------------

function ActiveInfo({ chat }: { chat: Chat }) {
  return (
    <div data-testid="composer-worktree-active-info" className="flex flex-col gap-1.5 px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
        <span className="text-xs font-medium text-foreground">Isolated in worktree</span>
      </div>
      <Separator />
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">Branch</span>
        {/* Branch names are UI sans, never mono (2026-08-05 decision). */}
        <span className="truncate text-foreground">{chat.branchName ?? '—'}</span>
        <span className="text-muted-foreground">Path</span>
        <TruncatedWithTooltip text={chat.worktreePath ?? ''} className="text-foreground" contentClassName="break-all" />
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
      {/* Hint WRAPS the PopoverTrigger — inside it, TooltipTrigger's asChild
          would clobber the trigger's own data-state. */}
      <Hint label={showIsolated ? `Worktree: ${branchLabel}` : 'Isolate session in a worktree'} side="top">
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="composer-worktree-trigger"
            aria-label={showIsolated ? `Worktree: ${branchLabel}` : 'Isolate in worktree'}
            // Geometry matches its untouched neighbours in the config chip row
            // (PermissionSelect / PlanModeToggle); only the tokens moved to v2.
            className={[
              'relative flex h-[20px] w-[26px] shrink-0 items-center justify-center gap-[3px]',
              'rounded-sm border text-muted-foreground',
              showIsolated ? 'border-success text-success' : 'border-border',
              'hover:bg-accent hover:text-accent-foreground',
              'data-[state=open]:border-primary data-[state=open]:bg-sidebar-selection',
              'transition-colors focus-visible:outline-none',
            ].join(' ')}
          >
            <FolderGit2 size={13} />
            {showIsolated && (
              <span className="absolute top-0.5 right-0.5 size-[5px] rounded-full bg-primary" aria-hidden />
            )}
          </button>
        </PopoverTrigger>
      </Hint>

      <PopoverContent
        data-testid="composer-worktree-popover"
        align="start"
        side="top"
        sideOffset={6}
        // w-72 is the primitive's own width; only the compact gap/padding differ.
        className="gap-2 p-2"
      >
        {isLocalDraft && draft != null && showIsolated ? (
          <WorktreeDraftPanel draft={draft} onCancel={handleDraftCancel} />
        ) : isIsolated ? (
          <>
            <ActiveInfo chat={chat} />
            <div className="flex flex-col gap-1.5">
              <WorktreeSectionLabel>Move to another worktree</WorktreeSectionLabel>
              {busy && <WorktreeNotice testId="composer-worktree-busy">{BUSY_NOTE}</WorktreeNotice>}
              {loading ? (
                <WorktreeLoading />
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
          <WorktreeLoading />
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
            <WorktreeSectionLabel>Isolate session</WorktreeSectionLabel>
            <WorktreeTabBar active={tab} onChange={setTab} />
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
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
