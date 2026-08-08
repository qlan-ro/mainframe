/**
 * WorkspaceStripChrome — the two fixed ends of the workspace strip, shared by the
 * tab strip and by the empty-state header above the picker card (which has no
 * pane, so it cannot use the strip itself).
 *
 * data-testid:
 *   workspace-surface-drag        — the surface drag grip
 *   workspace-surface-close       — hide the workspace (primary pane)
 *   workspace-pane-close-<paneId> — un-split (secondary pane)
 */
import { FolderTree, GripVertical, LayoutPanelLeft, X } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { cn } from '@v2/lib/utils';
import { isSurfaceFloor, useLayoutStore } from '@/store/layout';
import { useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { EditorGlyph } from './surface-icons';
import { useSurfaceDragStore } from './use-surface-drag';

/** Strip height, shared with the empty-state header so the two never drift.
 *  No bottom hairline — surface headers sit flush on their content. */
export const STRIP_ROW = 'flex h-9 shrink-0 items-center';

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
 * Trailing controls. The primary pane owns hide (disabled at the dynamic
 * floor); a secondary pane owns only its own un-split. No split actions here:
 * the strip only renders while the workspace is placed, which is exactly when
 * `layoutCanSplit` is false — splitting to the workspace lives on the chat
 * header, the one surface it can be triggered from.
 */
export function WorkspaceStripActions({ paneId, primary }: { paneId?: string; primary: boolean }) {
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const isFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'workspace'));
  const closePane = useLayoutStore((s) => s.closePane);

  const filesOpen = useWorkspaceFilesPanel((s) => s.open);
  const setFilesOpen = useWorkspaceFilesPanel((s) => s.setOpen);

  return (
    <div className="flex shrink-0 items-center gap-px pr-1.5 pl-0.5">
      {primary && (
        <Hint label={filesOpen ? 'Hide files' : 'Show files'}>
          <Button
            data-testid="workspace-files-open"
            // The panel's light-dismiss ignores this trigger — otherwise the
            // pointerdown would close the open panel and the click reopen it.
            data-workspace-files-trigger
            aria-pressed={filesOpen}
            variant="ghost"
            size="icon-xs"
            onClick={() => setFilesOpen(!filesOpen)}
            className={cn(filesOpen ? 'bg-accent text-foreground' : 'text-muted-foreground')}
          >
            <FolderTree />
          </Button>
        </Hint>
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
