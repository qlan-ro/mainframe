/**
 * SessionTabPair — the split pair as ONE fused pill: a split glyph, then the
 * two member segments. The focused segment is filled; a parked pair (not on
 * screen) fills neither, so the fill only ever means "this is live". Each
 * segment is a full `SessionTabPill` — its own ×, drag, context menu and
 * waiting dot — so every per-tab gesture still works on a member.
 *
 * The pair is derived from `zones-store` (`stripEntries`), never owned here.
 * While a third tab is dragged, the whole pair is the drop target: dropping
 * replaces the UNFOCUSED segment, the same rule the drag-to-zone layer uses.
 */
import { useState } from 'react';
import { Columns2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTabDragStore } from '@/features/chat/zones/tab-drag-store';
import { SessionTabPill, type SessionTabEntry, type SessionTabPillActions } from './SessionTabPill';

interface SessionTabPairProps extends SessionTabPillActions {
  tabs: [SessionTabEntry, SessionTabEntry];
  focused: 0 | 1;
  visible: boolean;
  hintOf: (id: string) => number | null;
}

export function SessionTabPair({ tabs, focused, visible, hintOf, ...actions }: SessionTabPairProps) {
  const dropTarget = useTabDragStore(
    (s) => visible && s.draggingId != null && !tabs.some((tab) => tab.id === s.draggingId),
  );
  const [dropHover, setDropHover] = useState(false);
  const segmentOf = (index: 0 | 1) => (!visible ? 'parked' : focused === index ? 'focused' : 'unfocused');

  return (
    <div
      data-testid="session-tabs-zone-group"
      data-visible={visible || undefined}
      data-drop-hover={dropHover || undefined}
      onPointerEnter={() => dropTarget && setDropHover(true)}
      onPointerLeave={() => setDropHover(false)}
      onPointerUp={() => {
        if (!dropTarget) return;
        const draggedId = useTabDragStore.getState().draggingId;
        setDropHover(false);
        if (draggedId != null) actions.onDropTab(draggedId);
      }}
      className={cn(
        'flex h-8 max-w-90 shrink items-center gap-0.5 rounded-md border border-border bg-popover pl-1.5',
        dropHover && 'ring-2 ring-primary',
      )}
    >
      <Columns2 aria-hidden className={cn('size-3.5 shrink-0', visible ? 'text-primary' : 'text-muted-foreground')} />
      {tabs.map((tab, index) => (
        <SessionTabPill
          key={tab.id}
          tab={tab}
          segment={segmentOf(index as 0 | 1)}
          hintIndex={hintOf(tab.id)}
          // A member already has its partner on screen; the gesture is "retarget", not "open".
          canOpenInSplit={false}
          {...actions}
        />
      ))}
    </div>
  );
}
