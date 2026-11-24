/**
 * The hover-detail body for a session row: full title, project, worktree or
 * branch, PRs, tags, provider, and any missing-artifact warning — everything the
 * one-line row leaves out.
 *
 * Content only — the row owns the `HoverCard` and the anchoring. The shipped
 * version portals itself to `document.body` and positions from a captured
 * DOMRect because no hover-card primitive was installed there; v2 has one, so
 * the manual portal and `use-row-hover-card` are dropped.
 */
import { AlertTriangle, Bot, FolderGit2, GitBranch, Split, Timer } from 'lucide-react';
import type { ChatDelegation, DetectedPr, TagColor } from '@qlan-ro/mainframe-types';
import { Badge } from '@/components/ui/badge';
import { NoProjectLabel } from '@/features/sessions/NoProjectLabel';
import { projectColor } from '@/features/sessions/sidebar/project-color';
import { TAG_CHIP_STYLE } from '@/features/sessions/tags/tag-colors';
import { worktreeBasename } from '@/features/sessions/sidebar/worktree-basename';
import { ProviderLogo } from '@/features/shared/ProviderLogo';
import { LINEAGE_GLYPH } from './lineage-glyph';
import { parentLineageValue, type ParentLineageState } from './view-model/fork-lineage';
import { delegatedByValue } from './view-model/agent-provenance';
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

