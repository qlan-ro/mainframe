import { Suspense, useMemo } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '../../store/layout.js';
import { getToolWindow } from './tool-windows.js';
import { ZoneTabBar } from './ZoneTabBar.js';

interface ZoneProps {
  id: ZoneId;
}

export function Zone({ id }: ZoneProps): React.ReactElement | null {
  const zone = useLayoutStore((s) => s.zones[id]);

  const ActiveComponent = useMemo(() => {
    if (!zone?.activeTab) return null;
    return getToolWindow(zone.activeTab)?.component ?? null;
  }, [zone?.activeTab]);

  if (!zone || zone.tabs.length === 0) return null;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <ZoneTabBar zoneId={id} />
      <div className="flex-1 overflow-auto">
        <Suspense fallback={null}>{ActiveComponent ? <ActiveComponent /> : <div />}</Suspense>
      </div>
    </div>
  );
}
