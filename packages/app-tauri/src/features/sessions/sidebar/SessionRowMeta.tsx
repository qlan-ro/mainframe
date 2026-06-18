/**
 * SessionRowMeta — per-project chip + worktree pill + PR pill + AnswerPill
 * (waiting treatment) + tag-dot cluster for session rows.
 *
 * Matches the artboard SessionRowDense meta row: it deliberately does NOT show
 * the adapter (claude/codex) name. Kept separate so SessionRow stays under 300
 * lines. AnswerPill lives here (not in SessionRow) so all waiting-state UI is
 * co-located in the meta row.
 */

import type { TagColor } from '@qlan-ro/mainframe-types';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import type { SessionBadge } from '../view-model/session-status';
import { AnswerPill } from './SessionRow';
import { projectColor } from './project-color';

interface SessionRowMetaProps {
  worktreePath?: string;
  worktreeMissing: boolean;
  detectedPrs: DetectedPr[];
  badge?: SessionBadge;
  tags?: string[];
  colorOf?: (name: string) => TagColor;
  /** Project id — drives the chip's identity color (deterministic per project). */
  projectId?: string;
  /** Chip label, shown in "All" view (no active project filter). */
  projectName?: string;
}

function worktreeBasename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function SessionRowMeta({
  worktreePath,
  worktreeMissing,
  detectedPrs,
  badge,
  tags,
  colorOf,
  projectId,
  projectName,
}: SessionRowMetaProps) {
  const visibleTags = tags != null && tags.length > 0 ? tags.slice(0, 4) : [];
  const chipColor = projectId != null ? projectColor(projectId) : undefined;

  return (
    <div className="flex min-w-0 items-center gap-[8px] text-micro tracking-normal text-mf-text-3">
      {projectName != null && chipColor != null && (
        <span
          data-testid="sessions-row-meta-project"
          className="inline-flex h-[15px] max-w-[124px] flex-shrink-0 items-center gap-[4px] rounded-[4px] px-1.5 py-px text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklch, ${chipColor} 12%, transparent)`,
            color: chipColor,
          }}
          title={projectName}
        >
          <span
            className="size-[5px] flex-shrink-0 rounded-full"
            style={{ backgroundColor: chipColor }}
            aria-hidden="true"
          />
          <span className="truncate">{projectName}</span>
        </span>
      )}
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
          className="inline-flex flex-shrink-0 items-center font-mono font-semibold text-mf-success hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
        </a>
      ))}
      {badge != null && <AnswerPill badge={badge} />}
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
              className="inline-block size-[6px] rounded-full"
              style={TAG_DOT_STYLE(colorOf(name))}
              aria-hidden="true"
            />
          ))}
        </span>
      )}
    </div>
  );
}
