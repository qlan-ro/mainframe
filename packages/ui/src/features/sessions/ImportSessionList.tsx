/**
 * Step 2 of the import flow: the project's importable transcripts.
 *
 * Importing writes a chat daemon-side, so the thread list is reloaded rather
 * than patched locally — the daemon is the source of truth for what exists —
 * and the dialog closes on the first success, since one import is the whole
 * errand.
 */
import { useCallback, useState } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { ChevronLeftIcon, Loader2Icon } from 'lucide-react';
import type { ExternalSession } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { importExternalSession } from '@/lib/api/external-sessions';
import { DialogRowList } from './DialogRowList';
import { ExternalSessionRow } from './ExternalSessionRow';
import { useExternalSessions, type ExternalSessionsState } from './use-external-sessions';

interface ImportRowsProps extends ExternalSessionsState {
  projectPath: string | undefined;
  importing: string | null;
  onImport: (session: ExternalSession) => void;
}

function ImportRows({
  sessions,
  loading,
  error,
  hasMore,
  sentinelRef,
  retry,
  projectPath,
  importing,
  onImport,
}: ImportRowsProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        Loading sessions…
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
        {error}
        <Button data-testid="sessions-import-retry" variant="outline" size="xs" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return <p className="py-8 text-center text-muted-foreground">No importable sessions</p>;
  }

  return (
    <DialogRowList
      items={sessions}
      itemKey={(session) => session.sessionId}
      renderItem={(session) => (
        <ExternalSessionRow session={session} projectPath={projectPath} importing={importing} onImport={onImport} />
      )}
      footer={
        hasMore ? (
          <div
            ref={sentinelRef}
            data-testid="sessions-import-load-more"
            className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground"
          >
            <Loader2Icon className="size-3.5 animate-spin" />
            Loading more…
          </div>
        ) : undefined
      }
    />
  );
}

interface ImportSessionListProps {
  port: number;
  projectId: string;
  projectPath: string | undefined;
  onDone: () => void;
  /** Absent when a project filter chose the project — there is nothing to go back to. */
  onBack?: () => void;
}

export function ImportSessionList({ port, projectId, projectPath, onDone, onBack }: ImportSessionListProps) {
  const runtime = useAssistantRuntime();
  const page = useExternalSessions(port, projectId);
  const [importing, setImporting] = useState<string | null>(null);

  const handleImport = useCallback(
    async (session: ExternalSession) => {
      if (importing !== null) return;
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
        console.warn('[v2/ImportSessionList] import failed', e);
        setImporting(null);
      }
    },
    [port, projectId, importing, runtime, onDone],
  );

  return (
    <div className="flex flex-col gap-2">
      {onBack !== undefined && (
        <Button
          data-testid="sessions-import-back"
          variant="ghost"
          size="xs"
          className="-ml-2 self-start"
          onClick={onBack}
        >
          <ChevronLeftIcon />
          Back
        </Button>
      )}
      <ImportRows {...page} projectPath={projectPath} importing={importing} onImport={(s) => void handleImport(s)} />
    </div>
  );
}
