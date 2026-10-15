/**
 * summary-view — the Summary section's rows.
 *
 * Every row is the same shape (label, trailing value, tooltip) plus what its
 * kind needs to render, so the section maps one renderer over the list instead
 * of hand-writing four near-identical blocks. A row that has no data is not
 * emitted, which puts the visibility rules in one testable place.
 */
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { formatTokenCount } from './context-tokens';

export interface SummaryBranchInput {
  name: string | null;
}

export interface SummaryWorktreeInput {
  isWorktree: boolean;
  /** The worktree's directory; absent for a draft's worktree, created on first send. */
  worktreePath?: string;
  /** The project root — the tooltip for the main checkout. */
  projectPath?: string;
}

export interface SummaryContextInput {
  /** null when the usage cannot be derived (unknown model context window). */
  percent: number | null;
  usedTokens?: number;
  maxTokens?: number;
}

export interface SummaryChangesInput {
  fileCount: number;
  /** Absent for scopes the daemon reports no counts for — never faked as 0. */
  additions?: number;
  deletions?: number;
}

export interface SummaryInput {
  /** null for a session with no project: there is no checkout to name. */
  worktree: SummaryWorktreeInput | null;
  branch: SummaryBranchInput;
  context: SummaryContextInput;
  prs: readonly DetectedPr[];
  /** null while the change data has not loaded. */
  changes: SummaryChangesInput | null;
}

interface SummaryRowBase {
  label: string;
  value: string;
  tooltip: string;
}

export type SummaryRow =
  | (SummaryRowBase & { kind: 'worktree' })
  | (SummaryRowBase & { kind: 'branch' })
  | (SummaryRowBase & { kind: 'context'; percent: number })
  | (SummaryRowBase & { kind: 'pr'; number: number; url: string })
  | (SummaryRowBase & { kind: 'changes'; fileCount: number; additions?: number; deletions?: number });

/** Git's own name for the repo's original checkout is the "main worktree". */
export const MAIN_CHECKOUT_LABEL = 'Main checkout';

function directoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function worktreeRow(worktree: SummaryWorktreeInput | null): SummaryRow | null {
  if (!worktree) return null;
  const { isWorktree, worktreePath, projectPath } = worktree;
  if (!isWorktree) {
    return {
      kind: 'worktree',
      label: 'Worktree',
      value: MAIN_CHECKOUT_LABEL,
      tooltip: projectPath ? `Not in a worktree · ${projectPath}` : 'Not in a worktree',
    };
  }
  if (!worktreePath) {
    return { kind: 'worktree', label: 'Worktree', value: 'New worktree', tooltip: 'Created on first send' };
  }
  return { kind: 'worktree', label: 'Worktree', value: directoryName(worktreePath), tooltip: worktreePath };
}

function branchRow({ name }: SummaryBranchInput): SummaryRow | null {
  if (!name) return null;
  return { kind: 'branch', label: 'Branch', value: name, tooltip: name };
}

function contextRow({ percent, usedTokens, maxTokens }: SummaryContextInput): SummaryRow | null {
  if (percent === null) return null;
  const tooltip =
    usedTokens != null && maxTokens != null
      ? `${formatTokenCount(usedTokens)} / ${formatTokenCount(maxTokens)} tokens`
      : 'Context usage';
  return { kind: 'context', label: 'Context', value: `${percent}%`, tooltip, percent };
}

function prRow(pr: DetectedPr): SummaryRow {
  return {
    kind: 'pr',
    label: `PR #${pr.number}`,
    value: pr.source,
    tooltip: pr.url,
    number: pr.number,
    url: pr.url,
  };
}

function changesRow(changes: SummaryChangesInput | null): SummaryRow | null {
  if (!changes) return null;
  const { fileCount, additions, deletions } = changes;
  return {
    kind: 'changes',
    label: 'Changes',
    // The +/− counts carry the row; a file count would just widen it.
    value: fileCount === 0 ? 'No changes' : '',
    tooltip:
      fileCount === 0
        ? 'Open the review panel'
        : `${fileCount} file${fileCount === 1 ? '' : 's'} · open the review panel`,
    fileCount,
    additions,
    deletions,
  };
}

export function deriveSummaryRows(input: SummaryInput): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const worktree = worktreeRow(input.worktree);
  if (worktree) rows.push(worktree);
  const branch = branchRow(input.branch);
  if (branch) rows.push(branch);
  const context = contextRow(input.context);
  if (context) rows.push(context);
  rows.push(...input.prs.map(prRow));
  const changes = changesRow(input.changes);
  if (changes) rows.push(changes);
  return rows;
}
