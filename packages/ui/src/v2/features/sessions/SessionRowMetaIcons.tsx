/**
 * The row's trailing glyph cluster — worktree, PRs, tag dots. Icon-only by
 * design: the full text (project, branch, PR title, tag pills) lives in the
 * hover card, so the row stays one line.
 *
 * Stock has one semantic hue, so the PR link drops the shipped success green
 * and reads as muted ink like its neighbours; only "worktree missing" keeps a
 * hue, since `destructive` is the one stock does ship.
 */
import { FolderGit2 } from 'lucide-react';
import type { TagColor, DetectedPr } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';
import { worktreeBasename } from '@/features/sessions/sidebar/worktree-basename';
import { Hint } from '@v2/components/ui/hint';
import { cn } from '@v2/lib/utils';

const MAX_ROW_TAG_DOTS = 3;

/**
 * A session can accumulate a whole branch's worth of PRs — one row here carried
 * eight, and since the cluster never shrinks that squeezed the title to nothing.
 * The overflow is a count; the hover card still lists every link.
 */
const MAX_ROW_PRS = 2;

interface SessionRowMetaIconsProps {
  worktreePath?: string;
  /** Flips the worktree glyph destructive — the only glanceable signal on the
   *  compact row; the cause text lives in the hover card. */
  worktreeMissing?: boolean;
  detectedPrs: DetectedPr[];
  tags: string[];
  colorOf?: (name: string) => TagColor;
}

export function SessionRowMetaIcons({
  worktreePath,
  worktreeMissing = false,
  detectedPrs,
  tags,
  colorOf,
}: SessionRowMetaIconsProps) {
  const visibleTags = colorOf != null ? tags.slice(0, MAX_ROW_TAG_DOTS) : [];
  const visiblePrs = detectedPrs.slice(0, MAX_ROW_PRS);
  const hiddenPrs = detectedPrs.length - visiblePrs.length;
  const hasContent = worktreePath != null || detectedPrs.length > 0 || visibleTags.length > 0;
  if (!hasContent) return null;

  return (
    <div data-testid="sessions-row-meta-icons" className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
      {worktreePath != null && (
        <Hint
          label={
            worktreeMissing ? `${worktreeBasename(worktreePath)} — Worktree missing` : worktreeBasename(worktreePath)
          }
        >
          <span
            data-testid="sessions-row-meta-icon-worktree"
            className={cn('inline-flex items-center', worktreeMissing && 'text-destructive')}
          >
            <FolderGit2 aria-hidden className="size-3.5" />
          </span>
        </Hint>
      )}
      {visiblePrs.map((pr) => (
        <a
          key={pr.number}
          data-testid="sessions-row-meta-icon-pr"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center font-mono text-xs font-semibold hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
        </a>
      ))}
      {hiddenPrs > 0 && (
        <Hint label={detectedPrs.map((pr) => `#${pr.number}`).join(' · ')}>
          <span data-testid="sessions-row-meta-icon-pr-overflow" className="font-mono text-xs">
            +{hiddenPrs}
          </span>
        </Hint>
      )}
      {visibleTags.length > 0 && colorOf != null && (
        <Hint label={tags.join(' · ')}>
          <span data-testid="sessions-row-meta-icon-tag-dots" className="inline-flex items-center gap-0.5">
            {visibleTags.map((name) => (
              // Inline style, not a utility: the tag palette is user-assigned, so it has no token to name.
              <span
                key={name}
                data-testid={`sessions-row-meta-icon-tag-dot-${name}`}
                className="inline-block size-1.5 rounded-full"
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
