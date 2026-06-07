/**
 * SessionRowMeta — adapter label + worktree pill + PR pill + "Needs input"
 * label + tag-dot cluster for session rows.
 *
 * Kept separate so SessionRow stays under 300 lines.
 */

import type { TagColor } from '@qlan-ro/mainframe-types';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import type { SessionStatus } from '../view-model/session-status';

interface SessionRowMetaProps {
  adapterId: string;
  worktreePath?: string;
  worktreeMissing: boolean;
  detectedPrs: DetectedPr[];
  status?: SessionStatus;
  tags?: string[];
  colorOf?: (name: string) => TagColor;
}

function worktreeBasename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function SessionRowMeta({
  adapterId,
  worktreePath,
  worktreeMissing,
  detectedPrs,
  status,
  tags,
  colorOf,
}: SessionRowMetaProps) {
  const visibleTags = tags != null && tags.length > 0 ? tags.slice(0, 4) : [];

  return (
    <div className="flex min-w-0 items-center gap-2 text-micro tracking-[-0.05px] text-mf-text-3">
      <span data-testid="sessions-row-meta-adapter" className="flex-shrink-0 truncate font-mono text-mf-text-3">
        {adapterId}
      </span>
      {worktreePath != null && (
        <span
          data-testid="sessions-row-meta-worktree"
          className={[
            'inline-flex min-w-0 items-center gap-[3px] font-mono',
            worktreeMissing ? 'text-destructive' : 'text-muted-foreground',
          ].join(' ')}
          title={worktreePath}
        >
          {worktreeMissing && <span data-testid="sessions-row-meta-worktree-missing" aria-label="worktree missing" />}
          <svg
            width="9"
            height="9"
            viewBox="0 0 16 16"
            fill="none"
            className="flex-shrink-0 text-mf-text-3"
            aria-hidden
          >
            <path
              d="M5 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM3 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm10 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"
              fill="currentColor"
            />
            <path d="M5 7v1.17A3 3 0 0 1 6.83 10H9a2 2 0 0 0 2-2V7" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <span className="max-w-[8rem] truncate">{worktreeBasename(worktreePath)}</span>
        </span>
      )}
      {detectedPrs.map((pr) => (
        <a
          key={pr.number}
          data-testid="sessions-row-meta-pr"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-shrink-0 items-center font-mono font-semibold text-[#1a7f37] hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
        </a>
      ))}
      {status === 'waiting' && (
        <span data-testid="sessions-row-meta-needs-input" className="flex-shrink-0 font-semibold text-mf-warning">
          Needs input
        </span>
      )}
      <div className="flex-1" />
      {visibleTags.length > 0 && colorOf != null && (
        <span
          data-testid="sessions-row-meta-tag-dots"
          className="inline-flex flex-shrink-0 items-center gap-[3px]"
          title={tags?.join(' · ')}
        >
          {visibleTags.map((name) => (
            <span
              key={name}
              data-testid={`sessions-row-meta-tag-dot-${name}`}
              className="inline-block size-1.5 rounded-full"
              style={TAG_DOT_STYLE(colorOf(name))}
              aria-hidden="true"
            />
          ))}
        </span>
      )}
    </div>
  );
}
