/**
 * The session row's second line — the project on the left, indicator glyphs on
 * the right.
 *
 * Only the project is spelled out. Worktree, branch and PR names are identifiers
 * the row can never show in full anyway, and three truncated strings on one line
 * read as noise; as glyphs they answer "does this session have one?" at a glance
 * and the hover card answers "which one?". That keeps the whole cluster to a
 * fixed width, so the project name gets every pixel that is left.
 *
 * Nothing here is tinted except a missing worktree, which reads `warning` — a
 * desaturated red that sits at the panel's own ink lightness. The session still
 * works, its checkout is just gone; true `destructive` is reserved for the
 * irreversible actions in the menus.
 */
import { FolderGit2, GitBranch, GitPullRequest } from 'lucide-react';
import type { DetectedPr, TagColor } from '@qlan-ro/mainframe-types';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';
import { cn } from '@v2/lib/utils';

const MAX_ROW_TAG_DOTS = 3;

/**
 * 14px, not 12: these lucide marks differ a lot in how much of their box they
 * fill — the folder-with-branch crowds its strokes where the pull-request is
 * sparse — so at 12 the detailed one reads smaller and muddier than its
 * neighbour even though both boxes measure identically.
 */
const GLYPH_SIZE = 'size-3.5!';

interface SessionRowMetaLineProps {
  projectName?: string;
  worktreePath?: string;
  branchName?: string;
  /** The only glanceable failure signal on the row; the cause is in the hover card. */
  worktreeMissing?: boolean;
  detectedPrs: DetectedPr[];
  tags: string[];
  colorOf?: (name: string) => TagColor;
}

/** Worktree wins over branch: it names the checkout the session actually runs in. */
function WorktreeOrBranchGlyph({
  worktreePath,
  branchName,
  worktreeMissing,
}: Pick<SessionRowMetaLineProps, 'worktreePath' | 'branchName' | 'worktreeMissing'>) {
  if (worktreePath == null && branchName == null) return null;
  const Icon = worktreePath != null ? FolderGit2 : GitBranch;

  return (
    <Icon
      aria-hidden
      data-testid="sessions-row-meta-worktree"
      className={cn(GLYPH_SIZE, 'shrink-0', worktreeMissing === true && 'text-warning')}
    />
  );
}

export function SessionRowMetaLine({
  projectName,
  worktreePath,
  branchName,
  worktreeMissing = false,
  detectedPrs,
  tags,
  colorOf,
}: SessionRowMetaLineProps) {
  const visibleTags = colorOf != null ? tags.slice(0, MAX_ROW_TAG_DOTS) : [];

  const hasContent =
    projectName != null ||
    worktreePath != null ||
    branchName != null ||
    detectedPrs.length > 0 ||
    visibleTags.length > 0;
  if (!hasContent) return null;

  return (
    <span data-testid="sessions-row-meta" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {projectName != null && (
        <span data-testid="sessions-row-project" className="min-w-0 flex-1 truncate-fade">
          {projectName}
        </span>
      )}
      {/* ml-auto, not a spacer: the glyphs sit at the row's end whether or not
          there is a project name to push them there. Tag dots lead the cluster —
          they are the only colour in it, so they anchor better than they trail. */}
      <span data-testid="sessions-row-meta-glyphs" className="ml-auto flex shrink-0 items-center gap-1.5">
        {visibleTags.length > 0 && (
          <span data-testid="sessions-row-meta-tag-dots" className="inline-flex shrink-0 items-center gap-0.5">
            {visibleTags.map((name) => (
              // Inline style, not a utility: the tag palette is user-assigned, so it has no token to name.
              <span
                key={name}
                data-testid={`sessions-row-meta-tag-dot-${name}`}
                className="inline-block size-1.5 rounded-full"
                style={TAG_DOT_STYLE(colorOf?.(name) ?? 'blue')}
                aria-hidden="true"
              />
            ))}
          </span>
        )}
        <WorktreeOrBranchGlyph worktreePath={worktreePath} branchName={branchName} worktreeMissing={worktreeMissing} />
        {detectedPrs.length > 0 && (
          <GitPullRequest aria-hidden data-testid="sessions-row-meta-pr" className={cn(GLYPH_SIZE, 'shrink-0')} />
        )}
      </span>
    </span>
  );
}
