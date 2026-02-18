import React from 'react';
import { Search } from 'lucide-react';
import type { Layout } from 'react-resizable-panels';
import { useProjectsStore, useSearchStore } from '../store';

type PanelId = 'left' | 'right' | 'bottom';

interface TitleBarProps {
  panelSizes: Layout;
  panelCollapsed: Record<PanelId, boolean>;
}

export function TitleBar({
  panelSizes: _panelSizes,
  panelCollapsed: _panelCollapsed,
}: TitleBarProps): React.ReactElement {
  const { projects, activeProjectId } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="h-11 bg-mf-app-bg flex items-center app-drag relative">
      {/* Traffic lights + project switcher */}
      <div className="flex items-center pl-[84px] pr-4 z-10">
        {activeProject && (
          <div className="flex items-center gap-2 px-1.5 py-1">
            <div className="w-5 h-5 rounded flex items-center justify-center bg-mf-accent text-white text-mf-body font-semibold shrink-0">
              {activeProject.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-mf-body text-mf-text-primary font-medium">{activeProject.name}</span>
          </div>
        )}
      </div>

      {/* Search box - centered in the title bar */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          onClick={() => useSearchStore.getState().open()}
          className="w-[480px] max-w-[90%] flex items-center gap-2 px-3 py-[5px] rounded-mf-card border border-mf-border text-mf-text-secondary text-mf-body app-no-drag cursor-pointer hover:border-mf-text-secondary transition-colors pointer-events-auto"
        >
          <Search size={14} />
          <span>Search ⌘F</span>
        </div>
      </div>
    </div>
  );
}
