/**
 * SessionRowMetaIcons — the row's purely decorative trailing glyph cluster
 * (2026-07 sidebar rebuild, reworked for #285): the worktree glyph and up to
 * 3 tag dots. No PR input lives here — the PR chip and count indicator sit
 * beside it in the row's own fixed PR region (SessionRowPrRegion) so an
 * interactive element can never wrap, clip, or be starved by this cluster
 * (see session-row-layout.ts).
 *
 * The cluster itself never shrinks (SESSION_ROW_META_CLUSTER is
 * flex-shrink-0): each child yields independently, at its own container-query
 * threshold, present at natural width or entirely absent. Tag dots yield
 * first; the worktree glyph survives further into the narrow end.
 */
import { FolderGit2 } from 'lucide-react';
import type { TagColor } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '../tags/tag-colors';
import { Hint } from '@/components/ui/hint';
import { worktreeBasename } from './worktree-basename';
import { SESSION_ROW_META_CLUSTER, SESSION_ROW_DOT_YIELD_CLASS, SESSION_ROW_WORKTREE_YIELD_CLASS } from './session-row-layout';

const MAX_ROW_TAG_DOTS = 3;

interface SessionRowMetaIconsProps {
  worktreePath?: string;
  /** Flips the worktree glyph destructive — the only glanceable signal left on
   *  the compact row (the full "Worktree missing" cause text lives in the hover card). */
  worktreeMissing?: boolean;
  tags: string[];
  colorOf?: (name: string) => TagColor;
}

export function SessionRowMetaIcons({ worktreePath, worktreeMissing = false, tags, colorOf }: SessionRowMetaIconsProps) {
  const visibleTags = colorOf != null ? tags.slice(0, MAX_ROW_TAG_DOTS) : [];
  const hasContent = worktreePath != null || visibleTags.length > 0;
  if (!hasContent) return null;

  return (
    <div data-testid="sessions-row-meta-icons" className={SESSION_ROW_META_CLUSTER}>
      {worktreePath != null && (
        <Hint
          label={
            worktreeMissing ? `${worktreeBasename(worktreePath)} — Worktree missing` : worktreeBasename(worktreePath)
          }
        >
          <span
            data-testid="sessions-row-meta-icon-worktree"
            className={[
              'inline-flex items-center',
              SESSION_ROW_WORKTREE_YIELD_CLASS,
              worktreeMissing ? 'text-destructive' : '',
            ]
              .join(' ')
              .trim()}
          >
            <FolderGit2 size={14} aria-hidden />
          </span>
        </Hint>
      )}
      {visibleTags.length > 0 && colorOf != null && (
        <Hint label={tags.join(' · ')}>
          <span
            data-testid="sessions-row-meta-icon-tag-dots"
            className={`inline-flex items-center gap-[3px] ${SESSION_ROW_DOT_YIELD_CLASS}`}
          >
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
