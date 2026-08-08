/**
 * WorkspaceFilesPanel — the project file tree as a FLOATING glass panel over
 * the workspace surface, mirroring the session panel's overlay on the chat
 * side: opened from the strip's Files button (WorkspaceStripChrome), light-
 * dismissed by Escape or a pointer outside it (portal-aware, so a tree row's
 * context menu doesn't count as outside; trigger-aware, so the toggle buttons
 * don't dismiss-then-reopen in one click).
 *
 * The panel hangs from the strip's right end like a popover. Hidden, not
 * unmounted, when closed — the tree's expanded folders and scroll position
 * survive a dismiss. Open state is transient (store/workspace-files-panel);
 * the toolbar Files toggle and reveal-file intents write the same flag.
 *
 * data-testid: workspace-files-panel (present only while open).
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { onSurfaceIntent } from '@/store/surface-intents';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useWorkspaceFilesPanel } from '@/store/workspace-files-panel';
import { FileTree } from './FileTree';

/** Same glass chrome as the session panel's card. */
const PANEL_CHROME =
  'pointer-events-auto flex w-72 flex-col overflow-hidden rounded-xl border border-border bg-background/85 backdrop-blur-xl';

/** Radix portals render outside the panel root; a click in one is not "outside". */
const PORTAL_SELECTOR = '[data-radix-popper-content-wrapper],[role="menu"],[role="dialog"]';

export function WorkspaceFilesPanel() {
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  const open = useWorkspaceFilesPanel((s) => s.open);
  const setOpen = useWorkspaceFilesPanel((s) => s.setOpen);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The panel is a PICKER: opening a file (or a diff) means the pick is done,
  // so it gets out of the way. Without this, the glass card sits over the
  // just-opened tab's own header controls — and since a press on the panel
  // body counts as "inside", light dismiss never fires and everything under
  // the card is unreachable until Escape (caught by the e2e batch).
  useEffect(() => {
    if (!open) return;
    return onSurfaceIntent((intent) => {
      if (intent.type === 'open-file' || intent.type === 'open-diff') setOpen(false);
    });
  }, [open, setOpen]);

  // Light dismiss — Escape, or a pointer outside the panel, any portal, and
  // the toggle buttons (strip + toolbar) that manage the flag themselves.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (rootRef.current?.contains(node)) return;
      const element = node instanceof Element ? node : node.parentElement;
      if (element?.closest(`${PORTAL_SELECTOR},[data-workspace-files-trigger]`)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-y-0 right-0 z-20">
      {/* Hidden, not unmounted, when closed: tree state survives a dismiss.
          `data-testid` only while open so tests can ask "is it on screen". */}
      <div
        data-testid={open ? 'workspace-files-panel' : undefined}
        className={cn(
          PANEL_CHROME,
          'absolute top-11 right-2 z-30 max-h-[calc(100%-52px)] shadow-xl',
          !open && 'hidden',
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {!projectId ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Open a session to browse its files.</div>
          ) : (
            <FileTree port={port} projectId={projectId} chatId={chatId} onCollapse={() => setOpen(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
