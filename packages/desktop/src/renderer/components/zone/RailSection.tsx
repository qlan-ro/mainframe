import React from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { cn } from '../../lib/utils';
import { useLayoutStore } from '../../store/layout';
import { getToolWindow } from './tool-windows';
import { useDragContext } from './DragOverlay';

interface RailButtonProps {
  active?: boolean;
  onClick: () => void;
  title: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  children: React.ReactNode;
}

export function RailButton({
  active,
  onClick,
  title,
  draggable,
  onDragStart,
  onDragEnd,
  children,
}: RailButtonProps): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          title={title}
          draggable={draggable}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className={cn(
            'w-8 h-8 mx-auto flex items-center justify-center rounded-mf-card transition-colors',
            active
              ? 'bg-mf-panel-bg text-mf-text-primary'
              : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
}

interface RailSectionProps {
  zoneId: ZoneId;
}

export function RailSection({ zoneId }: RailSectionProps): React.ReactElement {
  const zone = useLayoutStore((s) => s.zones[zoneId]);
  const collapsed = useLayoutStore((s) => s.collapsed);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const toggleSide = useLayoutStore((s) => s.toggleSide);
  const moveToolWindow = useLayoutStore((s) => s.moveToolWindow);
  const { isDragging, hoveredZone, startDrag, endDrag, setHoveredZone } = useDragContext();

  const side: 'left' | 'right' | 'bottom' = zoneId.startsWith('left')
    ? 'left'
    : zoneId.startsWith('right')
      ? 'right'
      : 'bottom';
  const isCollapsed = collapsed[side];

  const handleClick = (tabId: string): void => {
    if (isCollapsed) {
      toggleSide(side);
      setActiveTab(zoneId, tabId);
    } else if (zone?.activeTab === tabId) {
      // Deactivate this zone; the side stays visible if another zone is still active
      setActiveTab(zoneId, null);
    } else {
      setActiveTab(zoneId, tabId);
    }
  };

  const handleDragStart = (e: React.DragEvent, tabId: string): void => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-toolwindow', tabId);
    startDrag(tabId);
  };

  const handleDragEnd = (_e: React.DragEvent): void => {
    endDrag();
  };

  const handleDragOver = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('application/x-toolwindow')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleDragEnter = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('application/x-toolwindow')) {
      setHoveredZone(zoneId);
    }
  };

  const handleDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setHoveredZone(null);
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    const toolWindowId = e.dataTransfer.getData('application/x-toolwindow');
    if (toolWindowId) {
      moveToolWindow(toolWindowId, zoneId);
    }
    setHoveredZone(null);
  };

  if (!zone) return <></>;

  const isDropHighlighted = isDragging && hoveredZone === zoneId;

  return (
    <div
      className={cn(
        'flex flex-col items-center gap-1 rounded transition-colors',
        isDropHighlighted && 'ring-1 ring-mf-accent bg-mf-panel-bg',
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-zone={zoneId}
    >
      {zone.tabs.length === 0 && isDragging && (
        <div className="w-8 h-8 rounded-mf-card border border-dashed border-mf-accent opacity-50" />
      )}
      {zone.tabs.map((tabId) => {
        const tw = getToolWindow(tabId);
        if (!tw) return null;
        const Icon = tw.icon;
        const isActive = !isCollapsed && zone.activeTab === tabId;
        return (
          <RailButton
            key={tabId}
            active={isActive}
            onClick={() => handleClick(tabId)}
            title={tw.label}
            draggable
            onDragStart={(e) => handleDragStart(e, tabId)}
            onDragEnd={handleDragEnd}
          >
            {Icon ? <Icon className="w-4 h-4" /> : <span className="text-xs">{tw.label[0]}</span>}
          </RailButton>
        );
      })}
    </div>
  );
}
