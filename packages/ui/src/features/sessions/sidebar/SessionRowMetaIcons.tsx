/**
 * SessionRowMetaIcons — the compact single-row trailing glyph cluster
 * (2026-07 sidebar rebuild). Worktree/PR/tag info used to render as a full
 * second meta line (the old SessionRowMeta, since removed — its content now
 * lives in SessionMetaCard's hover card); here it collapses to icon-only
 * glyphs so the row stays one line. Worktree is icon-only (no basename text
 * — that lives in the hover card); PR keeps its short "#N" number; tags cap
 * at 3 dots (one fewer than the hover card's full pill list, since row space
 * is tighter).
 */
import { FolderGit2 } from 'lucide-react';
import type { TagColor, DetectedPr } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import { Hint } from '@/components/ui/hint';
import { worktreeBasename } from './worktree-basename';

const MAX_ROW_TAG_DOTS = 3;

interface SessionRowMetaIconsProps {
  worktreePath?: string;
  /** Flips the worktree glyph destructive — the only glanceable signal left on
   *  the compact row (the full "Worktree missing" cause text lives in the hover card). */
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
  const hasContent = worktreePath != null || detectedPrs.length > 0 || visibleTags.length > 0;
  if (!hasContent) return null;

  return (
    <div
      data-testid="sessions-row-meta-icons"
      className="flex flex-shrink-0 items-center gap-[6px] text-muted-foreground"
    >
      {worktreePath != null && (
        <Hint
          label={
            worktreeMissing ? `${worktreeBasename(worktreePath)} — Worktree missing` : worktreeBasename(worktreePath)
          }
        >
          <span
            data-testid="sessions-row-meta-icon-worktree"
            className={['inline-flex items-center', worktreeMissing ? 'text-destructive' : ''].join(' ').trim()}
          >
            <FolderGit2 size={11} aria-hidden />
          </span>
        </Hint>
      )}
      {detectedPrs.map((pr) => (
        <a
          key={pr.number}
          data-testid="sessions-row-meta-icon-pr"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center font-mono text-caption font-semibold text-mf-success hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          #{pr.number}
        </a>
      ))}
      {visibleTags.length > 0 && colorOf != null && (
        <Hint label={tags.join(' · ')}>
          <span data-testid="sessions-row-meta-icon-tag-dots" className="inline-flex items-center gap-[3px]">
            {visibleTags.map((name) => (
              <span
                key={name}
                data-testid={`sessions-row-meta-icon-tag-dot-${name}`}
                className="inline-block size-[5px] rounded-full"
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
