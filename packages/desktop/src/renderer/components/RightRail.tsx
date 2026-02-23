import React from 'react';
import { PanelRight, SquareCheck, MessageSquare, type LucideProps } from 'lucide-react';
import { cn } from '../lib/utils';
import { usePluginLayoutStore } from '../store';

// Curated map of Lucide icon names plugins may declare.
// Add entries as new plugins are introduced.
const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  'square-check': SquareCheck,
  'message-square': MessageSquare,
};

function PluginIcon({ name, size = 16 }: { name: string; size?: number }): React.ReactElement | null {
  const Icon = ICON_MAP[name];
  return Icon ? <Icon size={size} /> : null;
}

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
        'w-8 h-8 flex items-center justify-center rounded-mf-card transition-colors',
        active ? 'bg-mf-accent text-white' : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
      )}
    >
      {children}
    </button>
  );
}

export function RightRail(): React.ReactElement {
  const contributions = usePluginLayoutStore((s) => s.contributions.filter((c) => c.zone === 'right-panel'));
  const activeRightPanelId = usePluginLayoutStore((s) => s.activeRightPanelId);

  const handleContextClick = (): void => {
    usePluginLayoutStore.getState().setActiveRightPanel(null);
  };

  const handlePluginClick = (pluginId: string): void => {
    const { activeRightPanelId: current, setActiveRightPanel } = usePluginLayoutStore.getState();
    setActiveRightPanel(current === pluginId ? null : pluginId);
  };

  return (
    <div className="w-12 bg-mf-app-bg flex flex-col py-3 px-[6px]">
      {/* Activity icons */}
      <div className="flex-1 flex flex-col items-center gap-3 overflow-y-auto">
        {/* Default: Context panel */}
        <RailButton active={activeRightPanelId === null} onClick={handleContextClick} title="Context">
          <PanelRight size={16} />
        </RailButton>

        {/* Right-panel plugin icons */}
        {contributions.map((c) => (
          <RailButton
            key={c.pluginId}
            active={activeRightPanelId === c.pluginId}
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
