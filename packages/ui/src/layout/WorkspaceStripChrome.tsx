/**
 * WorkspaceStripChrome — the two fixed ends of the workspace strip, shared by the
 * tab strip and by the empty-state header above the picker card (which has no
 * pane, so it cannot use the strip itself).
 *
 * data-testid:
 *   workspace-surface-drag                        — the surface drag grip
 *   workspace-tab-strip-split-right / -split-down — split actions (primary pane)
 *   workspace-surface-close                       — hide the workspace (primary pane)
 *   workspace-pane-close-<paneId>                 — un-split (secondary pane)
 */
import { GripVertical, LayoutPanelLeft, LayoutPanelTop, X } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { EditorGlyph } from './surface-icons';
import { useSurfaceDragStore } from './use-surface-drag';

/** Strip height, shared with the empty-state header so the two never drift. */
export const STRIP_ROW = 'flex h-9 shrink-0 items-center border-b border-border';

/**
 * Leading grip + surface glyph. Only the primary pane carries the grip: the
 * gesture moves the whole surface, not the pane.
 */
export function WorkspaceStripLead({ primary }: { primary: boolean }) {
  const beginSurfaceDrag = useSurfaceDragStore((s) => s.beginSurfaceDrag);

  return (
    <>
      {primary && (
        <div
          data-testid="workspace-surface-drag"
          className="grid h-full w-5 shrink-0 cursor-grab place-items-center pl-1"
          onPointerDown={(e) => beginSurfaceDrag('workspace', { clientX: e.clientX, clientY: e.clientY })}
        >
          <GripVertical className="size-3.5 text-muted-foreground" />
        </div>
      )}
      <div className={primary ? 'shrink-0 px-1' : 'shrink-0 pr-1 pl-2.5'}>
        <EditorGlyph size={12} className="text-primary" />
      </div>
    </>
  );
}

/**
 * Trailing controls. The primary pane owns the surface-level actions (split, and
 * hide — disabled at the dynamic floor); a secondary pane owns only its own
 * un-split.
 */
export function WorkspaceStripActions({ paneId, primary }: { paneId?: string; primary: boolean }) {
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const isFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'workspace'));
  const closePane = useLayoutStore((s) => s.closePane);

  return (
    <div className="flex shrink-0 items-center gap-px pr-1.5 pl-0.5">
      {primary && splitAvailable && (
        <>
          <Hint label="Split right">
            <Button
              data-testid="workspace-tab-strip-split-right"
              variant="ghost"
              size="icon-xs"
              onClick={() => splitSurface('v')}
            >
              <LayoutPanelLeft className="text-muted-foreground" />
            </Button>
          </Hint>
          <Hint label="Split down">
            <Button
              data-testid="workspace-tab-strip-split-down"
              variant="ghost"
              size="icon-xs"
              onClick={() => splitSurface('h')}
            >
              <LayoutPanelTop className="text-muted-foreground" />
            </Button>
          </Hint>
        </>
      )}
      {primary ? (
        <Hint label={isFloor ? 'The workspace is the only surface left' : 'Hide workspace'}>
          <Button
            data-testid="workspace-surface-close"
            variant="ghost"
            size="icon-xs"
            disabled={isFloor}
            onClick={() => toggleSurface('workspace')}
          >
            <X className="text-muted-foreground" />
          </Button>
        </Hint>
      ) : (
        <Hint label="Close pane (un-split)">
          <Button
            data-testid={`workspace-pane-close-${paneId}`}
            variant="ghost"
            size="icon-xs"
            onClick={() => paneId && closePane(paneId)}
          >
            <LayoutPanelLeft className="text-muted-foreground" />
          </Button>
        </Hint>
      )}
    </div>
  );
}
