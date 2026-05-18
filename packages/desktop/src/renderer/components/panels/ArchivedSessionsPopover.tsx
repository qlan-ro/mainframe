import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import type { Chat, Project } from '@qlan-ro/mainframe-types';
import { unarchiveChat } from '../../lib/api';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { createLogger } from '../../lib/logger';
import { filterArchivedChats } from './archived-sessions-filter';

const log = createLogger('renderer:archived-sessions');

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ArchivedSessionsPopoverProps {
  chats: Chat[];
  projects: Project[];
  filterProjectId: string | null;
  onClose: () => void;
}

export function ArchivedSessionsPopover({
  chats,
  projects,
  filterProjectId,
  onClose,
}: ArchivedSessionsPopoverProps): React.ReactElement {
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-archived-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const archived = useMemo(() => filterArchivedChats(chats, filterProjectId), [chats, filterProjectId]);
  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
  const showProjectName = filterProjectId === null;

  const handleRestore = useCallback(async (chatId: string) => {
    setRestoring(chatId);
    try {
      await unarchiveChat(chatId);
    } catch (err) {
      log.warn('unarchive failed', { err: String(err) });
    } finally {
      setRestoring(null);
    }
  }, []);

  return (
    <div className="absolute right-0 top-full mt-1 z-50 min-w-[260px] max-w-[360px] max-h-[400px] overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1">
      {archived.length === 0 ? (
        <div className="px-3 py-3 text-mf-small text-mf-text-secondary text-center">No archived sessions</div>
      ) : (
        archived.map((chat) => (
          <Tooltip key={chat.id}>
            <TooltipTrigger asChild>
              <div
                data-testid="archived-session-item"
                className="px-3 py-2 hover:bg-mf-hover transition-colors flex items-start gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-mf-small text-mf-text-primary truncate">{chat.title ?? 'Untitled session'}</div>
                  <div className="text-mf-status text-mf-text-secondary mt-0.5 flex items-center gap-1">
                    {showProjectName && (
                      <>
                        <span className="truncate max-w-[140px]">
                          {projectMap.get(chat.projectId) ?? 'Unknown project'}
                        </span>
                        <span>{'·'}</span>
                      </>
                    )}
                    <Clock size={10} className="shrink-0" />
                    <span>{formatRelativeTime(chat.updatedAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="restore-session-btn"
                  disabled={restoring === chat.id}
                  onClick={() => handleRestore(chat.id)}
                  onPointerEnter={(e) => e.stopPropagation()}
                  className="shrink-0 px-2 py-0.5 rounded text-mf-status bg-mf-hover hover:bg-mf-accent hover:text-white transition-colors disabled:opacity-40 inline-flex items-center gap-1"
                >
                  {restoring === chat.id ? (
                    <>
                      <Loader2 size={10} className="animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    'Restore'
                  )}
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[300px] whitespace-pre-wrap break-words">
              {chat.title ?? 'Untitled session'}
            </TooltipContent>
          </Tooltip>
        ))
      )}
    </div>
  );
}
