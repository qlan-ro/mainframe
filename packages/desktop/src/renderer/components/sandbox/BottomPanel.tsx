import React from 'react';
import { useUIStore } from '../../store/ui';
import { PreviewTab } from './PreviewTab';
import { LogsTab } from './LogsTab';

export function BottomPanel(): React.ReactElement | null {
  const { panelCollapsed, bottomPanelTab, setBottomPanelTab } = useUIStore();

  if (panelCollapsed.bottom) return null;

  return (
    <div className="w-full flex flex-col bg-mf-panel-bg border-t border-mf-divider" style={{ height: 320 }}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-1 border-b border-mf-divider shrink-0">
        {(['preview', 'logs'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setBottomPanelTab(tab)}
            className={[
              'px-3 py-1.5 text-xs rounded-t font-medium transition-colors',
              bottomPanelTab === tab
                ? 'bg-mf-app-bg text-mf-text-primary'
                : 'text-mf-text-secondary hover:text-mf-text-primary',
            ].join(' ')}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {bottomPanelTab === 'preview' && <PreviewTab />}
        {bottomPanelTab === 'logs' && <LogsTab />}
      </div>
    </div>
  );
}
