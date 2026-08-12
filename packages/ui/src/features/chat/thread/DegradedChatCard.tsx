/**
 * DegradedChatCard — unified recovery card for a degraded chat, rendered in
 * the thread's sticky footer. It covers deleted transcripts, deleted worktrees,
 * and missing project directories. One section renders per cause; a chat can
 * have multiple causes, in which case transcript recovery merges into the
 * working-directory action.
 *
 * ONE recipe for every cause (user decision 2026-08-06): a v2 destructive
 * `Alert` per cause, then a single row of `Button variant="outline"` actions.
 * The three banners used to differ in chrome, which read as three features.
 */
import { type ReactNode, useState } from 'react';
import { AlertTriangleIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { archiveChat, continueChatHere, continueChatInProjectRoot, recreateChatWorktree } from '@/lib/api/chats';

function MissingPath({ path }: { path: string }) {
  // `break-all`, not `wrap-break-word`: an absolute path is one unbreakable
  // token and the card is narrow, so it must be allowed to break mid-segment.
  return <code className="font-mono text-xs break-all">{path}</code>;
}

function Cause({ title, body }: { title: string; body: ReactNode }) {
  return (
    <Alert variant="destructive">
      <AlertTriangleIcon />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p className="min-w-0">{body}</p>
      </AlertDescription>
    </Alert>
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
    <div data-testid="chat-degraded-card" className="flex w-full min-w-0 flex-col gap-3">
      {transcriptMissing && (
        <Cause
          title="Transcript deleted"
          body={
            worktreeMissing
              ? 'This session’s transcript was deleted from disk by the CLI’s cleanup. Its history can’t be recovered — recover the working directory below and the next message starts a fresh session there.'
              : 'This session’s transcript was deleted from disk by the CLI’s cleanup. Its history can’t be recovered, but you can continue in this chat with a fresh session.'
          }
        />
      )}
      {worktreeMissing && (
        <Cause
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
        <Cause
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
        <p data-testid="chat-degraded-error" className="text-xs text-destructive">
          {recreateError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {transcriptMissing && !worktreeMissing && !directoryMissing && (
          <Button
            data-testid="chat-degraded-continue"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => continueChatHere(port, chatId))}
          >
            Continue here
          </Button>
        )}
        {worktreeMissing && recreateError == null && (
          <Button
            data-testid="chat-degraded-recreate-worktree"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => run(() => recreateChatWorktree(port, chatId))}
          >
            Recreate worktree
          </Button>
        )}
        {worktreeMissing && (
          <Hint label="The agent will run in the main checkout; uncommitted worktree work is not recovered.">
            <Button
              data-testid="chat-degraded-project-root"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(() => continueChatInProjectRoot(port, chatId))}
            >
              Continue in project root
            </Button>
          </Hint>
        )}
        <Button
          data-testid="chat-degraded-delete"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => run(() => archiveChat(port, chatId, true))}
          className="text-destructive"
        >
          Delete chat
        </Button>
      </div>
    </div>
  );
}
