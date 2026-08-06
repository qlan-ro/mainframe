'use client';

/**
 * WorktreeNotice — the warning strip inside the composer worktree popover.
 *
 * Shared by the mid-session notice and the busy refusal so both read as one
 * kind of message rather than two lookalike blocks. The documented callout
 * recipe: `Alert` on the `warning` tint — a session that will pause and resume
 * elsewhere is wrong-but-not-broken, which is exactly what `warning` means here.
 */

import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@v2/components/ui/alert';

export function WorktreeNotice({ testId, children }: { testId: string; children: string }) {
  return (
    <Alert data-testid={testId} className="border-warning/30 bg-warning/10 px-2.5 py-2 text-xs">
      <AlertTriangle className="text-warning" />
      <AlertDescription className="text-xs text-foreground">{children}</AlertDescription>
    </Alert>
  );
}
