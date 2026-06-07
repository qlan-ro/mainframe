/**
 * SessionRowMeta — adapter label + worktree pill + PR pill for session rows.
 * Kept separate so SessionRow stays under 300 lines.
 */

import type { DetectedPr } from '@qlan-ro/mainframe-types';

interface SessionRowMetaProps {
  adapterId: string;
  worktreePath?: string;
  worktreeMissing: boolean;
  detectedPrs: DetectedPr[];
}

function worktreeBasename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function SessionRowMeta({ adapterId, worktreePath, worktreeMissing, detectedPrs }: SessionRowMetaProps) {
  return (
    <div className="flex min-w-0 flex-shrink-0 items-center gap-1.5">
      <span data-testid="sessions-row-meta-adapter" className="truncate text-micro font-mono text-mf-text-3">
        {adapterId}
      </span>
      {worktreePath != null && (
        <span
          data-testid="sessions-row-meta-worktree"
          className={[
            'inline-flex items-center gap-1 rounded px-1 text-micro font-mono',
            worktreeMissing ? 'bg-mf-destructive-tint text-destructive' : 'bg-muted text-muted-foreground',
          ].join(' ')}
          title={worktreePath}
        >
          {worktreeMissing && <span data-testid="sessions-row-meta-worktree-missing" aria-label="worktree missing" />}
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
              fill="currentColor"
            />
            <path d="M5 7v1.17A3 3 0 0 1 6.83 10H9a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="max-w-[7rem] truncate">{worktreeBasename(worktreePath)}</span>
        </span>
      )}
      {detectedPrs.map((pr) => (
        <a
          key={pr.number}
          data-testid="sessions-row-meta-pr"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center text-micro font-mono font-semibold text-[#1a7f37] hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
        </a>
      ))}
    </div>
  );
}
