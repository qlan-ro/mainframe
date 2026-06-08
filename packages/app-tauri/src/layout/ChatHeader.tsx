import { useAuiState } from '@assistant-ui/react';
import { GripHorizontal, LayoutPanelLeft, LayoutPanelTop, MessageSquare } from 'lucide-react';
import { layoutCanSplit, useLayoutStore } from '@/store/layout';

// Chat header uses 24×24 buttons (hdrBtn in artboard), distinct from the 22×22 gActionStyle used in SurfaceTabStrip.
const HDR_BTN =
  'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

export function ChatHeader() {
  const title = useAuiState((s) => s.threadListItem?.title) ?? 'Untitled';
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);

  return (
    <div
      data-testid="chat-header"
      className="flex h-[34px] flex-shrink-0 items-center gap-[7px] bg-mf-tab-bar pl-2 pr-1.5 [border-bottom:0.5px_solid_var(--border)]"
    >
      <GripHorizontal size={13} className="flex-shrink-0 cursor-grab text-mf-text-4" />
      <MessageSquare size={13} className="flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</span>
      {splitAvailable && (
        <>
          <button
            data-testid="chat-header-split-right"
            type="button"
            title="Split right"
            onClick={() => splitSurface('v')}
            className={HDR_BTN}
          >
            <LayoutPanelLeft size={13} className="text-mf-text-3" />
          </button>
          <button
            data-testid="chat-header-split-down"
            type="button"
            title="Split down"
            onClick={() => splitSurface('h')}
            className={HDR_BTN}
          >
            <LayoutPanelTop size={13} className="text-mf-text-3" />
          </button>
        </>
      )}
    </div>
  );
}
