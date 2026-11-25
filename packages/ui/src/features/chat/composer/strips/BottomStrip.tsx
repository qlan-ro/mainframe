'use client';

/**
 * Under the card, once the session exists (K6, K8): where it runs and its
 * branch, with the changes at the end of the row. No box, just quiet controls.
 * Nothing before the first message (K7). A chat with no composer, read-only or
 * with its directory missing, keeps the strip; where it runs is then `fixed`.
 * Until the session's own record loads, the strip shows what the list knows.
 * A workspace tab has no changes: they open the review panel, which is the chat
 * column's.
 */
import { useContext, useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { FolderGit2, Lock, Monitor, Timer } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { activeSessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { ConversationVisibility } from '../../runtime/conversation-visibility';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { WorktreePopover } from '../config-toolbar/WorktreePopover';
import { ComposerCardProvider, ComposerHint } from '../composer-card-context';
import { ChangesButton } from './ChangesButton';

export const BOTTOM_STRIP_BUTTON =
  'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-small whitespace-nowrap text-ink-secondary hover:bg-sidebar-accent focus-visible:focus-line';

/** A temporary session has no worktree to move to, and the choice is fixed at creation. */
function TemporaryPart() {
  return (
    <ComposerHint label="Fixed when the session was created">
      <button
        type="button"
        data-testid="composer-temporary"
        aria-disabled
        aria-label="Temporary, deleted when closed. Fixed when the session was created"
        className={cn(BOTTOM_STRIP_BUTTON, 'cursor-default hover:bg-transparent')}
      >
        <Timer className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">
          <span className="font-medium">Temporary</span>
          <span className="@max-[400px]/composer:hidden"> · deleted when closed</span>
        </span>
        <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </ComposerHint>
  );
}

const directoryName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

/** A control only with the session's own record: the list's is not enough to move it. */
function WherePart({
  session,
  chat,
  branch,
  baseBranch,
  onOpen,
}: {
  session: StripSession;
  chat: Chat | null;
  branch?: string;
  baseBranch?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0);
  const busy = useAuiState((s) => s.thread.isRunning);
  const { projectPath } = useActiveIdentity();
  const isolated = session.worktreePath != null;
  const path = session.worktreePath ?? projectPath;
  const directory = path && directoryName(path);
  const Icon = isolated ? FolderGit2 : Monitor;
  const runsIn = [isolated ? 'Runs in a worktree' : 'Runs in the local checkout', directory].filter(Boolean).join(', ');
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="font-medium @max-[400px]/composer:hidden">{isolated ? 'Worktree' : 'Local'}</span>
    </>
  );
  if (!chat) {
    return (
      <span
        role="note"
        data-testid="composer-where"
        aria-label={runsIn}
        title={path}
        className={cn(BOTTOM_STRIP_BUTTON, 'pr-0 shrink-0 hover:bg-transparent')}
      >
        {content}
      </span>
    );
  }
  return (
    <WorktreePopover
      chat={chat}
      branch={branch}
      baseBranch={baseBranch}
      hasMessages={hasMessages}
      busy={busy}
      open={open}
      onOpenChange={(next) => {
        if (next) onOpen?.();
        setOpen(next);
      }}
    >
      <button
        type="button"
        data-testid="composer-worktree-trigger"
        data-isolated={isolated || undefined}
        aria-label={`${runsIn}. ${isolated ? 'Worktree options' : 'Isolate in a worktree'}`}
        title={path ?? runsIn}
        className={cn(BOTTOM_STRIP_BUTTON, 'pr-0 shrink-0', open && 'bg-chrome-press hover:bg-chrome-press')}
      >
        {content}
      </button>
    </WorktreePopover>
  );
}

function BranchPart({
  session,
  port,
  branch,
  baseBranch,
  refetch,
}: {
  session: StripSession;
  port: number;
  branch?: string;
  baseBranch?: string;
  refetch: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!branch) return null;
  const label = baseBranch ? `${branch} from ${baseBranch}` : branch;
  return (
    <BranchPopover
      port={port}
      projectId={session.projectId}
      chatId={session.id}
      open={open}
      onOpenChange={setOpen}
      onBranchChanged={refetch}
    >
      <button
        type="button"
        data-testid="composer-branch"
        aria-label={`Branch ${label}. Manage branches`}
        className={cn(BOTTOM_STRIP_BUTTON, 'pl-0', open && 'bg-chrome-press hover:bg-chrome-press')}
      >
        <span aria-hidden className="shrink-0 @max-[400px]/composer:hidden">
          ·
        </span>
        <span className="min-w-0 truncate font-mono text-caption/[1.45]" title={label}>
          {label}
        </span>
      </button>
    </BranchPopover>
  );
}

/** What the strip needs of the session, from its own record or, until that loads, from the session list's. */
type StripSession = Pick<
  Chat,
  'id' | 'projectId' | 'temporary' | 'noProject' | 'worktreePath' | 'branchName' | 'baseBranch'
>;

function useListedSession(): StripSession | null {
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const id = useAuiState((s) => s.threadListItem?.remoteId);
  if (!custom || id === undefined) return null;
  const { projectId, temporary, noProject, worktreePath, branchName, baseBranch } = custom;
  return { id, projectId, temporary, noProject, worktreePath, branchName, baseBranch };
}

function SessionLocation({ session, chat, port }: { session: StripSession; chat: Chat | null; port: number }) {
  const visible = useContext(ConversationVisibility);
  const hasRecordedBase = Boolean(session.worktreePath && session.baseBranch);
  const { branch, liveBranch, refetch } = useDisplayBranch({
    port,
    projectId: session.projectId,
    chatId: session.id,
    branchName: session.branchName,
    isWorktree: session.worktreePath != null,
    noProject: session.noProject,
    worktreePath: session.worktreePath,
    hasRecordedBase,
    visible,
  });
  const baseBranch =
    session.worktreePath && branch && liveBranch === session.branchName ? session.baseBranch : undefined;
  return (
    <>
      {session.temporary ? (
        <TemporaryPart />
      ) : (
        <WherePart
          session={session}
          chat={chat}
          branch={branch}
          baseBranch={baseBranch}
          onOpen={visible && hasRecordedBase ? refetch : undefined}
        />
      )}
      {!session.noProject && (
        <BranchPart session={session} port={port} branch={branch} baseBranch={baseBranch} refetch={refetch} />
      )}
    </>
  );
}

export function BottomStrip({ fixed = false }: { fixed?: boolean }) {
  const port = useDaemonPort();
  const [strip, setStrip] = useState<HTMLElement | null>(null);
  const chat = useChatExtrasSelector((extras) => extras?.state.chatConfig ?? null);
  const listed = useListedSession();
  const inColumn = useAuiState((s) => s.threadListItem?.id === s.threads.mainThreadId);
  const session = chat ?? listed;
  if (session == null || session.id.startsWith('__LOCALID_')) return null;
  if (!session.temporary && session.noProject) return null;

  return (
    <ComposerCardProvider value={strip}>
      <div
        ref={setStrip}
        data-testid="composer-bottom-strip"
        className="@container/composer flex min-h-7.5 min-w-0 shrink-0 items-center gap-0.5 px-1.5 pt-1.5"
      >
        <SessionLocation session={session} chat={fixed ? null : chat} port={port} />
        {!session.noProject && inColumn && (
          <ChangesButton port={port} projectId={session.projectId} chatId={session.id} />
        )}
      </div>
    </ComposerCardProvider>
  );
}
