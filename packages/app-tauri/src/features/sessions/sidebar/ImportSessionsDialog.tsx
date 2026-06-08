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
import { Loader2, ChevronLeft } from 'lucide-react';
import type { ExternalSession, Project } from '@qlan-ro/mainframe-types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getExternalSessions, importExternalSession } from '@/lib/api/external-sessions';
import { ExternalSessionRow } from './ExternalSessionRow';

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
      <div className="px-2 pb-1.5 pt-0.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-mf-text-3">
        Select project
      </div>
      {sorted.map((project) => (
        <Tooltip key={project.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-testid={`sessions-import-project-${project.id}`}
              onClick={() => onSelect(project.id)}
              className="w-full truncate rounded-md px-2 py-1.5 text-left text-body font-medium text-foreground transition-colors hover:bg-accent"
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

// ── session list ──────────────────────────────────────────────────────────────

function SessionList({
  port,
  projectId,
  projectPath,
  onDone,
  onBack,
}: {
  port: number;
  projectId: string;
  projectPath: string | undefined;
  onDone: () => void;
  onBack?: () => void;
}) {
  const runtime = useAssistantRuntime();
  const [sessions, setSessions] = useState<ExternalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [retryCounter, setRetryCounter] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getExternalSessions(port, projectId)
      .then((list) => {
        if (!cancelled) setSessions(list);
      })
      .catch((e: unknown) => {
        console.warn('[ImportSessionsDialog] fetch failed', e);
        if (!cancelled) setError('Failed to load sessions. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, retryCounter]);

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

  const backButton =
    onBack !== undefined ? (
      <button
        type="button"
        data-testid="sessions-import-back"
        onClick={onBack}
        className="mb-2 flex items-center gap-0.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-3" />
        Back
      </button>
    ) : null;

  if (loading) {
    return (
      <>
        {backButton}
        <div className="flex items-center justify-center gap-2 py-8 text-mf-text-3">
          <Loader2 className="size-3.5 animate-spin" />
          <span className="text-body">Loading sessions…</span>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {backButton}
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-body text-muted-foreground">{error}</p>
          <button
            type="button"
            data-testid="sessions-import-retry"
            onClick={() => setRetryCounter((c) => c + 1)}
            className="text-caption text-foreground underline hover:no-underline"
          >
            Try again
          </button>
        </div>
      </>
    );
  }

  if (sessions.length === 0) {
    return (
      <>
        {backButton}
        <div className="py-8 text-center text-body text-muted-foreground">No importable sessions</div>
      </>
    );
  }

  return (
    <>
      {backButton}
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
    </>
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
            onBack={filterProjectId === null ? () => setSelectedProjectId(null) : undefined}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
