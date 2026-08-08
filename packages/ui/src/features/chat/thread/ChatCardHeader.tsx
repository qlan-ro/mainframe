import { useAuiState } from '@assistant-ui/react';
import { EyeOff, GitPullRequest, GripHorizontal, LayoutPanelLeft, LayoutPanelTop, MessageSquare } from 'lucide-react';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useHost } from '@/lib/host';
import { ProjectChip } from '@/components/ui/project-chip';
import { useDraftConfigStore } from '../../sessions/runtime/draft-config';
import { useProjects } from '../../sessions/use-projects';
import { ChatModelChip } from './ChatModelChip';

/**
 * The chat surface's header row. Same height, border and gutters as the
 * workspace strip (`WorkspaceStripChrome.STRIP_ROW`) — one surface header
 * treatment, not two — but its own file: the workspace's leading grip begins a
 * surface DRAG, while `data-drag-region` here hands the row to the OS as a
 * window drag region, so nothing is shared but the vocabulary.
 */
const HEADER_ROOT_CLASS = 'flex h-9 shrink-0 items-center gap-[7px] border-b border-border pr-1.5 pl-2';

/**
 * The chat surface's reposition grip. Emits an intent rather than reaching into
 * `layout/` (features never import it); SurfaceHost forwards it to the drag
 * store. `data-no-drag` keeps the host's window-drag handler off the gesture —
 * the row is a window drag region and the grip is not a <button>.
 */
function ChatSurfaceGrip() {
  return (
    <span
      data-testid="chat-header-grip"
      data-no-drag
      className="shrink-0 cursor-grab"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        emitSurfaceIntent({ type: 'begin-surface-drag', surface: 'chat', clientX: e.clientX, clientY: e.clientY });
      }}
    >
      <GripHorizontal size={13} className="text-muted-foreground" />
    </span>
  );
}

/**
 * Trimmed header for a `__LOCALID_*` draft thread (no daemon chat yet): grip,
 * chat icon, a fixed "New Session" title, and the draft's project chip. No
 * model chip / PR pills — that state doesn't exist
 * until the chat is created on first send.
 */
function ChatCardHeaderDraft({ projectId, projectName }: { projectId: string | null; projectName: string | null }) {
  return (
    <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
      <ChatSurfaceGrip />
      <MessageSquare size={13} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-initial truncate text-sm font-semibold">New Session</span>
      {projectId != null && projectName != null && (
        <ProjectChip projectId={projectId} name={projectName} size={16} data-testid="chat-header-project" />
      )}
      <span className="flex-1" />
    </div>
  );
}

/**
 * The chat zone's surface header (the `SurfaceTabStrip` equivalent for chat):
 * drag-to-reposition grip (visual-only placeholder), chat icon, session title,
 * detected-PR links and the split controls (Review moved to the session panel). No
 * traffic-light inset — the shell `MainToolbar` above owns the collapsed clearance.
 */
function ChatCardHeaderReal() {
  const host = useHost();
  const title = useAuiState((s) => s.threadListItem?.title) ?? 'Untitled';
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const prs = custom?.detectedPrs ?? [];
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const chatIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'chat'));
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
      <ChatSurfaceGrip />
      <MessageSquare size={13} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-initial truncate text-sm font-semibold">{title}</span>
      <ChatModelChip />
      <span className="flex-1" />
      {prs.map((pr) => (
        <Hint key={`${pr.owner}/${pr.repo}/${pr.number}`} label={`${pr.owner}/${pr.repo} #${pr.number}`}>
          <Button
            data-testid={`chat-header-pr-${pr.number}`}
            variant="ghost"
            size="xs"
            onClick={() => void host.shell.openExternal(pr.url)}
            className="font-mono font-semibold"
          >
            <GitPullRequest data-icon="inline-start" className="text-success" />#{pr.number}
          </Button>
        </Hint>
      ))}
      {splitAvailable && (
        <>
          <Hint label="Split right">
            <Button
              data-testid="chat-header-split-right"
              variant="ghost"
              size="icon-xs"
              onClick={() => splitSurface('v')}
            >
              <LayoutPanelLeft className="text-muted-foreground" />
            </Button>
          </Hint>
          <Hint label="Split down">
            <Button
              data-testid="chat-header-split-down"
              variant="ghost"
              size="icon-xs"
              onClick={() => splitSurface('h')}
            >
              <LayoutPanelTop className="text-muted-foreground" />
            </Button>
          </Hint>
        </>
      )}
      {/* Hide Chat — disabled when chat is the last lit surface (the dynamic floor). */}
      <Hint label={chatIsFloor ? 'Chat is the only surface left' : 'Hide Chat'}>
        <Button
          data-testid="chat-header-hide"
          variant="ghost"
          size="icon-xs"
          disabled={chatIsFloor}
          onClick={() => toggleSurface('chat')}
        >
          <EyeOff className="text-muted-foreground" />
        </Button>
      </Hint>
    </div>
  );
}

/**
 * Entry point: detects a `__LOCALID_*` draft thread (status `new`, no daemon
 * chat yet) and renders the trimmed draft header instead of the full one.
 * Both branches are distinct components (not an early return inside one
 * function body) so switching between a draft and a real chat — which can
 * happen on the same mounted `ChatCardHeader` as the active thread changes —
 * cleanly mounts/unmounts each side rather than conditionally skipping hooks
 * within a single component instance.
 */
export function ChatCardHeader() {
  const localId = useAuiState((s) => s.threadListItem?.id ?? null);
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const isDraft = localId != null && localId.startsWith('__LOCALID_') && itemStatus === 'new';
  const draftCfg = useDraftConfigStore((s) => (localId ? s.drafts.get(localId) : undefined));
  const { projects } = useProjects();

  if (isDraft) {
    const projectId = draftCfg?.projectId ?? null;
    const projectName = projectId != null ? (projects.find((p) => p.id === projectId)?.name ?? projectId) : null;
    return <ChatCardHeaderDraft projectId={projectId} projectName={projectName} />;
  }

  return <ChatCardHeaderReal />;
}
