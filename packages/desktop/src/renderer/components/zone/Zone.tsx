import { Suspense, useMemo } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';
import { ZoneHeader } from './ZoneHeader.js';
import { ZoneHeaderSlotProvider } from './ZoneHeaderSlot.js';
import { useDragContext } from './DragOverlay.js';

interface ZoneProps {
  id: ZoneId;
}

export function Zone({ id }: ZoneProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[id]);
  const moveToolWindow = useLayoutStore((s) => s.moveToolWindow);
  const { isDragging, hoveredZone, setHoveredZone } = useDragContext();

  const ActiveComponent = useMemo(() => {
    if (!zone?.activeTab) return null;
    return getToolWindow(zone.activeTab)?.component ?? null;
  }, [zone?.activeTab]);

  if (!zone || zone.tabs.length === 0) return null;

  const isDropTarget = isDragging && hoveredZone === id;

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('application/x-toolwindow')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setHoveredZone(id);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setHoveredZone(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('application/x-toolwindow')) {
      e.preventDefault();
      const toolWindowId = e.dataTransfer.getData('application/x-toolwindow');
      if (toolWindowId) {
        moveToolWindow(toolWindowId, id);
      }
      setHoveredZone(null);
    }
  };

  return (
    <ZoneHeaderSlotProvider>
      <div
        className={[
          'flex flex-col h-full w-full overflow-hidden transition-colors',
          isDropTarget ? 'ring-1 ring-inset ring-mf-accent' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ZoneHeader zoneId={id} />
        <div className="flex-1 min-h-0 overflow-hidden">
          <Suspense fallback={null}>{ActiveComponent ? <ActiveComponent /> : <div />}</Suspense>
        </div>
      </div>
    </ZoneHeaderSlotProvider>
  );
}
