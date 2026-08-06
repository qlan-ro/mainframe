/**
 * WorktreeStatusPillCard — marker pill for EnterWorktree / ExitWorktree.
 *
 * Registry keys: 'EnterWorktree', 'ExitWorktree'.
 * Visual family: centered marker row (MarkerWrap/MarkerPill).
 *
 * Behavior:
 *   - GitBranch icon.
 *   - Enter: 'Entered worktree: {name}' (name in text-primary).
 *     name = args.name ?? worktreeBranch ?? worktreePath from result JSON.
 *     tooltip = worktreePath.
 *   - Exit: 'Removed worktree' or 'Exited worktree (kept)' per args.action.
 *   - Pending: entering/exiting…; Error: red dot + error state.
 *   - Non-expandable (no disclosure body).
 */
import React from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { GitBranchIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@v2/components/ui/tooltip';
import { MarkerWrap, MarkerPill, type MarkerState } from './marker-pill';
import { isErrorResult, extractResultContent } from '../shared/result';

// ── Result parsing ────────────────────────────────────────────────────────────

function parseEnterResult(result: unknown): { worktreePath?: string; worktreeBranch?: string } {
  const text = extractResultContent(result);
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      worktreePath: typeof parsed['worktreePath'] === 'string' ? parsed['worktreePath'] : undefined,
      worktreeBranch: typeof parsed['worktreeBranch'] === 'string' ? parsed['worktreeBranch'] : undefined,
    };
  } catch {
    /* expected: non-JSON result text */
  }
  return {};
}

// ── WorktreeStatusPillCard factory ────────────────────────────────────────────

function buildWorktreeCard(kind: 'EnterWorktree' | 'ExitWorktree'): ToolCallMessagePartComponent {
  const isEnter = kind === 'EnterWorktree';

  const Card: ToolCallMessagePartComponent = ({ args, result, isError }) => {
    const isPending = result === undefined;
    const errored = !isPending && isErrorResult(result, isError);

    const state: MarkerState = isPending ? 'pending' : errored ? 'error' : 'done';

    let label: React.ReactNode;
    let tooltip: string | null = null;

    if (errored) {
      label = isEnter ? 'Failed to enter worktree' : 'Failed to exit worktree';
    } else if (isPending) {
      label = isEnter ? 'Entering worktree…' : 'Exiting worktree…';
    } else if (isEnter) {
      const { worktreePath, worktreeBranch } = parseEnterResult(result);
      const name = String(args['name'] ?? worktreeBranch ?? worktreePath ?? '');
      label = (
        <>
          Entered worktree: <span className="text-primary">{name}</span>
        </>
      );
      tooltip = worktreePath ?? null;
    } else {
      const action = String(args['action'] ?? 'keep');
      label = action === 'remove' ? 'Removed worktree' : 'Exited worktree (kept)';
    }

    const pill = (
      <MarkerPill
        icon={<GitBranchIcon />}
        state={state}
        expandable={false}
        testId={`chat-worktree-${isEnter ? 'enter' : 'exit'}-pill`}
      >
        {label}
      </MarkerPill>
    );

    return (
      <MarkerWrap>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{pill}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs font-mono break-all">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          pill
        )}
      </MarkerWrap>
    );
  };

  Card.displayName = `WorktreeStatusPill_${kind}`;
  return Card;
}

export const EnterWorktreeCard = buildWorktreeCard('EnterWorktree');
export const ExitWorktreeCard = buildWorktreeCard('ExitWorktree');
