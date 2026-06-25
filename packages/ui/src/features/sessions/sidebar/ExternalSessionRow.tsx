import { GitBranch, Clock, Loader2 } from 'lucide-react';
import type { ExternalSession } from '@qlan-ro/mainframe-types';
import { formatRelativeTime } from '../view-model/relative-time';

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

export function ExternalSessionRow({
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
        <div className="truncate text-body font-medium text-foreground">
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
