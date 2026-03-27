import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useChatsStore } from '../../../../store/chats';
import { useActiveProjectId } from '../../../../hooks/useActiveProjectId';
import {
  getGitBranches,
  enableWorktree,
  forkToWorktree,
  getProjectWorktrees,
  attachWorktree,
} from '../../../../lib/api';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:worktree-popover');

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

function validateBranchName(name: string): string | null {
  if (!name) return 'Branch name is required';
  if (!BRANCH_RE.test(name)) return 'Invalid characters in branch name';
  if (name.includes('..')) return 'Branch name must not contain ".."';
  return null;
}

function BranchSelect({
  label,
  value,
  options,
  currentBranch,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  currentBranch: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="block mb-2">
      <span className="text-mf-small text-mf-text-secondary mb-1 block">{label}</span>
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between rounded-mf-input border border-mf-border bg-mf-panel-bg px-2 py-1.5 text-mf-small text-mf-text-primary outline-none hover:border-mf-accent cursor-pointer transition-colors"
        >
          <span className="truncate">
            {value}
            {value === currentBranch ? ' (current)' : ''}
          </span>
          <ChevronDown size={12} className="shrink-0 text-mf-text-secondary" />
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-mf-app-bg border border-mf-border rounded-mf-input shadow-lg z-50">
            {options.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => {
                  onChange(b);
                  setOpen(false);
                }}
                className={`w-full text-left px-2 py-1.5 text-mf-small transition-colors ${
                  b === value
                    ? 'text-mf-text-primary bg-mf-hover'
                    : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary'
                }`}
              >
                {b}
                {b === currentBranch ? ' (current)' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface WorktreePopoverProps {
  chatId: string;
  hasMessages: boolean;
  onClose: () => void;
}

/** Popover for worktree configuration: pre-session, mid-session fork, or active info. */
export function WorktreePopover({ chatId, hasMessages, onClose }: WorktreePopoverProps) {
  const chat = useChatsStore((s) => s.chats.find((c) => c.id === chatId));
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const projectId = useActiveProjectId();
  const popoverRef = useRef<HTMLDivElement>(null);

  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [baseBranch, setBaseBranch] = useState('');
  const [branchName, setBranchName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<'existing' | 'new'>('existing');
  const [worktrees, setWorktrees] = useState<{ path: string; branch: string | null }[]>([]);

  const worktreePath = chat?.worktreePath;

  // Close on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // Fetch branches (and worktrees for pre-session mode) on mount
  useEffect(() => {
    if (!projectId || worktreePath) return;
    let cancelled = false;
    setLoading(true);

    const fetchBranches = getGitBranches(projectId).then((result) => {
      if (cancelled) return;
      const localNames = result.local.map((b) => b.name);
      setBranches(localNames);
      setCurrentBranch(result.current);
      setBaseBranch(result.current || localNames[0] || '');
      if (!hasMessages) {
        setBranchName(`session/${chatId.slice(0, 8)}`);
      }
    });

    const fetchWorktreeList = !hasMessages
      ? getProjectWorktrees(projectId).then((result) => {
          if (cancelled) return;
          setWorktrees(result.worktrees);
          if (result.worktrees.length === 0) setTab('new');
        })
      : Promise.resolve();

    Promise.all([fetchBranches, fetchWorktreeList])
      .catch((err) => {
        if (cancelled) return;
        log.warn('failed to fetch branches or worktrees', { err: String(err) });
        setError('Failed to load branches');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, worktreePath, chatId, hasMessages]);

  const handleEnable = useCallback(async () => {
    const validationError = validateBranchName(branchName);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await enableWorktree(chatId, baseBranch, branchName);
      onClose();
    } catch (err) {
      log.warn('failed to enable worktree', { err: String(err) });
      setError(err instanceof Error ? err.message : 'Failed to enable worktree');
    } finally {
      setSubmitting(false);
    }
  }, [chatId, baseBranch, branchName, onClose]);

  const handleFork = useCallback(async () => {
    const validationError = validateBranchName(branchName);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await forkToWorktree(chatId, baseBranch, branchName);
      setActiveChat(result.chatId);
      onClose();
    } catch (err) {
      log.warn('failed to fork to worktree', { err: String(err) });
      setError(err instanceof Error ? err.message : 'Failed to fork to worktree');
    } finally {
      setSubmitting(false);
    }
  }, [chatId, baseBranch, branchName, setActiveChat, onClose]);

  const handleAttach = useCallback(
    async (wt: { path: string; branch: string | null }) => {
      setError(null);
      setSubmitting(true);
      try {
        const branch = wt.branch ? wt.branch.replace('refs/heads/', '') : 'detached';
        await attachWorktree(chatId, wt.path, branch);
        onClose();
      } catch (err) {
        log.warn('failed to attach worktree', { err: String(err) });
        setError(err instanceof Error ? err.message : 'Failed to attach worktree');
      } finally {
        setSubmitting(false);
      }
    },
    [chatId, onClose],
  );

  // State 3: Active worktree info
  if (worktreePath) {
    return (
      <div
        ref={popoverRef}
        className="absolute bottom-full left-0 mb-2 w-72 rounded-mf-card border border-mf-border bg-mf-app-bg p-3 shadow-lg z-50"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
          <span className="text-mf-small font-medium text-green-400">Isolated</span>
        </div>
        <div className="space-y-1 text-mf-small">
          <div className="flex items-center gap-2">
            <span className="text-mf-text-secondary">Branch:</span>
            <span className="font-mono text-mf-text-primary">{chat?.branchName}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-mf-text-secondary">Path:</span>
            <span className="font-mono text-mf-text-primary truncate" title={worktreePath}>
              {worktreePath}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div
        ref={popoverRef}
        className="absolute bottom-full left-0 mb-2 w-72 rounded-mf-card border border-mf-border bg-mf-app-bg p-4 shadow-lg z-50 flex items-center justify-center"
      >
        <Loader2 size={16} className="animate-spin text-mf-text-secondary" />
      </div>
    );
  }

  const validationError = branchName ? validateBranchName(branchName) : null;
  const isMidSession = hasMessages;

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-80 rounded-mf-card border border-mf-border bg-mf-app-bg p-3 shadow-lg z-50"
    >
      {/* Mid-session warning */}
      {isMidSession && (
        <div className="flex items-start gap-2 mb-3 rounded-md bg-mf-warning/15 px-3 py-2 text-mf-small text-mf-warning">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            This will create a new chat with worktree isolation. Uncommitted changes and conversation context from this
            session will not be carried over.
          </span>
        </div>
      )}

      {/* Tab toggle for pre-session mode */}
      {!isMidSession && (
        <div className="flex items-center gap-0.5 mb-3 p-0.5 rounded-md bg-mf-input">
          <button
            type="button"
            onClick={() => setTab('existing')}
            className={`flex-1 text-mf-small px-2 py-0.5 rounded transition-colors ${
              tab === 'existing'
                ? 'bg-mf-app-bg text-mf-text-primary shadow-sm'
                : 'text-mf-text-secondary hover:text-mf-text-primary'
            }`}
          >
            Existing
          </button>
          <button
            type="button"
            onClick={() => setTab('new')}
            className={`flex-1 text-mf-small px-2 py-0.5 rounded transition-colors ${
              tab === 'new'
                ? 'bg-mf-app-bg text-mf-text-primary shadow-sm'
                : 'text-mf-text-secondary hover:text-mf-text-primary'
            }`}
          >
            New
          </button>
        </div>
      )}

      {/* Existing worktree list (pre-session only) */}
      {tab === 'existing' && !isMidSession && (
        <div className="max-h-48 overflow-y-auto">
          {worktrees.length === 0 ? (
            <div className="text-mf-small text-mf-text-secondary text-center py-4">No worktrees found</div>
          ) : (
            worktrees.map((wt) => (
              <button
                key={wt.path}
                type="button"
                disabled={submitting}
                onClick={() => void handleAttach(wt)}
                className="w-full text-left px-2 py-2 rounded-mf-input text-mf-small hover:bg-mf-hover transition-colors"
              >
                <div className="font-mono text-mf-text-primary">
                  {wt.branch ? wt.branch.replace('refs/heads/', '') : 'detached'}
                </div>
                <div className="text-mf-label text-mf-text-secondary truncate">{wt.path}</div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Error from API */}
      {error && tab === 'existing' && !isMidSession && (
        <div className="text-mf-small text-mf-destructive mb-2">{error}</div>
      )}

      {/* New worktree form */}
      {(tab === 'new' || isMidSession) && (
        <>
          <BranchSelect
            label="Base branch"
            value={baseBranch}
            options={branches}
            currentBranch={currentBranch}
            onChange={setBaseBranch}
          />

          <label className="block mb-2">
            <span className="text-mf-small text-mf-text-secondary mb-1 block">Branch name</span>
            <input
              type="text"
              value={branchName}
              onChange={(e) => {
                setBranchName(e.target.value);
                setError(null);
              }}
              placeholder={isMidSession ? 'feature/my-branch' : `session/${chatId.slice(0, 8)}`}
              className="w-full rounded-mf-input border border-mf-border bg-mf-panel-bg px-2 py-1.5 text-mf-small text-mf-text-primary font-mono outline-none placeholder:text-mf-text-secondary"
            />
            {validationError && <span className="text-mf-small text-mf-destructive mt-1 block">{validationError}</span>}
          </label>

          {error && !validationError && <div className="text-mf-small text-mf-destructive mb-2">{error}</div>}

          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-mf-input text-mf-small text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting || !!validationError || !branchName}
              onClick={isMidSession ? handleFork : handleEnable}
              className="px-3 py-1.5 rounded-mf-input text-mf-small bg-mf-accent text-mf-panel-bg hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {isMidSession ? 'Fork' : 'Enable'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
