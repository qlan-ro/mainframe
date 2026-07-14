/**
 * SessionMetaCard — the floating hover-detail card for a compact session row
 * (2026-07 sidebar rebuild). The single-row layout only shows glyphs
 * (SessionRowMetaIcons); this card surfaces the full text: title + time,
 * project, worktree/branch, PR, tags, and a branch-safety warning.
 *
 * Portalled to document.body and positioned via a captured DOMRect (fixed,
 * to the right of the row) rather than a Radix Popover/HoverCard — no
 * `@radix-ui/react-hover-card` is installed in this package, and the anchor
 * lives far from any local trigger (the row owns the rect, the card is
 * rendered on hover, no focus-trap/dismiss logic is needed for read-only
 * content). Revisit with a real HoverCard primitive if richer interaction
 * (click-through links, keyboard dismiss) is ever needed here.
 */
import { createPortal } from 'react-dom';
import { FolderGit2, GitBranch, AlertTriangle } from 'lucide-react';
import type { DetectedPr, TagColor } from '@qlan-ro/mainframe-types';
import { formatRelativeTime } from '../view-model/relative-time';
import { projectColor } from './project-color';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import { worktreeBasename } from './worktree-basename';

const CARD_GAP_PX = 8;

interface SessionMetaCardProps {
  anchorRect: DOMRect;
  title: string;
  updatedAt: number;
  now?: number;
  projectId?: string;
  projectName?: string;
  worktreePath?: string;
  branchName?: string;
  worktreeMissing: boolean;
  transcriptMissing: boolean;
  detectedPrs: DetectedPr[];
  tags: string[];
  colorOf?: (name: string) => TagColor;
}

function WorktreeOrBranchRow({ worktreePath, branchName }: { worktreePath?: string; branchName?: string }) {
  if (worktreePath == null && branchName == null) return null;
  const text = worktreePath != null ? worktreeBasename(worktreePath) : (branchName as string);
  const Icon = worktreePath != null ? FolderGit2 : GitBranch;
  return (
    <div data-testid="sessions-meta-card-worktree" className="flex items-center gap-[6px] font-mono text-caption">
      <Icon size={12} className="flex-shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{text}</span>
    </div>
  );
}

function WarningRow({ worktreeMissing, transcriptMissing }: { worktreeMissing: boolean; transcriptMissing: boolean }) {
  const causes = [
    ...(worktreeMissing ? ['Worktree missing'] : []),
    ...(transcriptMissing ? ['Transcript missing'] : []),
  ];
  if (causes.length === 0) return null;
  return (
    <div data-testid="sessions-meta-card-warning" className="flex items-center gap-[6px] text-caption text-destructive">
      <AlertTriangle size={12} className="flex-shrink-0" aria-hidden />
      <span>{causes.join(' · ')}</span>
    </div>
  );
}

function TagsRow({ tags, colorOf }: { tags: string[]; colorOf?: (name: string) => TagColor }) {
  if (tags.length === 0 || colorOf == null) return null;
  return (
    <div data-testid="sessions-meta-card-tags" className="flex flex-wrap items-center gap-[5px]">
      {tags.map((name) => (
        <span
          key={name}
          className="inline-flex items-center gap-[4px] rounded-[9px] bg-accent px-[7px] py-[1px] text-caption font-medium text-foreground"
        >
          <span className="size-[6px] rounded-full" style={TAG_DOT_STYLE(colorOf(name))} aria-hidden="true" />
          {name}
        </span>
      ))}
    </div>
  );
}

export function SessionMetaCard({
  anchorRect,
  title,
  updatedAt,
  now = Date.now(),
  projectId,
  projectName,
  worktreePath,
  branchName,
  worktreeMissing,
  transcriptMissing,
  detectedPrs,
  tags,
  colorOf,
}: SessionMetaCardProps) {
  const chipColor = projectId != null ? projectColor(projectId) : undefined;

  return createPortal(
    <div
      data-testid="sessions-meta-card"
      role="tooltip"
      style={{ position: 'fixed', top: anchorRect.top, left: anchorRect.right + CARD_GAP_PX }}
      className="z-50 w-[220px] max-w-xs rounded-lg border border-border bg-popover p-[10px] text-popover-foreground shadow-[var(--mf-shadow-pop)]"
    >
      <div className="flex flex-col gap-[6px]">
        <div className="flex items-center justify-between gap-[8px]">
          <span data-testid="sessions-meta-card-title" className="min-w-0 truncate text-body font-semibold">
            {title}
          </span>
          <span data-testid="sessions-meta-card-time" className="flex-shrink-0 text-caption text-muted-foreground">
            {formatRelativeTime(updatedAt, now)}
          </span>
        </div>
        {projectName != null && chipColor != null && (
          <div data-testid="sessions-meta-card-project" className="flex items-center gap-[6px] text-caption">
            <span
              className="size-[6px] flex-shrink-0 rounded-full"
              style={{ backgroundColor: chipColor }}
              aria-hidden="true"
            />
            <span className="truncate" style={{ color: chipColor }}>
              {projectName}
            </span>
          </div>
        )}
        <WorktreeOrBranchRow worktreePath={worktreePath} branchName={branchName} />
        {detectedPrs.length > 0 && (
          <div
            data-testid="sessions-meta-card-pr"
            className="flex flex-wrap items-center gap-[8px] font-mono text-caption font-semibold"
          >
            {detectedPrs.map((pr) => (
              <a
                key={pr.number}
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                className="text-mf-success hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                #{pr.number}
              </a>
            ))}
          </div>
        )}
        <TagsRow tags={tags} colorOf={colorOf} />
        <WarningRow worktreeMissing={worktreeMissing} transcriptMissing={transcriptMissing} />
      </div>
    </div>,
    document.body,
  );
}
