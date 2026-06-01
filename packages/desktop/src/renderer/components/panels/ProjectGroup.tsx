import React, { useCallback } from 'react';
import { Plus, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import type { Project, Chat } from '@qlan-ro/mainframe-types';
import { getDefaultModelForAdapter } from '../../lib/adapters';
import { startChat } from '../../lib/chat-actions';
import { deleteProjectWithCleanup } from '../../lib/delete-project';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { TruncatedLabel } from '../ui/truncated-label';
import { FlatSessionRow } from './FlatSessionRow';

interface ProjectGroupProps {
  project: Project;
  chats: Chat[];
  parentName?: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onContextMenu?: (e: React.MouseEvent, sessionId: string | undefined, chatId?: string) => void;
  registerRenameCallback?: (chatId: string, trigger: () => void) => void;
  unregisterRenameCallback?: (chatId: string) => void;
  registerOpenTagPopover?: (chatId: string, trigger: (rect: DOMRect) => void) => void;
  unregisterOpenTagPopover?: (chatId: string) => void;
  registerArchiveCallback?: (chatId: string, trigger: () => void) => void;
  unregisterArchiveCallback?: (chatId: string) => void;
}

export const ProjectGroup = React.memo(function ProjectGroup({
  project,
  chats,
  parentName,
  collapsed,
  onToggleCollapse,
  onContextMenu,
  registerRenameCallback,
  unregisterRenameCallback,
  registerOpenTagPopover,
  unregisterOpenTagPopover,
  registerArchiveCallback,
  unregisterArchiveCallback,
}: ProjectGroupProps): React.ReactElement {
  const handleNewSession = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void startChat(project.id, 'claude', getDefaultModelForAdapter('claude'));
    },
    [project.id],
  );

  const handleDeleteProject = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      await deleteProjectWithCleanup(project);
    },
    [project],
  );

  return (
    <div data-testid={`project-group-${project.id}`}>
      {/* Group header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse();
          }
        }}
        className="group flex items-center h-7 px-2 gap-2 min-w-0 w-full rounded-mf-input text-mf-label hover:bg-mf-hover/50 transition-colors cursor-pointer"
      >
        {/* Left cluster: chevron + name */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="inline-flex w-4 items-center justify-center shrink-0">
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
          <TruncatedLabel
            text={project.name}
            title={project.name}
            data-testid="project-group-name"
            className="text-sm text-mf-text-primary font-medium flex-shrink"
          />
          {parentName && (
            <TruncatedLabel
              text={`↳ ${parentName}`}
              title={parentName}
              data-testid="project-group-parent"
              className="text-mf-status text-mf-text-secondary ml-1 flex-shrink-[2]"
            />
          )}
        </div>
        <span className="h-5 px-1.5 text-[10px] tabular-nums rounded-full bg-mf-hover text-mf-text-secondary flex items-center shrink-0">
          {chats.length}
        </span>
        <div className="shrink-0 hidden group-hover:flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid={`chats-project-new-session-${project.id}`}
                onClick={handleNewSession}
                className="h-7 w-6 inline-flex items-center justify-center rounded-mf-input text-mf-text-secondary hover:text-mf-text-primary hover:bg-mf-hover transition-colors"
                aria-label={`New session in ${project.name}`}
              >
                <Plus size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{`New session in ${project.name}`}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid={`chats-project-delete-${project.id}`}
                onClick={handleDeleteProject}
                className="h-7 w-6 inline-flex items-center justify-center rounded-mf-input text-mf-text-secondary hover:text-mf-destructive hover:bg-mf-hover transition-colors"
                aria-label={`Delete project ${project.name}`}
              >
                <Trash2 size={12} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete Project</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Chat list */}
      {!collapsed && (
        <div className="space-y-0.5 mt-0.5">
          {chats.length === 0 ? (
            <div className="pl-6 py-1 text-mf-status text-mf-text-secondary">No sessions</div>
          ) : (
            chats.map((chat) => (
              <div key={chat.id} className="ml-2">
                <FlatSessionRow
                  chat={chat}
                  projectName={project.name}
                  onContextMenu={onContextMenu}
                  registerRenameCallback={registerRenameCallback}
                  unregisterRenameCallback={unregisterRenameCallback}
                  registerOpenTagPopover={registerOpenTagPopover}
                  unregisterOpenTagPopover={unregisterOpenTagPopover}
                  registerArchiveCallback={registerArchiveCallback}
                  unregisterArchiveCallback={unregisterArchiveCallback}
                />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});
