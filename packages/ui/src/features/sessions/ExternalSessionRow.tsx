/**
 * One importable CLI transcript, inside the import dialog.
 *
 * Two lines rather than the sidebar's one: nothing here is a session the user
 * already knows, so the branch and worktree that identify it have to be on
 * screen, not behind a hover.
 *
 * Every row's Import disables while any import is in flight — the daemon writes
 * one chat per call and a second click mid-write would race the reload.
 */
import { ClockIcon, GitBranchIcon, Loader2Icon } from 'lucide-react';
import type { ExternalSession } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import { formatRelativeTime } from '@/features/sessions/view-model/relative-time';

/** Transcript prompts carry CLI system tags the user never wrote. */
function cleanPrompt(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The part of `cwd` below the project root — a worktree name, or nothing. */
function worktreeLabel(cwd: string | undefined, projectPath: string | undefined): string | null {
  if (cwd === undefined || projectPath === undefined || cwd === projectPath) return null;
  const prefix = projectPath.endsWith('/') ? projectPath : `${projectPath}/`;
  return cwd.startsWith(prefix) ? cwd.slice(prefix.length) : cwd;
}

function relativeIso(iso: string): string {
  const ts = new Date(iso).getTime();
  return Number.isNaN(ts) ? 'Unknown' : formatRelativeTime(ts, Date.now());
}

interface ExternalSessionRowProps {
  session: ExternalSession;
  projectPath: string | undefined;
  /** The session id currently importing, if any — locks every row's action. */
  importing: string | null;
  onImport: (session: ExternalSession) => void;
}

export function ExternalSessionRow({ session, projectPath, importing, onImport }: ExternalSessionRowProps) {
  const worktree = worktreeLabel(session.cwd, projectPath);
  const title = session.title ?? (session.firstPrompt ? cleanPrompt(session.firstPrompt) : 'Untitled session');
  const isThis = importing === session.sessionId;

  return (
    <div data-testid="external-session-item" className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
      <div className="min-w-0 flex-1">
        <TruncatedWithTooltip text={title} className="block font-medium" />
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {session.gitBranch != null && (
            <>
              <GitBranchIcon className="size-3 shrink-0" />
              <TruncatedWithTooltip
                text={session.gitBranch}
                className="max-w-[100px]"
                data-testid="external-session-branch"
              />
            </>
          )}
          {session.gitBranch != null && worktree !== null && <span>·</span>}
          {worktree !== null && (
            <TruncatedWithTooltip
              text={worktree}
              tooltip={session.cwd}
              contentClassName="font-mono break-all"
              className="max-w-[140px] font-mono"
              data-testid="external-session-worktree"
            />
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          data-testid="import-session-btn"
          variant="ghost"
          size="xs"
          disabled={importing !== null}
          onClick={() => onImport(session)}
        >
          {isThis ? (
            <>
              <Loader2Icon className="animate-spin" />
              Importing…
            </>
          ) : (
            'Import'
          )}
        </Button>
        <span className="flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <ClockIcon className="size-3 shrink-0" />
          {relativeIso(session.modifiedAt)}
        </span>
      </div>
    </div>
  );
}
