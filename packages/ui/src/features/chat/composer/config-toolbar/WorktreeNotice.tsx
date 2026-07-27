'use client';

/**
 * WorktreeNotice — the warning strip inside the composer worktree popover.
 *
 * Shared by the mid-session notice and the busy refusal so both read as one
 * kind of message rather than two lookalike blocks.
 */

import { AlertTriangle } from 'lucide-react';

export function WorktreeNotice({ testId, children }: { testId: string; children: string }) {
  return (
    <div
      data-testid={testId}
      className="mb-[6px] flex items-start gap-[6px] rounded-[6px] bg-mf-selection px-[8px] py-[6px] text-caption text-foreground"
    >
      <AlertTriangle size={12} className="mt-[1px] shrink-0 text-mf-warning" />
      <span>{children}</span>
    </div>
  );
}
