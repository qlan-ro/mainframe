import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Minus, X } from 'lucide-react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';
import { useZoneHeaderSlotState } from './ZoneHeaderSlot.js';
import type { InternalTab } from './ZoneHeaderSlot.js';

interface ZoneHeaderProps {
  zoneId: ZoneId;
}

export function ZoneHeader({ zoneId }: ZoneHeaderProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[zoneId]);
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const { tabs: internalTabs, activeTabId, onTabChange, tabStyle, actions } = useZoneHeaderSlotState();

  if (!zone?.activeTab) return null;

  const tw = getToolWindow(zone.activeTab);
  if (!tw) return null;

  return (
    <div className="flex h-9 items-center shrink-0 px-2 gap-1">
      {/* Panel name */}
      <span className="text-sm font-semibold text-mf-text-primary select-none shrink-0">{tw.label}</span>

      {/* Internal tabs registered by the panel */}
      {internalTabs.length > 0 &&
        (tabStyle === 'dropdown' ? (
          <TabDropdown tabs={internalTabs} activeTabId={activeTabId} onTabChange={onTabChange} />
        ) : (
          <div className="flex items-center gap-0.5 overflow-x-auto min-w-0 ml-2 scrollbar-none">
            {internalTabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange?.(tab.id)}
                  className={[
                    'group flex items-center gap-1 px-2 h-6 rounded text-sm border',
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
        ))}

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

function TabDropdown({
  tabs,
  activeTabId,
  onTabChange,
}: {
  tabs: InternalTab[];
  activeTabId: string | null;
  onTabChange: ((tabId: string) => void) | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative ml-2">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 px-2 h-6 rounded text-sm border border-mf-border bg-mf-hover text-mf-text-primary"
      >
        <span>{activeTab?.label ?? 'Select'}</span>
        <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[120px] rounded border border-mf-border bg-mf-panel-bg shadow-lg z-50 py-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                onTabChange?.(tab.id);
                setOpen(false);
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-sm',
                tab.id === activeTabId
                  ? 'bg-mf-hover text-mf-text-primary'
                  : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
