/**
 * ImportSessionsDialog — two-step import flow inside a shadcn Dialog:
 *   Step 1: project picker (skipped when filterProjectId is set)
 *   Step 2: list of importable external sessions with per-row Import action
 *
 * After a successful import the thread list is reloaded via
 * assistantRuntime.threads.reload() and the dialog closes.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { GitBranch, Clock, Loader2 } from 'lucide-react';
import type { ExternalSession, Project } from '@qlan-ro/mainframe-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getExternalSessions, importExternalSession } from '@/lib/api/external-sessions';
import { formatRelativeTime } from '../view-model/relative-time';

// ── pure helpers ──────────────────────────────────────────────────────────────

function cleanPromptDisplay(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function worktreeLabel(cwd: string | undefined, projectPath: string | undefined): string | null {
  if (!cwd || !projectPath) return null;
  if (cwd === projectPath) return null;
  const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
  return cwd.startsWith(prefix) ? cwd.slice(prefix.length) : cwd;
}

function formatIsoRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'Unknown';
  return formatRelativeTime(ts, Date.now());
}

// ── project picker ────────────────────────────────────────────────────────────

function ProjectPicker({
  projects,
  filterProjectId,
  onSelect,
}: {
  projects: Project[];
  filterProjectId: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      if (a.id === filterProjectId) return -1;
      if (b.id === filterProjectId) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [projects, filterProjectId]);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="px-1 pb-1.5 pt-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-mf-text-3">
        Select project
      </div>
      {sorted.map((project) => (
        <Tooltip key={project.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`sessions-import-project-${project.id}`}
              onClick={() => onSelect(project.id)}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-body text-foreground transition-colors hover:bg-accent"
            >
              {project.name}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{project.path}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

// ── external session row ──────────────────────────────────────────────────────

function ExternalSessionRow({
  session,
  projectPath,
  importing,
  onImport,
}: {
  session: ExternalSession;
  projectPath: string | undefined;
  importing: string | null;
  onImport: (session: ExternalSession) => void;
}) {
  const label = worktreeLabel(session.cwd, projectPath);
  const isThis = importing === session.sessionId;
  const isAny = importing !== null;

  return (
    <div
      data-testid="external-session-item"
      className="flex items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-foreground">
          {session.firstPrompt ? cleanPromptDisplay(session.firstPrompt) : 'Untitled session'}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-caption text-mf-text-3">
          {session.gitBranch && (
            <>
              <GitBranch className="size-2.5 shrink-0" />
              <span className="max-w-[100px] truncate" data-testid="external-session-branch">
                {session.gitBranch}
              </span>
              <span>·</span>
            </>
          )}
          {label && (
            <>
              <span
                className="max-w-[140px] truncate font-mono"
                data-testid="external-session-worktree"
                title={session.cwd}
              >
                {label}
              </span>
              <span>·</span>
            </>
          )}
          <Clock className="size-2.5 shrink-0" />
          <span>{formatIsoRelative(session.modifiedAt)}</span>
        </div>
      </div>
      <button
        type="button"
        data-testid="import-session-btn"
        disabled={isAny}
        onClick={() => onImport(session)}
        onPointerEnter={(e) => e.stopPropagation()}
        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-caption text-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40"
      >
        {isThis ? (
          <>
            <Loader2 className="size-2.5 animate-spin" />
            Importing…
          </>
        ) : (
          'Import'
        )}
      </button>
    </div>
  );
}

// ── session list ──────────────────────────────────────────────────────────────

function SessionList({
  port,
  projectId,
  projectPath,
  onDone,
}: {
  port: number;
  projectId: string;
  projectPath: string | undefined;
  onDone: () => void;
}) {
  const runtime = useAssistantRuntime();
  const [sessions, setSessions] = useState<ExternalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getExternalSessions(port, projectId)
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((e: unknown) => {
        console.warn('[ImportSessionsDialog] fetch failed', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId]);

  const handleImport = useCallback(
    async (session: ExternalSession) => {
      if (importing) return;
      setImporting(session.sessionId);
      try {
        await importExternalSession(port, projectId, {
          sessionId: session.sessionId,
          adapterId: session.adapterId,
          title: session.firstPrompt?.slice(0, 80),
          createdAt: session.createdAt,
          modifiedAt: session.modifiedAt,
        });
        runtime.threads.reload();
        onDone();
      } catch (e: unknown) {
        console.warn('[ImportSessionsDialog] import failed', e);
        setImporting(null);
      }
    },
    [port, projectId, importing, runtime, onDone],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-mf-text-3">
        <Loader2 className="size-3.5 animate-spin" />
        <span className="text-body">Loading sessions…</span>
      </div>
    );
  }

  if (sessions.length === 0) {
    return <div className="py-8 text-center text-body text-muted-foreground">No importable sessions</div>;
  }

  return (
    <ScrollArea className="max-h-[340px]">
      <div className="flex flex-col gap-0.5 pr-2">
        {sessions.map((session) => (
          <ExternalSessionRow
            key={session.sessionId}
            session={session}
            projectPath={projectPath}
            importing={importing}
            onImport={(s) => void handleImport(s)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

// ── dialog root ───────────────────────────────────────────────────────────────

interface ImportSessionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  port: number;
  projects: Project[];
  filterProjectId: string | null;
}

export function ImportSessionsDialog({
  open,
  onOpenChange,
  port,
  projects,
  filterProjectId,
}: ImportSessionsDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(filterProjectId);

  // Reset project selection when dialog opens/closes.
  useEffect(() => {
    if (open) setSelectedProjectId(filterProjectId);
  }, [open, filterProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="sessions-import-dialog" className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Import external sessions</DialogTitle>
        </DialogHeader>

        {selectedProjectId === null ? (
          <ProjectPicker projects={projects} filterProjectId={filterProjectId} onSelect={setSelectedProjectId} />
        ) : (
          <SessionList
            port={port}
            projectId={selectedProjectId}
            projectPath={selectedProject?.path}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
