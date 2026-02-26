import React from 'react';
import { Settings, HelpCircle, MessageSquare } from 'lucide-react';
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
  const panelVisible = useUIStore((s) => s.panelVisible);
  const setPanelVisible = useUIStore((s) => s.setPanelVisible);

  const handleSessionsClick = (): void => {
    usePluginLayoutStore.getState().setActiveLeftPanel(null);
  };

  const handlePluginClick = (pluginId: string): void => {
    const { activeLeftPanelId: current, setActiveLeftPanel } = usePluginLayoutStore.getState();
    setActiveLeftPanel(current === pluginId ? null : pluginId);
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
        <RailButton onClick={() => useSettingsStore.getState().open()} title="Settings">
          <Settings size={16} />
        </RailButton>
        <RailButton onClick={() => useSettingsStore.getState().open(undefined, 'about')} title="Help">
          <HelpCircle size={16} />
        </RailButton>

        {/* Logs toggle button */}
        <div className="flex items-center justify-center gap-1 text-xs text-mf-text-secondary px-2">
          <div className="text-mf-divider">|</div>
          <button
            onClick={() => setPanelVisible(!panelVisible)}
            className={cn(
              'px-2 py-1 rounded transition-colors',
              panelVisible ? 'text-mf-text-primary' : 'text-mf-text-secondary hover:text-mf-text-primary',
            )}
            title="Toggle logs panel"
          >
            Logs
          </button>
        </div>
      </div>
    </div>
  );
}
