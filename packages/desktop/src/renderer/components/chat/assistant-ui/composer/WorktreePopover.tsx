import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { useChatsStore } from '../../../../store/chats';
import { useActiveProjectId } from '../../../../hooks/useActiveProjectId';
import { getGitBranches, enableWorktree, forkToWorktree } from '../../../../lib/api';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('renderer:worktree-popover');

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

function validateBranchName(name: string): string | null {
  if (!name) return 'Branch name is required';
  if (!BRANCH_RE.test(name)) return 'Invalid characters in branch name';
  if (name.includes('..')) return 'Branch name must not contain ".."';
  return null;
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

  // Fetch branches on mount
  useEffect(() => {
    if (!projectId || worktreePath) return;
    let cancelled = false;
    setLoading(true);
    getGitBranches(projectId)
      .then((result) => {
        if (cancelled) return;
        const localNames = result.local.map((b) => b.name);
        setBranches(localNames);
        setCurrentBranch(result.current);
        setBaseBranch(result.current || localNames[0] || '');
        if (!hasMessages) {
          setBranchName(`session/${chatId.slice(0, 8)}`);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        log.warn('failed to fetch branches', { err: String(err) });
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

  // State 3: Active worktree info
  if (worktreePath) {
    return (
      <div
        ref={popoverRef}
        className="absolute bottom-full left-0 mb-2 w-72 rounded-mf-card border border-mf-border bg-mf-surface p-3 shadow-lg z-50"
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
        className="absolute bottom-full left-0 mb-2 w-72 rounded-mf-card border border-mf-border bg-mf-surface p-4 shadow-lg z-50 flex items-center justify-center"
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
      className="absolute bottom-full left-0 mb-2 w-80 rounded-mf-card border border-mf-border bg-mf-surface p-3 shadow-lg z-50"
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

      {/* Base branch selector */}
      <label className="block mb-2">
        <span className="text-mf-small text-mf-text-secondary mb-1 block">Base branch</span>
        <select
          value={baseBranch}
          onChange={(e) => setBaseBranch(e.target.value)}
          className="w-full rounded-mf-input border border-mf-border bg-mf-panel-bg px-2 py-1.5 text-mf-small text-mf-text-primary focus:outline-none focus:border-mf-accent"
        >
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
              {b === currentBranch ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </label>

      {/* Branch name input */}
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
          className="w-full rounded-mf-input border border-mf-border bg-mf-panel-bg px-2 py-1.5 text-mf-small text-mf-text-primary font-mono focus:outline-none focus:border-mf-accent placeholder:text-mf-text-secondary"
        />
        {validationError && <span className="text-mf-small text-mf-destructive mt-1 block">{validationError}</span>}
      </label>

      {/* Error from API */}
      {error && !validationError && <div className="text-mf-small text-mf-destructive mb-2">{error}</div>}

      {/* Action buttons */}
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
    </div>
  );
}
