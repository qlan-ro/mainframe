import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import { useChatsStore, useProjectsStore } from '../../store';
import { createProject } from '../../lib/api';
import { ContextMenu } from '../ui/context-menu';
import type { ContextMenuItem } from '../ui/context-menu';
import { DirectoryPickerModal } from '../DirectoryPickerModal';
import { ProjectGroup } from './ProjectGroup';
import type { Chat, Project } from '@qlan-ro/mainframe-types';

const STORAGE_KEY = 'mf:collapsedProjects';

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

export function ChatsPanel(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const addProject = useProjectsStore((s) => s.addProject);
  const chats = useChatsStore((s) => s.chats);

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showDirPicker, setShowDirPicker] = useState(false);

  // Persist collapse state
  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  const groups = useMemo(() => buildGroups(projects, chats), [projects, chats]);

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
      </div>

      {/* Project groups */}
      <div className="flex-1 overflow-y-auto px-[10px]">
        {groups.length === 0 ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">No projects yet. Add one below.</div>
        ) : (
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
