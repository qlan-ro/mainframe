import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Plus, Check, X, Play, Square, ChevronDown } from 'lucide-react';
import { createLogger } from '../lib/logger';

const log = createLogger('renderer:titlebar');
import type { Layout } from 'react-resizable-panels';
import { useProjectsStore, useChatsStore, useSearchStore, usePluginLayoutStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { useUIStore } from '../store/ui';
import { useSandboxStore } from '../store/sandbox';
import { createProject, removeProject } from '../lib/api';
import { cn } from '../lib/utils';
import { PluginIcon } from './plugins/PluginIcon';
import { DirectoryPickerModal } from './DirectoryPickerModal';
import { LaunchPopover } from './sandbox/LaunchPopover';
import { useLaunchConfig } from '../hooks/useLaunchConfig';
import { startLaunchConfig, stopLaunchConfig } from '../lib/launch';

type PanelId = 'left' | 'right' | 'bottom';

interface TitleBarProps {
  panelSizes: Layout;
  panelCollapsed: Record<PanelId, boolean>;
}

export function TitleBar({
  panelSizes: _panelSizes,
  panelCollapsed: _panelCollapsed,
}: TitleBarProps): React.ReactElement {
  const {
    projects,
    activeProjectId,
    setActiveProject,
    addProject,
    removeProject: removeFromStore,
  } = useProjectsStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [hoveringId, setHoveringId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;

    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setConfirmingDeleteId(null);
        setHoveringId(null);
      }
    };

    document.addEventListener('mousedown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
    };
  }, [dropdownOpen]);

  const handleAddProject = useCallback(() => {
    setDropdownOpen(false);
    setDirPickerOpen(true);
  }, []);

  const handleDirSelected = useCallback(
    async (selectedPath: string) => {
      setDirPickerOpen(false);
      try {
        const { project, alreadyExists } = await createProject(selectedPath);
        if (!alreadyExists) addProject(project);
        setActiveProject(project.id);
      } catch (error) {
        log.warn('failed to add project', { err: String(error) });
      }
    },
    [addProject, setActiveProject],
  );

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
        log.warn('failed to remove project', { err: String(error) });
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

  // Launch / Preview
  const [launchPopoverOpen, setLaunchPopoverOpen] = useState(false);
  const launchConfig = useLaunchConfig();
  const configs = launchConfig?.configurations ?? [];
  const togglePanel = useUIStore((s) => s.togglePanel);
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const projectStatuses =
    useSandboxStore((s) => (activeProjectId ? s.processStatuses[activeProjectId] : undefined)) ?? {};

  const selectedConfigName = useSandboxStore((s) => s.selectedConfigName);
  // Resolve selected config: explicit selection > preview flag > first config
  const selectedConfig =
    (selectedConfigName ? configs.find((c) => c.name === selectedConfigName) : null) ??
    configs.find((c) => c.preview) ??
    configs[0] ??
    null;
  const selectedStatus = selectedConfig ? (projectStatuses[selectedConfig.name] ?? 'stopped') : 'stopped';
  const selectedRunning = selectedStatus === 'running' || selectedStatus === 'starting';

  const handlePlayStop = useCallback(async () => {
    const projectId = useProjectsStore.getState().activeProjectId;
    if (!projectId || !selectedConfig) return;
    try {
      if (selectedRunning) {
        await stopLaunchConfig(projectId, selectedConfig.name);
      } else {
        await startLaunchConfig(projectId, selectedConfig);
        if (panelCollapsed.bottom) togglePanel('bottom');
      }
    } catch (err) {
      console.warn('[sandbox] preview toggle failed', err);
    }
  }, [selectedConfig, selectedRunning, panelCollapsed, togglePanel]);

  const handleCloseLaunchPopover = useCallback(() => setLaunchPopoverOpen(false), []);

  // Fullview plugin icons (right side of title bar)
  const fullviewContributions = usePluginLayoutStore((s) => s.contributions).filter((c) => c.zone === 'fullview');
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);

  const handleFullviewClick = (pluginId: string): void => {
    usePluginLayoutStore.getState().activateFullview(pluginId);
  };

  return (
    <div className="h-11 bg-mf-app-bg flex items-center app-drag relative">
      {/* Traffic lights + project picker dropdown */}
      <div className="flex items-center pl-[84px] pr-4 z-10 app-no-drag" ref={dropdownRef}>
        <div className="relative">
          <button
            data-testid="project-selector"
            data-tutorial="step-1"
            onClick={() => setDropdownOpen((o) => !o)}
            className={cn(
              'flex items-center gap-2 px-1.5 py-1 rounded-mf-card transition-colors',
              dropdownOpen ? 'bg-mf-panel-bg text-mf-text-primary' : 'text-mf-text-primary hover:bg-mf-panel-bg',
            )}
          >
            {activeProject ? (
              <>
                <div className="w-5 h-5 rounded flex items-center justify-center bg-mf-accent text-white text-mf-body font-semibold shrink-0">
                  {activeProject.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-mf-body font-medium">{activeProject.name}</span>
              </>
            ) : (
              <span className="text-mf-body text-mf-text-secondary">No project</span>
            )}
            <ChevronDown size={12} className="text-mf-text-secondary" />
          </button>

          {dropdownOpen && (
            <div
              data-testid="project-dropdown"
              className="absolute top-full left-0 mt-1 w-56 bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-lg overflow-hidden z-50"
            >
              {projects.map((project) => {
                const isHovering = hoveringId === project.id;
                const isConfirming = confirmingDeleteId === project.id;
                const isActive = activeProjectId === project.id;

                return (
                  <div
                    key={project.id}
                    className="relative flex items-center px-3 py-2 hover:bg-mf-app-bg transition-colors group"
                    onMouseEnter={() => setHoveringId(project.id)}
                    onMouseLeave={() => handleMouseLeave(project.id)}
                  >
                    {isConfirming ? (
                      /* Inline confirm state: ✓ / ✗ */
                      <div className="flex-1 flex items-center justify-between">
                        <span className="text-mf-body text-mf-text-secondary truncate pr-2">{project.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => void handleConfirmDelete(project.id)}
                            className="w-5 h-5 flex items-center justify-center rounded text-green-400 hover:text-green-300 transition-colors"
                            title="Confirm remove"
                            aria-label="Confirm remove project"
                          >
                            <Check size={12} />
                          </button>
                          <button
                            onClick={() => setConfirmingDeleteId(null)}
                            className="w-5 h-5 flex items-center justify-center rounded text-mf-text-secondary hover:text-mf-text-primary transition-colors"
                            title="Cancel"
                            aria-label="Cancel remove project"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Normal project row */
                      <>
                        <button
                          onClick={() => {
                            setActiveProject(project.id);
                            setDropdownOpen(false);
                          }}
                          className="flex-1 flex items-center gap-2 text-left min-w-0"
                        >
                          <div
                            className={cn(
                              'w-5 h-5 rounded flex items-center justify-center text-mf-body font-semibold shrink-0',
                              isActive ? 'bg-mf-accent text-white' : 'bg-mf-app-bg text-mf-text-secondary',
                            )}
                          >
                            {project.name.charAt(0).toUpperCase()}
                          </div>
                          <span
                            className={cn(
                              'text-mf-body truncate',
                              isActive ? 'text-mf-text-primary font-medium' : 'text-mf-text-secondary',
                            )}
                          >
                            {project.name}
                          </span>
                        </button>

                        {/* Hover-reveal remove button */}
                        {isHovering && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmingDeleteId(project.id);
                            }}
                            className="ml-2 w-5 h-5 flex items-center justify-center rounded text-mf-text-secondary hover:text-mf-text-primary transition-colors shrink-0"
                            title="Remove project"
                            aria-label="Remove project"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Add project */}
              <div className="border-t border-mf-border">
                <button
                  onClick={() => void handleAddProject()}
                  className="w-full flex items-center gap-2 px-3 py-2 text-mf-body text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-app-bg transition-colors"
                >
                  <Plus size={14} />
                  <span>Add project</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search box — centered in the title bar */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div
          onClick={() => useSearchStore.getState().open()}
          className="w-[480px] max-w-[90%] flex items-center gap-2 px-3 py-[5px] rounded-mf-card border border-mf-border text-mf-text-secondary text-mf-body app-no-drag cursor-pointer hover:border-mf-text-secondary transition-colors pointer-events-auto"
        >
          <Search size={14} />
          <span>Search ⌘F</span>
        </div>
      </div>

      {/* Right side — Preview + plugin icons */}
      <div className="absolute right-4 flex items-center gap-1 app-no-drag z-10">
        {/* Preview / Launch button */}
        <div className="relative flex items-center" data-launch-popover>
          <button
            onClick={() => setLaunchPopoverOpen((o) => !o)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 text-mf-body rounded-mf-card hover:bg-mf-panel-bg transition-colors',
              selectedConfig
                ? 'text-mf-text-secondary hover:text-mf-text-primary'
                : 'text-mf-text-secondary opacity-60 hover:opacity-100',
            )}
            title="Launch configurations"
          >
            <span>{selectedConfig?.name ?? 'No launch configurations'}</span>
            <ChevronDown size={12} />
          </button>
          {selectedConfig && (
            <button
              onClick={() => void handlePlayStop()}
              disabled={selectedStatus === 'starting'}
              className={cn(
                'w-7 h-7 flex items-center justify-center rounded-mf-card transition-colors disabled:opacity-40',
                selectedRunning
                  ? 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg'
                  : 'text-mf-accent hover:text-mf-accent hover:bg-mf-panel-bg',
              )}
              title={selectedRunning ? 'Stop' : 'Start'}
            >
              {selectedRunning ? <Square size={12} /> : <Play size={12} />}
            </button>
          )}
          {launchPopoverOpen && <LaunchPopover onClose={handleCloseLaunchPopover} />}
        </div>

        {/* Separator */}
        {fullviewContributions.length > 0 && <div className="h-4 w-px bg-mf-divider mx-1" />}

        {/* Fullview plugin icons */}
        {fullviewContributions.map((c) => (
          <button
            key={c.pluginId}
            data-testid={`${c.pluginId}-panel-icon`}
            onClick={() => handleFullviewClick(c.pluginId)}
            title={c.label}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-mf-card transition-colors',
              activeFullviewId === c.pluginId
                ? 'bg-mf-accent text-white'
                : 'text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-panel-bg',
            )}
          >
            {c.icon ? (
              <PluginIcon name={c.icon} size={15} />
            ) : (
              <span className="text-mf-small font-semibold">{c.label.charAt(0)}</span>
            )}
          </button>
        ))}
      </div>
      <DirectoryPickerModal
        open={dirPickerOpen}
        onSelect={(p) => void handleDirSelected(p)}
        onCancel={() => setDirPickerOpen(false)}
      />
    </div>
  );
}
