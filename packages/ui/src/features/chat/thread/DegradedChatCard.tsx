/**
 * DegradedChatCard — unified recovery card for a degraded chat, rendered in
 * the thread area. Replaces both the silent empty thread (transcript deleted
 * from disk) and the old composer worktree banner. One section per cause; a
 * chat can have both, in which case the transcript's "Continue here" merges
 * into whichever worktree action is chosen (fresh session after recovery).
 */
import { useState } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { archiveChat, continueChatHere, continueChatInProjectRoot, recreateChatWorktree } from '@/lib/api/chats';

const ACTION_BUTTON =
  'rounded-md border border-border px-3 py-1.5 text-caption text-foreground transition-colors hover:bg-accent disabled:opacity-50';

function CauseSection({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1 text-left">
      <p className="flex items-center gap-1.5 text-body font-medium text-foreground">
        <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive" />
        {title}
      </p>
      <p className="text-caption text-muted-foreground">{body}</p>
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
  if (!chat || (!worktreeMissing && !transcriptMissing)) return null;
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
      className="mx-auto my-8 flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card px-5 py-5"
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
            chat.worktreePath
              ? `The worktree for this session (${chat.worktreePath}) was deleted.`
              : 'The worktree for this session was deleted.'
          }
        />
      )}

      {recreateError != null && (
        <p data-testid="chat-degraded-error" className="text-caption text-destructive">
          {recreateError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {transcriptMissing && !worktreeMissing && (
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