/** Never both — a chat with no real project never has a projectName to show. */
function ProjectRow({
  projectId,
  projectName,
  noProject,
}: {
  projectId?: string;
  projectName?: string;
  noProject: boolean;
}) {
  if (!noProject && (projectName == null || projectId == null)) return null;
  return (
    <div data-testid="sessions-meta-card-project" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>Project</FieldLabel>
      {noProject ? (
        <NoProjectLabel data-testid="sessions-meta-card-no-project" size={14} />
      ) : (
        <>
          <ProjectAvatar name={projectName!} color={projectColor(projectId!)} size={14} />
          <span className="truncate">{projectName}</span>
        </>
      )}
    </div>
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
      <span className="truncate">{isWorktree ? worktreeBasename(worktreePath) : branchName}</span>
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

/** The parent's name; a link when it can be opened, plain text when it is archived or deleted. */
function ParentValue({ onOpen, children }: { onOpen?: () => void; children: string }) {
  if (onOpen == null) return <span className="truncate">{children}</span>;
  return (
    <button
      type="button"
      data-testid="sessions-meta-card-open-parent"
      className="truncate text-left text-primary hover:underline"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      {children}
    </button>
  );
}

function ForkedFromRow({ parentState, onOpenParent }: { parentState: ParentLineageState; onOpenParent?: () => void }) {
  const Glyph = LINEAGE_GLYPH.fork;
  return (
    <div data-testid="sessions-meta-card-forked-from" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>Forked from</FieldLabel>
      <Glyph aria-hidden className="size-3 shrink-0 rotate-90 text-muted-foreground" />
      <ParentValue onOpen={onOpenParent}>{parentLineageValue(parentState)}</ParentValue>
    </div>
  );
}

function DelegatedByRow({
  parentState,
  delegation,
  onOpenParent,
}: {
  parentState: ParentLineageState;
  delegation: ChatDelegation;
  onOpenParent?: () => void;
}) {
  const Glyph = LINEAGE_GLYPH.delegated;
  return (
    <div data-testid="sessions-meta-card-delegated-by" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>Delegated by</FieldLabel>
      <Glyph aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <ParentValue onOpen={onOpenParent}>{delegatedByValue(parentLineageValue(parentState), delegation)}</ParentValue>
    </div>
  );
}

function TemporaryRow() {
  return (
    <div data-testid="sessions-meta-card-temporary" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>Type</FieldLabel>
      <Timer aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">Temporary, deleted when closed</span>
    </div>
  );
}

function StartedByRow({ startedBy }: { startedBy: string }) {
  return (
    <div data-testid="sessions-meta-card-started-by" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>Started by</FieldLabel>
      <Bot aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{startedBy}</span>
    </div>
  );
}

/** A delegated child names its parent as the delegator; any other child as the chat it forked from. */
function LineageRows({
  parentState,
  delegation,
  startedBy,
  onOpenParent,
}: Pick<SessionMetaCardProps, 'parentState' | 'delegation' | 'startedBy' | 'onOpenParent'>) {
  return (
    <>
      {parentState != null &&
        (delegation != null ? (
          <DelegatedByRow parentState={parentState} delegation={delegation} onOpenParent={onOpenParent} />
        ) : (
          <ForkedFromRow parentState={parentState} onOpenParent={onOpenParent} />
        ))}
      {startedBy != null && <StartedByRow startedBy={startedBy} />}
    </>
  );
}

function ForkCountRow({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <div data-testid="sessions-meta-card-fork-count" className="flex items-center gap-1.5 text-xs">
      <FieldLabel>Forked</FieldLabel>
      <Split aria-hidden className="size-3 shrink-0 rotate-90 text-muted-foreground" />
      <span className="truncate">{count}x</span>
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
  /** True for a chat with no real project — renders NoProjectLabel instead of the project name (todo #346). */
  noProject?: boolean;
  adapterId?: string;
  /** Deleted rather than archived when closed (todo #346). */
  temporary?: boolean;
  worktreePath?: string;
  branchName?: string;
  worktreeMissing: boolean;
  transcriptMissing: boolean;
  detectedPrs: DetectedPr[];
  tags: string[];
  colorOf?: (name: string) => TagColor;
  /** Set on any child — the "Forked from" line, or "Delegated by" with `delegation`. */
  parentState?: ParentLineageState;
  /** Opens the parent chat; absent when it is archived or deleted. */
  onOpenParent?: () => void;
  /** Set on a delegated child: its role and live task status. */
  delegation?: ChatDelegation;
  /** The quoted title of the chat whose agent launched this one (`chat_launch`). */
  startedBy?: string;
  /** Listed, non-archived direct forks of this chat — the "Forked Nx" line (omitted at 0). */
  forkCount?: number;
}

/**
 * The title takes the document's UI size; every field steps down to `text-xs`.
 */
export function SessionMetaCard({
  title,
  projectId,
  projectName,
  noProject = false,
  adapterId,
  temporary = false,
  worktreePath,
  branchName,
  worktreeMissing,
  transcriptMissing,
  detectedPrs,
  tags,
  colorOf,
  parentState,
  onOpenParent,
  delegation,
  startedBy,
  forkCount = 0,
}: SessionMetaCardProps) {
  return (
    <div data-testid="sessions-meta-card" className="flex flex-col gap-1.5">
      {/* Clamped: the row already truncates this, and a pathological title —
          a pasted paragraph, an unbroken branch name — would otherwise grow the
          card without bound. `break-words` keeps an unspaced one inside it. */}
      <span className="flex items-start gap-1.5">
        {adapterId != null && (
          <ProviderLogo
            adapterId={adapterId}
            muted
            testId="sessions-meta-card-provider"
            className="mt-0.5 size-3.5 shrink-0"
          />
        )}
        <span
          data-testid="sessions-meta-card-title"
          className="line-clamp-3 min-w-0 font-semibold break-words text-muted-foreground"
        >
          {title}
        </span>
      </span>
      <ProjectRow projectId={projectId} projectName={projectName} noProject={noProject} />
      {temporary && <TemporaryRow />}
      <LineageRows
        parentState={parentState}
        delegation={delegation}
        startedBy={startedBy}
        onOpenParent={onOpenParent}
      />
      <ForkCountRow count={forkCount} />
      <WorktreeOrBranchRow worktreePath={worktreePath} branchName={branchName} />
      <PrRow detectedPrs={detectedPrs} />
      <TagsRow tags={tags} colorOf={colorOf} />
      <WarningRow worktreeMissing={worktreeMissing} transcriptMissing={transcriptMissing} />
    </div>
  );
}
