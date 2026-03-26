import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus, List, FolderOpen, Plus } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import { useChatsStore, useProjectsStore } from '../../store';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { createProject } from '../../lib/api';
import { ContextMenu } from '../ui/context-menu';
import type { ContextMenuItem } from '../ui/context-menu';
import { cn } from '../../lib/utils';
import { DirectoryPickerModal } from '../DirectoryPickerModal';
import { daemonClient } from '../../lib/client';
import { ProjectGroup } from './ProjectGroup';
import { FlatSessionRow } from './FlatSessionRow';
import type { Chat, Project } from '@qlan-ro/mainframe-types';

const STORAGE_KEY = 'mf:collapsedProjects';
const VIEW_MODE_KEY = 'mf:sessionsViewMode';

type ViewMode = 'grouped' | 'flat';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
  } catch {
    /* corrupted data */
  }
  return new Set();
}

function saveCollapsed(set: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ProjectGroupData {
  project: Project;
  chats: Chat[];
  latestUpdate: number;
  parentName?: string;
}

function buildGroups(projects: Project[], chats: Chat[]): ProjectGroupData[] {
  const chatsByProject = new Map<string, Chat[]>();
  for (const chat of chats) {
    const list = chatsByProject.get(chat.projectId);
    if (list) {
      list.push(chat);
    } else {
      chatsByProject.set(chat.projectId, [chat]);
    }
  }

  const projectMap = new Map<string, Project>();
  for (const p of projects) {
    projectMap.set(p.id, p);
  }

  const groups: ProjectGroupData[] = projects.map((project) => {
    const projectChats = chatsByProject.get(project.id) ?? [];
    const latestUpdate = projectChats.reduce((max, c) => Math.max(max, new Date(c.updatedAt).getTime()), 0);
    const parent = project.parentProjectId ? projectMap.get(project.parentProjectId) : undefined;
    return {
      project,
      chats: projectChats,
      latestUpdate,
      parentName: parent?.name,
    };
  });

  groups.sort((a, b) => b.latestUpdate - a.latestUpdate);
  return groups;
}

function NewSessionPopover({
  projects,
  activeProjectId,
  onSelect,
  onClose,
}: {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-new-session-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Sort: active project first, then alphabetical
  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (a.id === activeProjectId) return -1;
      if (b.id === activeProjectId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [projects, activeProjectId]);

  return (
    <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] max-w-[280px] bg-mf-panel border border-mf-border rounded-mf-panel shadow-lg py-1">
      <div className="px-3 py-1.5 text-mf-status text-mf-text-secondary uppercase tracking-wider">Select project</div>
      {sorted.map((project) => (
        <button
          key={project.id}
          type="button"
          onClick={() => onSelect(project.id)}
          className={cn(
            'w-full text-left px-3 py-1.5 text-mf-small truncate hover:bg-mf-hover transition-colors',
            project.id === activeProjectId ? 'text-mf-accent' : 'text-mf-text-primary',
          )}
          title={project.path}
        >
          {project.name}
        </button>
      ))}
    </div>
  );
}

export function ChatsPanel(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const addProject = useProjectsStore((s) => s.addProject);
  const chats = useChatsStore((s) => s.chats);

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) || 'grouped',
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [showNewSessionPopover, setShowNewSessionPopover] = useState(false);

  const activeProjectId = useActiveProjectId();

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === 'grouped' ? 'flat' : 'grouped';
      localStorage.setItem(VIEW_MODE_KEY, next);
      return next;
    });
  }, []);

  const handleNewSessionClick = useCallback(() => {
    if (projects.length === 0) return;
    if (projects.length === 1) {
      daemonClient.createChat(projects[0]!.id, 'claude');
      return;
    }
    setShowNewSessionPopover((prev) => !prev);
  }, [projects]);

  const handleNewSessionInProject = useCallback((projectId: string) => {
    daemonClient.createChat(projectId, 'claude');
    setShowNewSessionPopover(false);
  }, []);

  // Persist collapse state
  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  const groups = useMemo(() => buildGroups(projects, chats), [projects, chats]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const flatChats = useMemo(
    () => [...chats].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chats],
  );

  const toggleCollapse = useCallback((projectId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, sessionId: string | undefined) => {
    e.preventDefault();
    if (!sessionId) return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Copy Session ID',
          onClick: () => {
            navigator.clipboard.writeText(sessionId).catch((err) => {
              log.warn('failed to copy session id', { err: String(err) });
            });
          },
        },
      ],
    });
  }, []);

  const handleAddProject = useCallback(
    async (path: string) => {
      setShowDirPicker(false);
      try {
        const { project } = await createProject(path);
        addProject(project);
      } catch (err) {
        log.warn('failed to create project', { err: String(err) });
      }
    },
    [addProject],
  );

  return (
    <div className="h-full flex flex-col">
      <div className="h-11 px-[10px] flex items-center justify-between">
        <div className="text-mf-small text-mf-text-secondary uppercase tracking-wider">Sessions</div>
        <div className="flex items-center gap-0.5">
          <div className="relative" data-new-session-popover>
            <button
              type="button"
              onClick={handleNewSessionClick}
              disabled={projects.length === 0}
              className="p-1 rounded-mf-input text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              title="New session"
            >
              <Plus size={14} />
            </button>
            {showNewSessionPopover && (
              <NewSessionPopover
                projects={projects}
                activeProjectId={activeProjectId}
                onSelect={handleNewSessionInProject}
                onClose={() => setShowNewSessionPopover(false)}
              />
            )}
          </div>
          <button
            type="button"
            onClick={toggleViewMode}
            className="p-1 rounded-mf-input text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover/50 transition-colors"
            title={viewMode === 'grouped' ? 'Switch to flat view' : 'Switch to grouped view'}
          >
            {viewMode === 'grouped' ? <List size={14} /> : <FolderOpen size={14} />}
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-[10px]">
        {projects.length === 0 ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">No projects yet. Add one below.</div>
        ) : viewMode === 'grouped' ? (
          <div className="space-y-1">
            {groups.map((g) => (
              <ProjectGroup
                key={g.project.id}
                project={g.project}
                chats={g.chats}
                parentName={g.parentName}
                collapsed={collapsed.has(g.project.id)}
                onToggleCollapse={() => toggleCollapse(g.project.id)}
                onContextMenu={handleContextMenu}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {flatChats.length === 0 ? (
              <div className="py-4 text-center text-mf-text-secondary text-mf-label">No sessions yet.</div>
            ) : (
              flatChats.map((chat) => (
                <FlatSessionRow
                  key={chat.id}
                  chat={chat}
                  projectName={projectMap.get(chat.projectId)?.name}
                  onContextMenu={handleContextMenu}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Add project button */}
      <div className="px-[10px] py-2 border-t border-mf-border">
        <button
          type="button"
          onClick={() => setShowDirPicker(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-mf-input text-mf-small text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover/50 transition-colors"
        >
          <FolderPlus size={14} />
          <span>Add Project</span>
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      <DirectoryPickerModal open={showDirPicker} onSelect={handleAddProject} onCancel={() => setShowDirPicker(false)} />
    </div>
  );
}
