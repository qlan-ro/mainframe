import { useCallback, useRef, useState } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';
import { useDragContext } from './DragOverlay.js';

interface ZoneTabBarProps {
  zoneId: ZoneId;
}

export function ZoneTabBar({ zoneId }: ZoneTabBarProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[zoneId]);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const reorderTab = useLayoutStore((s) => s.reorderTab);
  const moveToolWindow = useLayoutStore((s) => s.moveToolWindow);
  const { isDragging, hoveredZone, setHoveredZone } = useDragContext();

  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number) => {
      dragIndexRef.current = index;
      e.dataTransfer.setData('text/plain', `tab:${zoneId}:${index}`);
      e.currentTarget.style.opacity = '0.4';
    },
    [zoneId],
  );

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLButtonElement>) => {
    e.currentTarget.style.opacity = '';
    setDragOverIndex(null);
    dragIndexRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, toIndex: number) => {
      e.preventDefault();
      const data = e.dataTransfer.getData('text/plain');
      const parts = data.split(':');
      if (parts.length !== 3 || parts[0] !== 'tab' || parts[1] !== zoneId) return;
      const fromIndex = parseInt(parts[2] ?? '', 10);
      if (isNaN(fromIndex) || fromIndex === toIndex) return;
      reorderTab(zoneId, fromIndex, toIndex);
      setDragOverIndex(null);
    },
    [zoneId, reorderTab],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleBarDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.types.includes('application/x-toolwindow')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setHoveredZone(zoneId);
      }
    },
    [zoneId, setHoveredZone],
  );

  const handleBarDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setHoveredZone(null);
      }
    },
    [setHoveredZone],
  );

  const handleBarDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.types.includes('application/x-toolwindow')) {
        e.preventDefault();
        const toolWindowId = e.dataTransfer.getData('application/x-toolwindow');
        if (toolWindowId) {
          moveToolWindow(toolWindowId, zoneId);
        }
        setHoveredZone(null);
      }
    },
    [zoneId, moveToolWindow, setHoveredZone],
  );

  if (!zone || zone.tabs.length === 0) return null;

  const isExternalDropTarget = isDragging && hoveredZone === zoneId;

  return (
    <div
      className={[
        'flex h-7 items-center bg-mf-surface-secondary border-b border-mf-border overflow-x-auto transition-colors',
        isExternalDropTarget ? 'ring-1 ring-inset ring-mf-accent' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={handleBarDragOver}
      onDragLeave={handleBarDragLeave}
      onDrop={handleBarDrop}
    >
      {zone.tabs.map((tabId, index) => {
        const tw = getToolWindow(tabId);
        if (!tw) return null;
        const isActive = zone.activeTab === tabId;
        const isDropTarget = dragOverIndex === index;

        return (
          <button
            key={tabId}
            data-active={isActive}
            draggable
            onClick={() => setActiveTab(zoneId, tabId)}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragLeave={handleDragLeave}
            className={[
              'relative flex items-center h-full px-3 text-xs font-medium shrink-0',
              'transition-colors border-b-2',
              isActive
                ? 'border-mf-accent text-mf-text-primary'
                : 'border-transparent text-mf-text-secondary hover:text-mf-text-primary',
              isDropTarget ? 'ring-1 ring-mf-accent' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {tw.label}
          </button>
        );
      })}
    </div>
  );
}
