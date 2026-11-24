'use client';

/**
 * Under the card, once the session exists (K6, K8): where it runs and its
 * branch, with the changes at the end of the row. No box, just quiet controls.
 * Nothing before the first message (K7).
 */
import { useState } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { FolderGit2, GitBranch, Lock, Monitor, Timer } from 'lucide-react';
import type { Chat } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { BranchPopover } from '@/features/git/BranchPopover';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { WorktreePopover } from '../config-toolbar/WorktreePopover';
import { ComposerHint } from '../composer-card-context';
import { ChangesButton } from './ChangesButton';

export const BOTTOM_STRIP_BUTTON =
  'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-xs whitespace-nowrap text-foreground/80 hover:bg-accent focus-visible:focus-line';

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
        <Timer className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate">
          Temporary<span className="@max-[400px]/composer:hidden"> · deleted when closed</span>
        </span>
        <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </ComposerHint>
  );
}

function WherePart({ chat, hasMessages, busy }: { chat: Chat; hasMessages: boolean; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const isolated = chat.worktreePath != null;
  const Icon = isolated ? FolderGit2 : Monitor;
  return (
    <WorktreePopover chat={chat} hasMessages={hasMessages} busy={busy} open={open} onOpenChange={setOpen}>
      <button
        type="button"
        data-testid="composer-worktree-trigger"
        data-isolated={isolated || undefined}
        aria-label={
          isolated ? 'Runs in a worktree. Worktree options' : 'Runs in the local checkout. Isolate in a worktree'
        }
        title={isolated ? 'Worktree options' : 'Runs in the local checkout'}
        className={cn(BOTTOM_STRIP_BUTTON, 'shrink-0', open && 'bg-accent')}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium @max-[400px]/composer:hidden">{isolated ? 'Worktree' : 'Local'}</span>
      </button>
    </WorktreePopover>
  );
}

function BranchPart({ chat, port }: { chat: Chat; port: number }) {
  const [open, setOpen] = useState(false);
  const { branch, refetch } = useDisplayBranch({
    port,
    projectId: chat.projectId,
    chatId: chat.id,
    branchName: chat.branchName,
    isWorktree: chat.worktreePath != null,
  });
  if (!branch) return null;
  return (
    <BranchPopover
      port={port}
      projectId={chat.projectId}
      chatId={chat.id}
      open={open}
      onOpenChange={setOpen}
      onBranchChanged={refetch}
    >
      <button
        type="button"
        data-testid="composer-branch"
        aria-label={`Branch ${branch}. Manage branches`}
        className={cn(BOTTOM_STRIP_BUTTON, open && 'bg-accent')}
      >
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 truncate" title={branch}>
          {branch}
        </span>
      </button>
    </BranchPopover>
  );
}

export function BottomStrip() {
  const port = useDaemonPort();
  const chat = useChatExtrasSelector((extras) => extras?.state.chatConfig ?? null);
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0);
  const busy = useAuiState((s) => s.thread.isRunning);
  if (chat == null || chat.id.startsWith('__LOCALID_')) return null;
  if (!chat.temporary && chat.noProject) return null;

  return (
    <div
      data-testid="composer-bottom-strip"
      className="flex min-h-7.5 min-w-0 shrink-0 items-center gap-0.5 px-1.5 pt-1.5"
    >
      {chat.temporary ? <TemporaryPart /> : <WherePart chat={chat} hasMessages={hasMessages} busy={busy} />}
      {!chat.noProject && <BranchPart chat={chat} port={port} />}
      {!chat.noProject && !chat.temporary && <ChangesButton port={port} projectId={chat.projectId} chatId={chat.id} />}
    </div>
  );
}
