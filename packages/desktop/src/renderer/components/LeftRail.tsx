import React from 'react';
import { Settings, HelpCircle, MessageSquare, Play } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePluginLayoutStore, useSettingsStore, useUIStore } from '../store';
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

export function LeftRail(): React.ReactElement {
  const contributions = usePluginLayoutStore((s) => s.contributions).filter((c) => c.zone === 'left-panel');
  const activeLeftPanelId = usePluginLayoutStore((s) => s.activeLeftPanelId);
  const fullviewContributions = usePluginLayoutStore((s) => s.contributions).filter((c) => c.zone === 'fullview');
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const panelVisible = useUIStore((s) => s.panelVisible);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);
  const togglePanel = useUIStore((s) => s.togglePanel);

  const handleSessionsClick = (): void => {
    usePluginLayoutStore.getState().setActiveLeftPanel(null);
  };

  const handlePluginClick = (pluginId: string): void => {
    const { activeLeftPanelId: current, setActiveLeftPanel } = usePluginLayoutStore.getState();
    setActiveLeftPanel(current === pluginId ? null : pluginId);
  };

  const handleFullviewClick = (pluginId: string): void => {
    usePluginLayoutStore.getState().activateFullview(pluginId);
  };

  return (
    <div className="w-11 bg-mf-app-bg flex flex-col py-2">
      {/* Activity icons */}
      <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
        {/* Default: Sessions / AI workspace */}
        <RailButton active={activeLeftPanelId === null} onClick={handleSessionsClick} title="Sessions">
          <MessageSquare size={16} />
        </RailButton>

        {/* Left-panel plugin icons */}
        {contributions.map((c) => (
          <RailButton
            key={c.pluginId}
            active={activeLeftPanelId === c.pluginId}
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

      {/* Bottom actions */}
      <div className="flex flex-col gap-2 pt-2">
        {/* Logs toggle button */}
        <RailButton
          active={panelVisible}
          onClick={() => {
            const next = !panelVisible;
            setPanelVisible(next);
            if (next && useUIStore.getState().panelCollapsed.bottom) {
              togglePanel('bottom');
            }
          }}
          title="Toggle logs panel"
        >
          <span data-testid="toggle-logs-panel">
            <Play size={16} />
          </span>
        </RailButton>

        <div className="w-5 h-px bg-mf-divider mx-auto" />

        {/* Fullview plugin icons */}
        {fullviewContributions.map((c) => (
          <RailButton
            key={c.pluginId}
            active={activeFullviewId === c.pluginId}
            onClick={() => handleFullviewClick(c.pluginId)}
            title={c.label}
          >
            {c.icon ? (
              <PluginIcon name={c.icon} size={16} />
            ) : (
              <span className="text-mf-text-secondary">{c.label.charAt(0)}</span>
            )}
          </RailButton>
        ))}

        <RailButton onClick={() => useSettingsStore.getState().open()} title="Settings">
          <Settings size={16} />
        </RailButton>
        <RailButton onClick={() => useSettingsStore.getState().open(undefined, 'about')} title="Help">
          <HelpCircle size={16} />
        </RailButton>
      </div>
    </div>
  );
}
