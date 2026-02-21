import React, { useCallback, useState } from 'react';
import { Plus, Settings, HelpCircle, X, Check } from 'lucide-react';
import { useProjectsStore, useChatsStore, useSettingsStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { createProject, removeProject } from '../lib/api';
import { cn } from '../lib/utils';

export function ProjectRail(): React.ReactElement {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    addProject,
    removeProject: removeFromStore,
  } = useProjectsStore();
  const [hoveringId, setHoveringId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

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

  const handleConfirmDelete = useCallback(
    async (id: string) => {
      try {
        await removeProject(id);
        // Close tabs and clear chats for the deleted project before removing it
        // from the store, so CenterPanel doesn't keep rendering the stale chat.
        const chatsState = useChatsStore.getState();
        const deletedChats = chatsState.chats.filter((c) => c.projectId === id);
        for (const chat of deletedChats) {
          useTabsStore.getState().closeTab(`chat:${chat.id}`);
        }
        chatsState.setChats(chatsState.chats.filter((c) => c.projectId !== id));
        removeFromStore(id);
        setConfirmingDeleteId(null);
        setHoveringId(null);
      } catch (error) {
        console.warn('[project-rail] failed to remove project:', error);
        // Leave confirmingDeleteId set so the user can retry or cancel manually
      }
    },
    [removeFromStore],
  );

  const handleMouseLeave = useCallback((id: string) => {
    setHoveringId(null);
    // Cancel confirm if mouse leaves while confirming this project
    setConfirmingDeleteId((prev) => (prev === id ? null : prev));
  }, []);

  return (
    <div className="w-12 bg-mf-app-bg flex flex-col py-3 px-[2px] pl-[6px]">
      {/* Project icons */}
      <div className="flex-1 flex flex-col items-center gap-3 overflow-y-auto">
        {projects.map((project) => {
          const isHovering = hoveringId === project.id;
          const isConfirming = confirmingDeleteId === project.id;

          return (
            <div
              key={project.id}
              className="relative w-8 h-8 shrink-0"
              onMouseEnter={() => setHoveringId(project.id)}
              onMouseLeave={() => handleMouseLeave(project.id)}
            >
              {isConfirming ? (
                /* Inline confirm state: ✓ / ✗ */
                <div className="w-8 h-8 flex items-center justify-center gap-0.5 rounded-mf-card bg-mf-panel-bg">
                  <button
                    onClick={() => handleConfirmDelete(project.id)}
                    className="w-3.5 h-3.5 flex items-center justify-center rounded text-green-400 hover:text-green-300 transition-colors"
                    title="Confirm remove"
                    aria-label="Confirm remove project"
                  >
                    <Check size={11} />
                  </button>
                  <button
                    onClick={() => setConfirmingDeleteId(null)}
                    className="w-3.5 h-3.5 flex items-center justify-center rounded text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                    title="Cancel"
                    aria-label="Cancel remove project"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                /* Normal project button */
                <>
                  <button
                    onClick={() => setActiveProject(project.id)}
                    className={cn(
                      'w-8 h-8 flex items-center justify-center',
                      'rounded-mf-card text-mf-small font-semibold transition-colors',
                      activeProjectId === project.id
                        ? 'bg-mf-accent text-white ring-2 ring-mf-accent/50'
                        : 'bg-mf-panel-bg text-mf-text-secondary hover:text-mf-text-primary',
                    )}
                    title={project.name}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </button>
                  {/* Hover-reveal ✕ */}
                  {isHovering && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmingDeleteId(project.id);
                      }}
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-mf-app-bg text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                      title="Remove project"
                      aria-label="Remove project"
                    >
                      <X size={9} />
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })}

        <button
          data-tutorial="step-1"
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
          onClick={() => useSettingsStore.getState().open(undefined, 'about')}
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
