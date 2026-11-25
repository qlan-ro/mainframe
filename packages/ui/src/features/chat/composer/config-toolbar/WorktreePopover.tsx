'use client';

/**
 * WorktreePopover — isolates the active session into a new or existing git
 * worktree in place (enable-worktree / attach-worktree), or moves it to
 * another one. Opened from the bottom strip (K8); a draft picks its worktree in
 * the branch picker instead (K7).
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

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { MoveIcon } from '@/components/ui/glyphs';
import type { Chat } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MENU_DETAIL, MENU_ITEM, MENU_SEPARATOR } from '@/components/ui/menu-item';
import { enableWorktree, attachWorktree, getGitBranches, getProjectWorktrees } from '@/lib/api/git';
import type { WorktreeEntry } from '@/lib/api/git';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useHost } from '@/lib/host';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { mfToast } from '@/lib/toast';
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
    <div
      data-testid="composer-worktree-active-info"
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-[3px] px-2.5 pt-2 pb-1.5 text-meta/[1.45]"
    >
      <span className="col-span-2 mb-0.5 font-semibold text-foreground">Isolated in worktree</span>
      <span className="text-muted-foreground">Branch</span>
      <span className="font-mono text-xs/[1.45] wrap-anywhere text-foreground">{chat.branchName ?? '—'}</span>
      <span className="text-muted-foreground">Path</span>
      <span className="font-mono text-xs/[1.45] wrap-anywhere text-foreground">{chat.worktreePath ?? ''}</span>
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bare trigger element. */
  children: ReactElement;
}

/** Opens the worktree's folder, on the machine the daemon runs on. */
function OpenFolder({ path, onDone }: { path: string; onDone: () => void }) {
  const host = useHost();
  if (!useDaemonIsLocal()) return null;
  return (
    <button
      type="button"
      data-testid="composer-worktree-open-folder"
      className={MENU_ITEM}
      onClick={() => {
        onDone();
        host.fs.openPath(path).catch((error: unknown) =>
          mfToast.error('Could not open the folder', {
            description: error instanceof Error ? error.message : String(error),
          }),
        );
      }}
    >
      <FolderOpen aria-hidden />
      Open folder
    </button>
  );
}

export function WorktreePopover({
  chat,
  hasMessages,
  busy,
  open,
  onOpenChange: setOpen,
  children,
}: WorktreePopoverProps) {
  const port = useDaemonPort();

  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<WorktreeTab>('new');
  // The list of other worktrees replaces the item that asks for it, for this opening.
  const [moving, setMoving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Fetch on popover open (not mount). An isolated chat only lists worktrees to
  // move between, so it skips the branch fetch the New form would need.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    setLoading(true);
    setApiError(null);
    setMoving(false);

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
    [port, chat.id, setOpen],
  );

  const handleAttach = useCallback(
    async (wt: WorktreeEntry) => {
      const branch = wt.branch ? wt.branch.replace('refs/heads/', '') : 'detached';
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
    [port, chat.id, setOpen],
  );

  const isIsolated = Boolean(chat.worktreePath);
  // The chat's own worktree is already the destination — never offer it as one.
  const otherWorktrees = useMemo(
    () => worktrees.filter((wt) => wt.path !== chat.worktreePath),
    [worktrees, chat.worktreePath],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>

      <PopoverContent
        data-testid="composer-worktree-popover"
        align="start"
        side="top"
        sideOffset={6}
        className={isIsolated ? 'w-auto max-w-85 min-w-72.5 gap-0 p-1' : 'gap-2 p-2'}
      >
        {isIsolated ? (
          <>
            <ActiveInfo chat={chat} />
            <div className={MENU_SEPARATOR} />
            {chat.worktreePath && <OpenFolder path={chat.worktreePath} onDone={() => setOpen(false)} />}
            {!moving && (
              <button
                type="button"
                data-testid="composer-worktree-move"
                aria-expanded={false}
                className={MENU_ITEM}
                onClick={() => setMoving(true)}
              >
                <MoveIcon aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span>Move to another worktree…</span>
                  {busy && <span className={MENU_DETAIL}>Available once the current response finishes</span>}
                </span>
              </button>
            )}
            <div hidden={!moving}>
              <WorktreeSectionLabel>Worktrees</WorktreeSectionLabel>
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
