import React from 'react';
import { useUIStore } from '../../store/ui';
import { PreviewTab } from './PreviewTab';

export function BottomPanel(): React.ReactElement | null {
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  if (panelCollapsed.bottom) return null;

  return (
    <div className="w-full flex flex-col bg-mf-panel-bg border-t border-mf-divider" style={{ height: 320 }}>
      <PreviewTab />
    </div>
  );
}
