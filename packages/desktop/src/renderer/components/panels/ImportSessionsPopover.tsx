import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitBranch, Clock, Loader2 } from 'lucide-react';
import type { ExternalSession, Project } from '@qlan-ro/mainframe-types';
import { getExternalSessions, importExternalSession } from '../../lib/api';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { createLogger } from '../../lib/logger';

const log = createLogger('renderer:import-sessions');

function cleanPromptDisplay(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  if (diffDays < 7) return `${date.toLocaleDateString([], { weekday: 'long' })} ${time}`;
  if (diffDays < 14) return 'Last week';
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ImportSessionsPopoverProps {
  projects: Project[];
  activeProjectId: string | null;
  filterProjectId: string | null;
  onClose: () => void;
}

export function ImportSessionsPopover({
  projects,
  activeProjectId,
  filterProjectId,
  onClose,
}: ImportSessionsPopoverProps): React.ReactElement {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(filterProjectId);
  const [sessions, setSessions] = useState<ExternalSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-import-popover]')) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    getExternalSessions(selectedProjectId)
      .then(setSessions)
      .catch((err) => log.warn('failed to fetch external sessions', { err: String(err) }))
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  const handleImport = useCallback(
    async (session: ExternalSession) => {
      if (!selectedProjectId || importing) return;
      setImporting(session.sessionId);
      try {
        await importExternalSession(
          selectedProjectId,
          session.sessionId,
          session.adapterId,
          session.firstPrompt?.slice(0, 80),
          session.createdAt,
          session.modifiedAt,
        );
        onClose();
      } catch (err) {
        log.warn('import failed', { err: String(err) });
        setImporting(null);
      }
    },
    [selectedProjectId, importing, onClose],
  );

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (a.id === activeProjectId) return -1;
      if (b.id === activeProjectId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [projects, activeProjectId]);

  if (!selectedProjectId) {
    return (
      <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] max-w-[280px] bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1">
        <div className="px-3 py-1.5 text-mf-status text-mf-text-secondary uppercase tracking-wider">Select project</div>
        {sortedProjects.map((project) => (
          <Tooltip key={project.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setSelectedProjectId(project.id)}
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

  return (
    <div className="absolute right-0 top-full mt-1 z-50 min-w-[260px] max-w-[360px] max-h-[400px] overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1">
      {loading ? (
        <div className="px-3 py-4 flex items-center justify-center text-mf-text-secondary">
          <Loader2 size={14} className="animate-spin mr-2" />
          <span className="text-mf-small">Loading sessions...</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="px-3 py-3 text-mf-small text-mf-text-secondary text-center">No importable sessions</div>
      ) : (
        sessions.map((session) => (
          <Tooltip key={session.sessionId}>
            <TooltipTrigger asChild>
              <div
                data-testid="external-session-item"
                className="px-3 py-2 hover:bg-mf-hover transition-colors flex items-start gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-mf-small text-mf-text-primary truncate">
                    {session.firstPrompt ? cleanPromptDisplay(session.firstPrompt) : 'Untitled session'}
                  </div>
                  <div className="text-mf-status text-mf-text-secondary mt-0.5 flex items-center gap-1">
                    {session.gitBranch && (
                      <>
                        <GitBranch size={10} className="shrink-0" />
                        <span className="truncate max-w-[100px]">{session.gitBranch}</span>
                        <span>{'·'}</span>
                      </>
                    )}
                    <Clock size={10} className="shrink-0" />
                    <span>{formatRelativeTime(session.modifiedAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="import-session-btn"
                  disabled={importing === session.sessionId}
                  onClick={() => handleImport(session)}
                  onPointerEnter={(e) => e.stopPropagation()}
                  className="shrink-0 px-2 py-0.5 rounded text-mf-status bg-mf-hover hover:bg-mf-accent hover:text-white transition-colors disabled:opacity-40"
                >
                  {importing === session.sessionId ? 'Importing...' : 'Import'}
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[300px] whitespace-pre-wrap break-words">
              {session.firstPrompt ? cleanPromptDisplay(session.firstPrompt) : 'Untitled session'}
            </TooltipContent>
          </Tooltip>
        ))
      )}
    </div>
  );
}
