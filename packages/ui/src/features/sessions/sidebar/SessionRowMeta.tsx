/**
 * SessionRowMeta — per-project chip + worktree pill + PR pill + tag-dot
 * cluster for session rows.
 *
 * Matches the artboard SessionRowDense meta row: it deliberately does NOT show
 * the adapter (claude/codex) name. Kept separate so SessionRow stays under 300
 * lines. Session status lives entirely in the row's leading StatusDot (2026-07-02
 * density pass) — no text pill here, so worktree + PR keep the room.
 */

import { AlertTriangle, GitFork } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import { projectColor } from './project-color';
import { Hint } from '@/components/ui/hint';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';

interface SessionRowMetaProps {
  worktreePath?: string;
  worktreeMissing: boolean;
  /** True when the CLI's transcript file for this session was deleted from disk. */
  transcriptMissing?: boolean;
  detectedPrs: DetectedPr[];
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

/** Unified degraded marker — one muted icon, tooltip + aria-label name the cause(s). */
function DegradedMarker({ causes }: { causes: string[] }) {
  const label = causes.join(' · ');
  return (
    <Hint label={label}>
      <span
        data-testid="sessions-row-meta-degraded"
        aria-label={label}
        className="inline-flex flex-shrink-0 items-center text-mf-text-3"
      >
        <AlertTriangle size={9} aria-hidden />
      </span>
    </Hint>
  );
}

export function SessionRowMeta({
  worktreePath,
  worktreeMissing,
  transcriptMissing = false,
  detectedPrs,
  tags,
  colorOf,
  projectId,
  projectName,
}: SessionRowMetaProps) {
  const visibleTags = tags != null && tags.length > 0 ? tags.slice(0, 4) : [];
  const chipColor = projectId != null ? projectColor(projectId) : undefined;
  const degradedCauses = [
    ...(worktreeMissing ? ['Worktree missing'] : []),
    ...(transcriptMissing ? ['Transcript missing'] : []),
  ];

  return (
    <div className="flex min-w-0 items-center gap-[8px] text-micro tracking-normal text-mf-text-3">
      {projectName != null && chipColor != null && (
        <span
          data-testid="sessions-row-meta-project"
          className="inline-flex h-[15px] max-w-[124px] flex-shrink-0 items-center gap-[4px] rounded-[4px] pl-[5px] pr-[6px] text-micro font-semibold"
          style={{
            backgroundColor: `color-mix(in oklch, ${chipColor} 10%, transparent)`,
            color: chipColor,
          }}
        >
          <span
            className="size-[5px] flex-shrink-0 rounded-full"
            style={{ backgroundColor: chipColor }}
            aria-hidden="true"
          />
          <TruncatedWithTooltip text={projectName} className="min-w-0" />
        </span>
      )}
      {degradedCauses.length > 0 && <DegradedMarker causes={degradedCauses} />}
      {worktreePath != null && (
        <Hint label={worktreePath}>
          <span
            data-testid="sessions-row-meta-worktree"
            className={[
              'inline-flex min-w-0 items-center gap-[3px] font-mono',
              worktreeMissing ? 'text-destructive' : 'text-muted-foreground',
            ].join(' ')}
          >
            <GitFork size={9} className="flex-shrink-0 text-mf-text-3" aria-hidden />
            <span className="max-w-[8rem] truncate">{worktreeBasename(worktreePath)}</span>
          </span>
        </Hint>
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
      <div className="flex-1" />
      {visibleTags.length > 0 && colorOf != null && (
        <Hint label={tags?.join(' · ')}>
          <span data-testid="sessions-row-meta-tag-dots" className="inline-flex flex-shrink-0 items-center gap-[3px]">
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
        </Hint>
      )}
    </div>
  );
}
