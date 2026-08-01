/**
 * SyncRunBanner — what the last run did, under the board header.
 *
 * The "View report" button is the only entry point to the report, so it is
 * offered exactly when there is something to read: a run that overwrote
 * nothing says so and offers no link.
 */
import React from 'react';
import { CircleDot, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGitHubSyncStore } from './use-github-sync-store';

const plural = (count: number, word: string): string => `${count} ${count === 1 ? word : `${word}s`}`;

export function SyncRunBanner(): React.ReactElement | null {
  const { lastRun, bannerDismissed, openDialog, dismissBanner } = useGitHubSyncStore();
  if (lastRun === null || bannerDismissed) return null;

  const failed = lastRun.failure !== null;
  const counts = `${plural(lastRun.pairsReconciled, 'pair')} synced · ${plural(lastRun.overwrites, 'field')} overwritten`;
  const detail = lastRun.failure?.message ?? (lastRun.overwrites === 0 ? 'Nothing was overwritten.' : null);

  return (
    <div
      data-testid="tasks-github-banner"
      className={cn(
        'flex shrink-0 items-start gap-2 border-b px-4 py-2',
        failed ? 'border-mf-warning/40 bg-mf-warning-tint' : 'border-border bg-card',
      )}
    >
      {failed ? (
        <TriangleAlert size={12} className="mt-0.5 shrink-0 text-mf-warning" aria-hidden />
      ) : (
        <CircleDot size={12} className="mt-0.5 shrink-0 text-mf-text-3" aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-foreground">{counts}</span>
          {lastRun.overwrites > 0 && (
            <button
              data-testid="tasks-github-banner-report"
              type="button"
              onClick={() => openDialog({ kind: 'report' })}
              className="text-caption font-medium text-primary underline-offset-2 transition-colors hover:underline"
            >
              View report
            </button>
          )}
        </div>
        {detail !== null && <span className="text-caption text-mf-text-3">{detail}</span>}
      </div>

      <button
        data-testid="tasks-github-banner-dismiss"
        type="button"
        onClick={dismissBanner}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
