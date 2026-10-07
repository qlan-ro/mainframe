/**
 * The session row's second line — the project on the left (or "your turn"
 * while the session waits on you), indicator glyphs on the right, ending with
 * the provider's muted mark.
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
import { FolderGit2, GitBranch, GitPullRequest, Timer } from 'lucide-react';
import type { DetectedPr, TagColor } from '@qlan-ro/mainframe-types';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { NoProjectLabel } from '@/features/sessions/NoProjectLabel';
import { ProviderLogo } from '@/features/shared/ProviderLogo';
import { TAG_DOT_STYLE } from '@/features/sessions/tags/tag-colors';
import { cn } from '@/lib/utils';
import { LINEAGE_GLYPH } from './lineage-glyph';
import type { LineageRelation } from './view-model/fork-lineage';

/** The fallback fork glyph's content — a non-nested fork whose parent isn't adjacent in this group. */
export interface ForkFallback {
  hint: string;
  /** A delegated child's fallback draws the task glyph, not the fork's. */
  relation: LineageRelation;
  /** Absent when the parent is archived or deleted — the glyph is then inert. */
  onActivate?: () => void;
}

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
  /** The session waits on the user: "your turn" takes the project's slot. */
  waiting?: boolean;
  /** The adapter's muted mark closes the glyph cluster; absent for a draft. */
  adapterId?: string;
  /** True for a chat with no real project — renders NoProjectLabel instead of projectName/ProjectAvatar (todo #346). */
  noProject?: boolean;
  worktreePath?: string;
  branchName?: string;
  /** The only glanceable failure signal on the row; the cause is in the hover card. */
  worktreeMissing?: boolean;
  /** Excluded from default listings, deleted rather than archived on close — the sidebar always shows these now (todo #346). */
  temporary?: boolean;
  detectedPrs: DetectedPr[];
  tags: string[];
  colorOf?: (name: string) => TagColor;
  /** Set only for a non-nested fork (its parent isn't adjacent in this group) — todo #343. */
  forkFallback?: ForkFallback;
  /** A delegated child's `Task · <role>`, which takes the project's slot: it shares its parent's project. */
  taskLabel?: string;
}

/** The fallback glyph for a child whose parent isn't nestable here — Hint-wrapped. */
function ForkFallbackGlyph({ forkFallback }: { forkFallback: ForkFallback }) {
  const Glyph = LINEAGE_GLYPH[forkFallback.relation];
  return (
    <Hint label={forkFallback.hint}>
      <span
        data-testid="sessions-row-parent-link"
        className={cn('flex shrink-0 items-center', forkFallback.onActivate != null && 'cursor-pointer')}
        onClick={
          forkFallback.onActivate == null
            ? undefined
            : (e) => {
                e.stopPropagation();
                forkFallback.onActivate?.();
              }
        }
      >
        <Glyph aria-hidden className={cn(GLYPH_SIZE, 'shrink-0')} />
      </span>
    </Hint>
  );
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
  waiting = false,
  adapterId,
  noProject = false,
  worktreePath,
  branchName,
  worktreeMissing = false,
  temporary = false,
  detectedPrs,
  tags,
  colorOf,
  forkFallback,
  taskLabel,
}: SessionRowMetaLineProps) {
  const visibleTags = colorOf != null ? tags.slice(0, MAX_ROW_TAG_DOTS) : [];

  const hasContent =
    projectName != null ||
    waiting ||
    adapterId != null ||
    noProject ||
    worktreePath != null ||
    branchName != null ||
    detectedPrs.length > 0 ||
    visibleTags.length > 0 ||
    temporary ||
    forkFallback != null ||
    taskLabel != null;
  if (!hasContent) return null;

  return (
    <span data-testid="sessions-row-meta" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {waiting ? (
        <span data-testid="sessions-row-your-turn" className="min-w-0 flex-1 truncate font-medium text-warning">
          your turn
        </span>
      ) : taskLabel != null ? (
        <FadeLabel data-testid="sessions-row-task-label" className="flex-1">
          {taskLabel}
        </FadeLabel>
      ) : noProject ? (
        <NoProjectLabel data-testid="sessions-row-no-project" className="flex-1" />
      ) : (
        projectName != null && (
          <FadeLabel data-testid="sessions-row-project" className="flex-1">
            {projectName}
          </FadeLabel>
        )
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
        {temporary && (
          <Hint label="Temporary — deleted when closed">
            <Timer aria-hidden data-testid="sessions-row-temporary-glyph" className={cn(GLYPH_SIZE, 'shrink-0')} />
          </Hint>
        )}
        {forkFallback != null && <ForkFallbackGlyph forkFallback={forkFallback} />}
        {adapterId != null && (
          <ProviderLogo adapterId={adapterId} muted testId="sessions-row-provider" className="size-3.5 shrink-0" />
        )}
      </span>
    </span>
  );
}
