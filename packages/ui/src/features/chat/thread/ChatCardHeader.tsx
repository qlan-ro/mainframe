import { useAuiState } from '@assistant-ui/react';
import { EyeOff, LayoutPanelLeft, LayoutPanelTop, MessageSquare, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { ProjectChip } from '@/components/ui/project-chip';
import { useDraftConfigStore } from '../../sessions/runtime/draft-config';
import { useProjects } from '../../sessions/use-projects';
import { ChatModelChip } from './ChatModelChip';

/**
 * The chat surface's header row. Same height, border and gutters as the
 * workspace strip (`WorkspaceStripChrome.STRIP_ROW`) — one surface header
 * treatment, not two. `data-drag-region` hands the row to the OS as a window
 * drag region. (The old reposition grip is gone: chat only ever sits in the
 * top row, and with the split + the split-aware workspace placement there was
 * nothing left for dragging the chat surface to do.)
 */
const HEADER_ROOT_CLASS = 'flex h-9 shrink-0 items-center gap-[7px] pr-1.5 pl-2';

/**
 * Trimmed header for a `__LOCALID_*` draft thread (no daemon chat yet): chat
 * icon, a fixed "New Session" title, and the draft's project chip. No model
 * chip / PR pills — that state doesn't exist until the chat is created on
 * first send.
 */
function ChatCardHeaderDraft({ projectId, projectName }: { projectId: string | null; projectName: string | null }) {
  return (
    <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
      <MessageSquare size={13} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-initial truncate text-sm font-semibold">New Session</span>
      {projectId != null && projectName != null && (
        <ProjectChip projectId={projectId} name={projectName} size={16} data-testid="chat-header-project" />
      )}
      <span className="flex-1" />
    </div>
  );
}

/** Zone-mode controls: the split pair renders one header PER zone, and the
 *  zone's close ✕ replaces the whole-surface split/hide cluster. */
export interface ZoneHeaderControls {
  chatId: string;
  onClose: () => void;
}

/**
 * The chat zone's surface header (the `SurfaceTabStrip` equivalent for chat):
 * chat icon, session title and the split controls. Detected-PR links live in
 * the session panel's Summary (the header pills were retired with the
 * session-tabs rework); Review moved to the session panel. No traffic-light
 * inset — the shell `MainToolbar` above owns the collapsed clearance.
 *
 * In zone mode (`zone` set) the row belongs to ONE zone of the split: the
 * whole-surface controls (split, hide) drop and the zone close ✕ takes their
 * place; title/model resolve per zone through the rebound providers.
 */
function ChatCardHeaderReal({ zone }: { zone?: ZoneHeaderControls }) {
  const title = useAuiState((s) => s.threadListItem?.title) ?? 'Untitled';
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const chatIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'chat'));
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  if (zone != null) {
    return (
      <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
        <MessageSquare size={13} className="shrink-0 text-primary" />
        <span className="min-w-0 flex-initial truncate text-sm font-semibold">{title}</span>
        <ChatModelChip />
        <span className="flex-1" />
        <Hint label="Close zone">
          <Button
            data-testid={`chat-zone-close-${zone.chatId}`}
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              zone.onClose();
            }}
          >
            <X className="text-muted-foreground" />
          </Button>
        </Hint>
      </div>
    );
  }

  return (
    <div data-testid="chat-header" data-drag-region className={HEADER_ROOT_CLASS}>
      <MessageSquare size={13} className="shrink-0 text-primary" />
      <span className="min-w-0 flex-initial truncate text-sm font-semibold">{title}</span>
      <ChatModelChip />
      <span className="flex-1" />
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
export function ChatCardHeader({ zone }: { zone?: ZoneHeaderControls } = {}) {
  const localId = useAuiState((s) => s.threadListItem?.id ?? null);
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const isDraft = localId != null && localId.startsWith('__LOCALID_') && itemStatus === 'new';
  const draftCfg = useDraftConfigStore((s) => (localId ? s.drafts.get(localId) : undefined));
  const { projects } = useProjects();

  if (isDraft && zone == null) {
    const projectId = draftCfg?.projectId ?? null;
    const projectName = projectId != null ? (projects.find((p) => p.id === projectId)?.name ?? projectId) : null;
    return <ChatCardHeaderDraft projectId={projectId} projectName={projectName} />;
  }

  return <ChatCardHeaderReal zone={zone} />;
}
