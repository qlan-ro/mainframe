import { useAuiState } from '@assistant-ui/react';
import {
  ClipboardCheck,
  EyeOff,
  GitPullRequest,
  GripHorizontal,
  LayoutPanelLeft,
  LayoutPanelTop,
  MessageSquare,
} from 'lucide-react';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useHost } from '@/lib/host';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { Hint } from '@/components/ui/hint';
import { ProjectChip } from '@/components/ui/project-chip';
import { useDraftConfigStore } from '../../sessions/runtime/draft-config';
import { useProjects } from '../../sessions/use-projects';
import { ChatSessionInline } from './ChatSessionInline';

// 24×24 header buttons (hdrBtn in artboard), distinct from the 22×22 SurfaceTabStrip actions.
const HDR_BTN =
  'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

const HEADER_ROOT_CLASS =
  'flex h-[36px] flex-shrink-0 items-center gap-[7px] pl-2 pr-1.5 [border-bottom:0.5px_solid_var(--border)]';

/**
 * Trimmed header for a `__LOCALID_*` draft thread (no daemon chat yet): grip,
 * chat icon, a fixed "New Session" title, and the draft's project chip. No
 * model chip / context meter / Review / PR pills — that state doesn't exist
 * until the chat is created on first send.
 */
function ChatCardHeaderDraft({ projectId, projectName }: { projectId: string | null; projectName: string | null }) {
  return (
    <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
      <GripHorizontal size={13} className="flex-shrink-0 cursor-grab text-mf-text-4" />
      <MessageSquare size={13} className="flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-initial truncate text-body font-semibold">New Session</span>
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
 * detected-PR links, a (gated) Review button, and the split controls. No
 * traffic-light inset — the shell `MainToolbar` above owns the collapsed clearance.
 */
function ChatCardHeaderReal() {
  const host = useHost();
  const title = useAuiState((s) => s.threadListItem?.title) ?? 'Untitled';
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const prs = custom?.detectedPrs ?? [];
  const worktreePath = custom?.worktreePath;
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const chatIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'chat'));
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
      <GripHorizontal size={13} className="flex-shrink-0 cursor-grab text-mf-text-4" />
      <MessageSquare size={13} className="flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-initial truncate text-body font-semibold">{title}</span>
      <ChatSessionInline part="model" />
      <span className="flex-1" />
      <ChatSessionInline part="status" />
      <Hint label="Review changes (⌘⇧R)">
        <button
          data-testid="chat-header-review"
          type="button"
          disabled={!worktreePath}
          onClick={() => emitSurfaceIntent({ type: 'open-review' })}
          className={`inline-flex h-6 flex-shrink-0 items-center gap-1.5 rounded-[6px] border-none bg-transparent px-2 text-caption text-muted-foreground ${!worktreePath ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-accent hover:text-foreground'}`}
        >
          <ClipboardCheck size={13} />
          Review
        </button>
      </Hint>
      {prs.map((pr) => (
        <Hint key={`${pr.owner}/${pr.repo}/${pr.number}`} label={`${pr.owner}/${pr.repo} #${pr.number}`}>
          <button
            data-testid={`chat-header-pr-${pr.number}`}
            type="button"
            onClick={() => void host.shell.openExternal(pr.url)}
            className="inline-flex flex-shrink-0 items-center gap-1 font-mono text-caption font-semibold text-foreground hover:underline"
          >
            <GitPullRequest size={12} className="flex-shrink-0 text-mf-success" />#{pr.number}
          </button>
        </Hint>
      ))}
      {splitAvailable && (
        <>
          <Hint label="Split right">
            <button
              data-testid="chat-header-split-right"
              type="button"
              onClick={() => splitSurface('v')}
              className={HDR_BTN}
            >
              <LayoutPanelLeft size={13} className="text-muted-foreground" />
            </button>
          </Hint>
          <Hint label="Split down">
            <button
              data-testid="chat-header-split-down"
              type="button"
              onClick={() => splitSurface('h')}
              className={HDR_BTN}
            >
              <LayoutPanelTop size={13} className="text-muted-foreground" />
            </button>
          </Hint>
        </>
      )}
      {/* Hide Chat — disabled when chat is the last lit surface (the dynamic floor). */}
      <Hint label="Hide Chat">
        <button
          data-testid="chat-header-hide"
          type="button"
          disabled={chatIsFloor}
          onClick={() => toggleSurface('chat')}
          className={`${HDR_BTN} ${chatIsFloor ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          <EyeOff size={13} className="text-muted-foreground" />
        </button>
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
