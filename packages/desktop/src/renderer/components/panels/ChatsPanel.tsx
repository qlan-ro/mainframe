import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Plus, Download } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:panels');
import { useChatsStore, useProjectsStore } from '../../store';
import { useTabsStore } from '../../store/tabs';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { createProject } from '../../lib/api';
import { ContextMenu } from '../ui/context-menu';
import type { ContextMenuItem } from '../ui/context-menu';
import { cn } from '../../lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { DirectoryPickerModal } from '../DirectoryPickerModal';
import { daemonClient } from '../../lib/client';
import { getDefaultModelForAdapter } from '../../lib/adapters';
import { pinChat } from '../../lib/api';
import { ProjectGroup } from './ProjectGroup';
import { FlatSessionRow } from './FlatSessionRow';
import { ImportSessionsPopover } from './ImportSessionsPopover';
import { useZoneHeaderActions } from '../zone/ZoneHeaderSlot.js';
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

const BADGE_BASE =
  'inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-bold leading-none';

function FilterPillBadge({
  count,
  isActive,
  onClick,
  label,
  truncate: shouldTruncate,
}: {
  count: number;
  isActive: boolean;
  onClick: () => void;
  label: string;
  truncate?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 px-2.5 py-1 rounded-full text-mf-status transition-colors inline-flex items-center gap-1.5',
        isActive ? 'bg-mf-accent text-white' : 'bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary',
      )}
    >
      {shouldTruncate ? <span className="truncate max-w-[140px]">{label}</span> : label}
      {count > 0 && (
        <span className={cn(BADGE_BASE, isActive ? 'bg-mf-hover text-mf-text-secondary' : 'bg-mf-accent text-white')}>
          {count}
        </span>
      )}
    </button>
  );
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
    <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] max-w-[280px] bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1">
      <div className="px-3 py-1.5 text-mf-status text-mf-text-secondary uppercase tracking-wider">Select project</div>
      {sorted.map((project) => (
        <Tooltip key={project.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => onSelect(project.id)}
              className="w-full text-left px-3 py-1.5 text-mf-small truncate hover:bg-mf-hover transition-colors text-mf-text-primary"
            >
              {project.name}
            </button>
          </TooltipTrigger>
          <TooltipContent>{project.path}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export function ChatsPanel(): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const addProject = useProjectsStore((s) => s.addProject);
  const chats = useChatsStore((s) => s.chats);
  const unreadChatIds = useChatsStore((s) => s.unreadChatIds);
  const pendingPermissions = useChatsStore((s) => s.pendingPermissions);

  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [showNewSessionPopover, setShowNewSessionPopover] = useState(false);
  const [showImportPopover, setShowImportPopover] = useState(false);
  const filterProjectId = useChatsStore((s) => s.filterProjectId);
  const _setFilterProjectId = useChatsStore((s) => s.setFilterProjectId);
  const setActiveChat = useChatsStore((s) => s.setActiveChat);
  const filterScrollRef = useRef<HTMLDivElement>(null);

  const activeProjectId = useActiveProjectId();

  const handleFilterSelect = useCallback(
    (projectId: string | null) => {
      _setFilterProjectId(projectId);
      if (!projectId) return;
      const projectChats = chats
        .filter((c) => c.projectId === projectId)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const mostRecent = projectChats[0];
      if (mostRecent) {
        setActiveChat(mostRecent.id);
        useTabsStore.getState().openChatTab(mostRecent.id, mostRecent.title);
        daemonClient.resumeChat(mostRecent.id);
      }
    },
    [chats, setActiveChat, _setFilterProjectId],
  );

  const handleFilterWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  }, []);

  // Clean up stale localStorage key from old manual toggle feature
  useEffect(() => {
    localStorage.removeItem('mf:sessionsViewMode');
  }, []);

  // View mode is derived from the filter: 'All' → grouped, specific project → flat
  const viewMode = filterProjectId === null ? 'grouped' : 'flat';

  const handleNewSessionClick = useCallback(() => {
    if (projects.length === 0) return;
    if (filterProjectId) {
      daemonClient.createChat(filterProjectId, 'claude', getDefaultModelForAdapter('claude'));
      return;
    }
    if (projects.length === 1) {
      daemonClient.createChat(projects[0]!.id, 'claude', getDefaultModelForAdapter('claude'));
      return;
    }
    setShowNewSessionPopover((prev) => !prev);
  }, [projects, filterProjectId]);

  const handleNewSessionInProject = useCallback((projectId: string) => {
    daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'));
    setShowNewSessionPopover(false);
  }, []);

  // Persist collapse state
  useEffect(() => {
    saveCollapsed(collapsed);
  }, [collapsed]);

  const groups = useMemo(() => buildGroups(projects, chats), [projects, chats]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const flatChats = useMemo(
    () =>
      [...chats].sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }),
    [chats],
  );

  const filteredGroups = useMemo(
    () => (filterProjectId ? groups.filter((g) => g.project.id === filterProjectId) : groups),
    [groups, filterProjectId],
  );
  const filteredFlatChats = useMemo(
    () => (filterProjectId ? flatChats.filter((c) => c.projectId === filterProjectId) : flatChats),
    [flatChats, filterProjectId],
  );

  const attentionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chat of chats) {
      if (unreadChatIds.has(chat.id) || pendingPermissions.has(chat.id)) {
        counts.set(chat.projectId, (counts.get(chat.projectId) ?? 0) + 1);
      }
    }
    return counts;
  }, [chats, unreadChatIds, pendingPermissions]);

  // Sorted project list for filter badges (most recently used first)
  const sortedProjects = useMemo(() => {
    const latestByProject = new Map<string, number>();
    for (const c of chats) {
      const ts = new Date(c.updatedAt).getTime();
      const prev = latestByProject.get(c.projectId) ?? 0;
      if (ts > prev) latestByProject.set(c.projectId, ts);
    }
    return [...projects].sort((a, b) => (latestByProject.get(b.id) ?? 0) - (latestByProject.get(a.id) ?? 0));
  }, [projects, chats]);

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

  const renameCallbacks = useRef<Map<string, () => void>>(new Map());

  const registerRenameCallback = useCallback((chatId: string, trigger: () => void) => {
    renameCallbacks.current.set(chatId, trigger);
  }, []);

  const unregisterRenameCallback = useCallback((chatId: string) => {
    renameCallbacks.current.delete(chatId);
  }, []);

  const updateChat = useChatsStore((s) => s.updateChat);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sessionId: string | undefined, chatId?: string) => {
      e.preventDefault();
      const chat = chatId ? chats.find((c) => c.id === chatId) : undefined;
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          ...(chat
            ? [
                {
                  label: 'Rename',
                  onClick: () => {
                    renameCallbacks.current.get(chat.id)?.();
                  },
                },
                {
                  label: chat.pinned ? 'Unpin' : 'Pin',
                  onClick: () => {
                    const newPinned = !chat.pinned;
                    updateChat({ ...chat, pinned: newPinned });
                    pinChat(chat.id, newPinned).catch((err) => log.warn('pin failed', { err: String(err) }));
                  },
                },
              ]
            : []),
          ...(sessionId
            ? [
                {
                  label: 'Copy Session ID',
                  onClick: () => {
                    navigator.clipboard.writeText(sessionId).catch((err) => {
                      log.warn('failed to copy session id', { err: String(err) });
                    });
                  },
                },
              ]
            : []),
        ],
      });
    },
    [chats, updateChat],
  );

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

  const headerActions = useMemo(
    () => (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setShowDirPicker(true)}
              className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
            >
              <FolderPlus size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Add project</TooltipContent>
        </Tooltip>
        <div className="relative" data-new-session-popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleNewSessionClick}
                disabled={projects.length === 0}
                className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <Plus size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New session</TooltipContent>
          </Tooltip>
          {showNewSessionPopover && (
            <NewSessionPopover
              projects={projects}
              activeProjectId={activeProjectId}
              onSelect={handleNewSessionInProject}
              onClose={() => setShowNewSessionPopover(false)}
            />
          )}
        </div>
        <div className="relative" data-import-popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setShowImportPopover((prev) => !prev)}
                disabled={projects.length === 0}
                className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
                data-testid="import-sessions-btn"
              >
                <Download size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Import external sessions</TooltipContent>
          </Tooltip>
          {showImportPopover && (
            <ImportSessionsPopover
              projects={projects}
              activeProjectId={activeProjectId}
              filterProjectId={filterProjectId}
              onClose={() => setShowImportPopover(false)}
            />
          )}
        </div>
      </>
    ),
    [
      handleNewSessionClick,
      handleNewSessionInProject,
      projects,
      activeProjectId,
      showNewSessionPopover,
      showImportPopover,
      filterProjectId,
    ],
  );

  useZoneHeaderActions(headerActions);

  return (
    <div className="h-full flex flex-col">
      {/* Project filter badges */}
      {projects.length > 1 && (
        <div className="px-2.5 py-2 overflow-hidden">
          <div ref={filterScrollRef} onWheel={handleFilterWheel} className="flex gap-2 overflow-x-auto scrollbar-none">
            <FilterPillBadge
              count={Array.from(attentionCounts.values()).reduce((a, b) => a + b, 0)}
              isActive={filterProjectId === null}
              onClick={() => handleFilterSelect(null)}
              label="All"
            />
            {sortedProjects.map((p) => (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <FilterPillBadge
                    count={attentionCounts.get(p.id) ?? 0}
                    isActive={filterProjectId === p.id}
                    onClick={() => handleFilterSelect(filterProjectId === p.id ? null : p.id)}
                    label={p.name}
                    truncate
                  />
                </TooltipTrigger>
                <TooltipContent>{p.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-[10px]">
        {projects.length === 0 ? (
          <div className="py-4 text-center text-mf-text-secondary text-mf-label">No projects yet.</div>
        ) : viewMode === 'grouped' ? (
          <div className="space-y-1">
            {filteredGroups.map((g) => (
              <ProjectGroup
                key={g.project.id}
                project={g.project}
                chats={g.chats}
                parentName={g.parentName}
                collapsed={collapsed.has(g.project.id)}
                onToggleCollapse={() => toggleCollapse(g.project.id)}
                onContextMenu={handleContextMenu}
                registerRenameCallback={registerRenameCallback}
                unregisterRenameCallback={unregisterRenameCallback}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredFlatChats.length === 0 ? (
              <div className="py-4 text-center text-mf-text-secondary text-mf-label">No sessions yet.</div>
            ) : (
              filteredFlatChats.map((chat) => (
                <FlatSessionRow
                  key={chat.id}
                  chat={chat}
                  projectName={projectMap.get(chat.projectId)?.name}
                  onContextMenu={handleContextMenu}
                  registerRenameCallback={registerRenameCallback}
                  unregisterRenameCallback={unregisterRenameCallback}
                />
              ))
            )}
          </div>
        )}
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
