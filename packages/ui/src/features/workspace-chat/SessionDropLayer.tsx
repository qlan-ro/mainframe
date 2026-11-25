/**
 * The drop target for a session tab dragged onto the chat: its right half, where
 * the workspace opens. Dropping shows that session as a workspace tab (W9).
 * Nothing to drop for the conversation itself, or for a draft.
 *
 * The mid-drag highlight is React state driven by pointerenter/leave, NOT CSS
 * `:hover` — WKWebView freezes hover matching while the mouse button is held,
 * which made a real drag show no feedback at all (synthetic tests can't catch
 * that; a live mouse did).
 */
import { useState } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import { PanelRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTabDragStore } from '@/features/session-tabs/tab-drag-store';
import { canOpenBeside, openSessionBeside } from './open-session';

export function SessionDropLayer() {
  const aui = useAui();
  const [hovered, setHovered] = useState(false);
  const draggingId = useTabDragStore((s) => s.draggingId);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  if (draggingId == null || !canOpenBeside(mainThreadId, draggingId)) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex justify-end p-0.5">
      <div
        data-testid="session-drop-workspace"
        data-hovered={hovered || undefined}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerUp={() => {
          setHovered(false);
          openSessionBeside(aui.threads, draggingId);
        }}
        className={cn(
          'pointer-events-auto flex w-1/2 items-center justify-center rounded-md border-2 border-dashed',
          'border-primary/40 bg-primary/5 transition-all duration-100',
          hovered && 'border-solid border-primary bg-primary/15',
        )}
      >
        {/* Solid chip, legible over whatever the transcript shows behind it. */}
        <span
          className={cn(
            'pointer-events-none flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium shadow-md',
            hovered
              ? 'border-primary bg-accent-fill text-primary-foreground'
              : 'border-border bg-popover text-foreground',
          )}
        >
          <PanelRight className="size-3.5" aria-hidden />
          Open in the workspace
        </span>
      </div>
    </div>
  );
}
