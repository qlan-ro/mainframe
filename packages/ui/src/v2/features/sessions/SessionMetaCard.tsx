/**
 * The hover-detail body for a session row: full title, project, worktree or
 * branch, PRs, tags, and any missing-artifact warning.
 *
 * Content only — the row owns the `HoverCard` and the anchoring. The shipped
 * version portals itself to `document.body` and positions from a captured
 * DOMRect because no hover-card primitive was installed there; v2 has one, so
 * the manual portal and `use-row-hover-card` are dropped.
 */
import { AlertTriangle, FolderGit2, GitBranch } from 'lucide-react';
import type { DetectedPr, TagColor } from '@qlan-ro/mainframe-types';
import { Badge } from '@v2/components/ui/badge';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { TAG_CHIP_STYLE } from '@/features/sessions/tags/tag-colors';
import { worktreeBasename } from '@/features/sessions/sidebar/worktree-basename';
import { ProjectAvatar } from './ProjectAvatar';

/** Fixed-width caption naming the row's value, so the card never leans on icon semantics alone. */
function FieldLabel({ children }: { children: string }) {
  return (
    <span
      data-testid={`sessions-meta-card-label-${children.toLowerCase()}`}
      className="w-12 shrink-0 text-muted-foreground"
    >
      {children}
    </span>
  );
}

function WorktreeOrBranchRow({ worktreePath, branchName }: { worktreePath?: string; branchName?: string }) {
  if (worktreePath == null && branchName == null) return null;
  const isWorktree = worktreePath != null;
  const Icon = isWorktree ? FolderGit2 : GitBranch;
  return (
    <div data-testid="sessions-meta-card-worktree" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>{isWorktree ? 'Worktree' : 'Branch'}</FieldLabel>
      <Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono">{isWorktree ? worktreeBasename(worktreePath) : branchName}</span>
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
    <div data-testid="sessions-meta-card-warning" className="flex items-center gap-1.5 text-xs text-warning">
      <AlertTriangle aria-hidden className="size-3 shrink-0" />
      <span>{causes.join(' · ')}</span>
    </div>
  );
}

function TagsRow({ tags, colorOf }: { tags: string[]; colorOf?: (name: string) => TagColor }) {
  if (tags.length === 0 || colorOf == null) return null;
  return (
    <div data-testid="sessions-meta-card-tags" className="flex items-start gap-1.5 text-xs">
      <FieldLabel>Tags</FieldLabel>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {tags.map((name) => (
          // Inline style, not a utility: the tag palette is user-assigned per tag.
          <Badge key={name} variant="secondary" style={TAG_CHIP_STYLE(colorOf(name))}>
            {name}
          </Badge>
        ))}
      </div>
    </div>
  );
}

function PrRow({ detectedPrs }: { detectedPrs: DetectedPr[] }) {
  if (detectedPrs.length === 0) return null;
  return (
    <div data-testid="sessions-meta-card-pr" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>PR</FieldLabel>
      <div className="flex flex-1 flex-wrap items-center gap-2 font-mono font-semibold">
        {detectedPrs.map((pr) => (
          <a
            key={pr.number}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            // The one link in the card, and the only thing here that navigates —
            // it takes the accent, like the task numbers in the sidebar.
            className="text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{pr.number}
          </a>
        ))}
      </div>
    </div>
  );
}

interface SessionMetaCardProps {
  title: string;
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

/**
 * The title takes the document's UI size; every field steps down to `text-xs`.
 */
export function SessionMetaCard({
  title,
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
  return (
    <div data-testid="sessions-meta-card" className="flex flex-col gap-1.5">
      {/* Clamped: the row already truncates this, and a pathological title —
          a pasted paragraph, an unbroken branch name — would otherwise grow the
          card without bound. `break-words` keeps an unspaced one inside it. */}
      <span
        data-testid="sessions-meta-card-title"
        className="line-clamp-3 font-semibold break-words text-muted-foreground"
      >
        {title}
      </span>
      {projectName != null && projectId != null && (
        <div data-testid="sessions-meta-card-project" className="flex items-center gap-1.5 text-xs">
          <FieldLabel>Project</FieldLabel>
          <ProjectAvatar name={projectName} color={projectColor(projectId)} size={14} />
          <span className="truncate">{projectName}</span>
        </div>
      )}
      <WorktreeOrBranchRow worktreePath={worktreePath} branchName={branchName} />
      <PrRow detectedPrs={detectedPrs} />
      <TagsRow tags={tags} colorOf={colorOf} />
      <WarningRow worktreeMissing={worktreeMissing} transcriptMissing={transcriptMissing} />
    </div>
  );
}
