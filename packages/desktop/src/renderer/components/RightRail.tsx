import React from 'react';
import { PanelRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePluginLayoutStore, useUIStore } from '../store';
import { PluginIcon } from './plugins/PluginIcon';

interface RailButtonProps {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}

function RailButton({ active, onClick, title, children }: RailButtonProps): React.ReactElement {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'w-8 h-8 mx-auto flex items-center justify-center rounded-mf-card transition-colors',
        active
          ? 'bg-mf-panel-bg text-mf-text-primary'
          : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
      )}
    >
      {children}
    </button>
  );
}

export function RightRail(): React.ReactElement {
  const contributions = usePluginLayoutStore((s) => s.contributions).filter((c) => c.zone === 'right-panel');
  const activeRightPanelId = usePluginLayoutStore((s) => s.activeRightPanelId);
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const togglePanel = useUIStore((s) => s.togglePanel);

  const handleContextClick = (): void => {
    if (activeRightPanelId === null && !panelCollapsed.right) {
      togglePanel('right');
      return;
    }
    usePluginLayoutStore.getState().setActiveRightPanel(null);
    if (panelCollapsed.right) togglePanel('right');
  };

  const handlePluginClick = (pluginId: string): void => {
    const { activeRightPanelId: current, setActiveRightPanel } = usePluginLayoutStore.getState();
    if (current === pluginId && !panelCollapsed.right) {
      togglePanel('right');
      return;
    }
    setActiveRightPanel(pluginId);
    if (panelCollapsed.right) togglePanel('right');
  };

  return (
    <div className="w-11 bg-mf-app-bg flex flex-col py-2">
      {/* Activity icons */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
        {/* Default: Context panel */}
        <RailButton
          active={activeRightPanelId === null && !activeFullviewId && !panelCollapsed.right}
          onClick={handleContextClick}
          title="Context"
        >
          <PanelRight size={16} />
        </RailButton>

        {/* Right-panel plugin icons */}
        {contributions.map((c) => (
          <RailButton
            key={c.pluginId}
            active={activeRightPanelId === c.pluginId && !panelCollapsed.right}
            onClick={() => handlePluginClick(c.pluginId)}
            title={c.label}
          >
            {c.icon ? (
              <PluginIcon name={c.icon} size={16} />
            ) : (
              <span className="text-mf-text-secondary">{c.label.charAt(0)}</span>
            )}
          </RailButton>
        ))}
      </div>
    </div>
  );
}
