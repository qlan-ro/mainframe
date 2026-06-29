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
import { sessionCustomOf } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useHost } from '@/lib/host';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { Hint } from '@/components/ui/hint';

// 24×24 header buttons (hdrBtn in artboard), distinct from the 22×22 SurfaceTabStrip actions.
const HDR_BTN =
  'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

/**
 * The chat zone's surface header (the `SurfaceTabStrip` equivalent for chat):
 * drag-to-reposition grip (visual-only placeholder), chat icon, session title,
 * detected-PR links, a (gated) Review button, and the split controls. No
 * traffic-light inset — the shell `MainToolbar` above owns the collapsed clearance.
 */
export function ChatCardHeader() {
  const host = useHost();
  const title = useAuiState((s) => s.threadListItem?.title) ?? 'Untitled';
  const custom = useAuiState((s) => sessionCustomOf(s.threadListItem?.custom));
  const prs = custom?.detectedPrs ?? [];
  const worktreePath = custom?.worktreePath;
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const chatIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'chat'));
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);

  return (
    <div
      data-testid="chat-header"
      data-drag-region
      className="flex h-[38px] flex-shrink-0 items-center gap-[7px] pl-2 pr-1.5 [border-bottom:0.5px_solid_var(--border)]"
    >
      <GripHorizontal size={13} className="flex-shrink-0 cursor-grab text-mf-text-4" />
      <MessageSquare size={13} className="flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-caption font-semibold">{title}</span>
      {prs.map((pr) => (
        <Hint key={`${pr.owner}/${pr.repo}/${pr.number}`} label={`${pr.owner}/${pr.repo} #${pr.number}`}>
          <button
            data-testid={`chat-header-pr-${pr.number}`}
            type="button"
            onClick={() => void host.shell.openExternal(pr.url)}
            className="inline-flex flex-shrink-0 items-center gap-1 font-mono text-caption font-semibold text-mf-success hover:underline"
          >
            <GitPullRequest size={12} className="flex-shrink-0" />#{pr.number}
          </button>
        </Hint>
      ))}
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
      {splitAvailable && (
        <>
          <Hint label="Split right">
            <button
              data-testid="chat-header-split-right"
              type="button"
              onClick={() => splitSurface('v')}
              className={HDR_BTN}
            >
              <LayoutPanelLeft size={13} className="text-mf-text-3" />
            </button>
          </Hint>
          <Hint label="Split down">
            <button
              data-testid="chat-header-split-down"
              type="button"
              onClick={() => splitSurface('h')}
              className={HDR_BTN}
            >
              <LayoutPanelTop size={13} className="text-mf-text-3" />
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
          <EyeOff size={13} className="text-mf-text-3" />
        </button>
      </Hint>
    </div>
  );
}
