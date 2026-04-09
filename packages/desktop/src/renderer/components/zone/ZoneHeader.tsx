import { Minus, X } from 'lucide-react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';
import { useZoneHeaderSlotState } from './ZoneHeaderSlot.js';

interface ZoneHeaderProps {
  zoneId: ZoneId;
}

export function ZoneHeader({ zoneId }: ZoneHeaderProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[zoneId]);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const { tabs: internalTabs, activeTabId, onTabChange, actions } = useZoneHeaderSlotState();

  if (!zone?.activeTab) return null;

  const tw = getToolWindow(zone.activeTab);
  if (!tw) return null;

  return (
    <div className="flex h-9 items-center shrink-0 px-2 gap-1">
      {/* Panel name */}
      <span className="text-sm font-semibold text-mf-text-primary select-none shrink-0">{tw.label}</span>

      {/* Internal tabs registered by the panel */}
      {internalTabs.length > 0 && (
        <div className="flex items-center gap-0.5 overflow-x-auto min-w-0 ml-2">
          {internalTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={[
                  'group flex items-center gap-1 px-3 h-6 rounded text-sm shrink-0 border',
                  isActive
                    ? 'bg-mf-hover border-mf-border text-mf-text-primary'
                    : 'border-transparent text-mf-text-secondary hover:text-mf-text-primary',
                ].join(' ')}
              >
                <span>{tab.label}</span>
                {tab.onClose && (
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      tab.onClose?.();
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-mf-destructive transition-opacity"
                  >
                    <X size={10} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Panel-registered actions */}
      {actions && <div className="flex items-center gap-0.5 shrink-0">{actions}</div>}

      {/* Minimize */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setActiveTab(zoneId, null)}
              aria-label="Minimize"
              className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
            >
              <Minus size={13} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Minimize</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
