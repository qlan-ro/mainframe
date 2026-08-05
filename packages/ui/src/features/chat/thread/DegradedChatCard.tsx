/**
 * DegradedChatCard — unified recovery card for a degraded chat, rendered in
 * the thread's sticky footer. It covers deleted transcripts, deleted worktrees,
 * and missing project directories. One section renders per cause; a chat can
 * have multiple causes, in which case transcript recovery merges into the
 * working-directory action.
 */
import { type ReactNode, useState } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { archiveChat, continueChatHere, continueChatInProjectRoot, recreateChatWorktree } from '@/lib/api/chats';

const ACTION_BUTTON =
  'rounded-md border border-border px-3 py-1.5 text-label text-foreground transition-colors hover:bg-accent disabled:opacity-50';

function MissingPath({ path }: { path: string }) {
  return <code className="font-mono text-label break-all">{path}</code>;
}

function CauseSection({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 text-left">
      <p className="flex items-center gap-1.5 text-body font-medium text-foreground">
        <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />
        {title}
      </p>
      <p className="min-w-0 text-label text-muted-foreground">{body}</p>
    </div>
  );
}

export function DegradedChatCard() {
  const extras = useChatExtras();
  const port = useDaemonPort();
  const [busy, setBusy] = useState(false);
  const [recreateError, setRecreateError] = useState<string | null>(null);

  const chat = extras?.state.chatConfig ?? null;
  const worktreeMissing = chat?.worktreeMissing ?? false;
  const transcriptMissing = chat?.transcriptMissing ?? false;
  const directoryMissing = chat?.directoryMissing ?? false;
  if (!chat || (!worktreeMissing && !transcriptMissing && !directoryMissing)) return null;
  const chatId = chat.id;

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    void action()
      .catch((err: unknown) => {
        // Recovery failures surface in the card; the daemon's chat.updated clears it on success.
        setRecreateError(err instanceof Error ? err.message : 'Recovery failed');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-testid="chat-degraded-card"
      className="flex w-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5"
    >
      {transcriptMissing && (
        <CauseSection
          title="Transcript deleted"
          body={
            worktreeMissing
              ? 'This session’s transcript was deleted from disk by the CLI’s cleanup. Its history can’t be recovered — recover the working directory below and the next message starts a fresh session there.'
              : 'This session’s transcript was deleted from disk by the CLI’s cleanup. Its history can’t be recovered, but you can continue in this chat with a fresh session.'
          }
        />
      )}
      {worktreeMissing && (
        <CauseSection
          title="Worktree deleted"
          body={
            chat.worktreePath ? (
              <>
                The worktree for this session <MissingPath path={chat.worktreePath} /> was deleted.
              </>
            ) : (
              'The worktree for this session was deleted.'
            )
          }
        />
      )}
      {directoryMissing && chat.worktreePath == null && (
        <CauseSection
          title="Project directory missing"
          body={
            chat.missingDirectoryPath ? (
              <>
                The project directory <MissingPath path={chat.missingDirectoryPath} /> is missing. Mainframe kept this
                session and its history, but sending is unavailable until the directory is restored.
              </>
            ) : (
              'The project directory for this session is missing. Mainframe kept the session and its history, but sending is unavailable until the directory is restored.'
            )
          }
        />
      )}

      {recreateError != null && (
        <p data-testid="chat-degraded-error" className="text-label text-destructive">
          {recreateError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {transcriptMissing && !worktreeMissing && !directoryMissing && (
          <button
            data-testid="chat-degraded-continue"
            type="button"
            disabled={busy}
            onClick={() => run(() => continueChatHere(port, chatId))}
            className={ACTION_BUTTON}
          >
            Continue here
          </button>
        )}
        {worktreeMissing && recreateError == null && (
          <button
            data-testid="chat-degraded-recreate-worktree"
            type="button"
            disabled={busy}
            onClick={() => run(() => recreateChatWorktree(port, chatId))}
            className={ACTION_BUTTON}
          >
            Recreate worktree
          </button>
        )}
        {worktreeMissing && (
          <button
            data-testid="chat-degraded-project-root"
            type="button"
            disabled={busy}
            onClick={() => run(() => continueChatInProjectRoot(port, chatId))}
            className={ACTION_BUTTON}
            title="The agent will run in the main checkout; uncommitted worktree work is not recovered."
          >
            Continue in project root
          </button>
        )}
        <button
          data-testid="chat-degraded-delete"
          type="button"
          disabled={busy}
          onClick={() => run(() => archiveChat(port, chatId, true))}
          className={`${ACTION_BUTTON} text-destructive`}
        >
          Delete chat
        </button>
      </div>
    </div>
  );
}
