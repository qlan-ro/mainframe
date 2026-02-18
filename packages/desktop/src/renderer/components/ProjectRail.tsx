import React, { useCallback } from 'react';
import { Plus, Settings, HelpCircle } from 'lucide-react';
import { useProjectsStore, useSettingsStore } from '../store';
import { createProject } from '../lib/api';
import { cn } from '../lib/utils';

export function ProjectRail(): React.ReactElement {
  const { projects, activeProjectId, setActiveProject, addProject } = useProjectsStore();

  const handleAddProject = useCallback(async () => {
    try {
      const path = await window.mainframe.openDirectoryDialog();
      if (!path) return;

      const project = await createProject(path);
      addProject(project);
      setActiveProject(project.id);
    } catch (error) {
      console.warn('[project-rail] failed to add project:', error);
    }
  }, [addProject, setActiveProject]);

  const handleShowHelp = useCallback(async () => {
    try {
      const info = await window.mainframe.getAppInfo();
      window.alert(`Mainframe v${info.version}\nAuthor: ${info.author}`);
    } catch (error) {
      console.warn('[project-rail] failed to load app info:', error);
    }
  }, []);

  return (
    <div className="w-12 bg-mf-app-bg flex flex-col py-3 px-[2px] pl-[6px]">
      {/* Project icons */}
      <div className="flex-1 flex flex-col items-center gap-3 overflow-y-auto">
        {projects.map((project) => (
          <button
            key={project.id}
            onClick={() => setActiveProject(project.id)}
            className={cn(
              'w-8 h-8 flex items-center justify-center shrink-0',
              'rounded-mf-card text-mf-small font-semibold transition-colors',
              activeProjectId === project.id
                ? 'bg-mf-accent text-white ring-2 ring-mf-accent/50'
                : 'bg-mf-panel-bg text-mf-text-secondary hover:text-mf-text-primary',
            )}
            title={project.name}
          >
            {project.name.charAt(0).toUpperCase()}
          </button>
        ))}

        <button
          onClick={handleAddProject}
          className="w-8 h-8 flex items-center justify-center shrink-0 rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg transition-colors"
          title="Add Project"
          aria-label="Add project"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col items-center gap-3 pt-3">
        <button
          onClick={() => useSettingsStore.getState().open()}
          className="w-8 h-8 flex items-center justify-center rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          title="Settings"
          aria-label="Open settings"
        >
          <Settings size={16} />
        </button>
        <button
          onClick={handleShowHelp}
          className="w-8 h-8 flex items-center justify-center rounded-mf-card text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          title="Help"
          aria-label="Show app information"
        >
          <HelpCircle size={16} />
        </button>
      </div>
    </div>
  );
}
