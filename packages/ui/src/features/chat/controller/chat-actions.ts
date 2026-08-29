/**
 * The controller's user-action pipeline — optimistic send/retry and the
 * worktree-offer actions — as free functions over the narrow `ChatActionHost`
 * the controller exposes to them. Split from `acp-chat-controller.ts` so the
 * controller keeps identity/lifecycle/dispatch and this module keeps the
 * imperative flows; the controller's public methods delegate here unchanged.
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { PromptSendMeta } from '@qlan-ro/mainframe-types';
import { uploadAttachments } from '../../../lib/api/attachments';
import {
  acceptWorktreeOffer as postAcceptWorktreeOffer,
  dismissWorktreeOffer as postDismissWorktreeOffer,
} from '../../../lib/api/git';
import { mfToast } from '@/lib/toast';
import { matchCommandInvocation } from '../commands/command-registry';
import { buildPendingMessage, parseSendInput } from './chat-reconcile';
import type { ChatStateEvent, ChatThreadState } from './chat-thread-state';

export interface ChatActionHost {
  getPort(): number;
  /** The daemon chat id at call time (it flips on `setRemoteId`). */
  getDaemonId(): string;
  getState(): ChatThreadState;
  dispatch(event: ChatStateEvent): void;
  /** The controller's deduped load — resolves instantly once seeded. */
  load(): Promise<void>;
  sendPrompt(text: string, meta: PromptSendMeta): Promise<{ queued: boolean }>;
}

function refuseIfDirectoryMissing(host: ChatActionHost): boolean {
  const chat = host.getState().chatConfig;
  if (chat?.directoryMissing !== true) return false;
  mfToast.error('Can’t send — the working directory is missing', {
    description: chat.missingDirectoryPath ?? 'The directory this session runs in no longer exists.',
  });
  return true;
}

export async function sendChatMessage(host: ChatActionHost, message: AppendMessage): Promise<void> {
  if (refuseIfDirectoryMissing(host)) return;

  const input = parseSendInput(message);
  if (!input) return;
  const { text, uploadItems } = input;

  const pending = buildPendingMessage(host.getDaemonId(), text);
  host.dispatch({ type: 'local.message.queued', pending });
  host.dispatch({ type: 'run.started' });

  let attachmentIds: string[] | undefined;
  try {
    // The prompt needs the facade client, which needs the config seed —
    // load() is deduped, so repeat sends resolve instantly.
    await host.load();
    attachmentIds =
      uploadItems.length > 0 ? await uploadAttachments(host.getPort(), host.getDaemonId(), uploadItems) : undefined;
    // A draft that is exactly `/<command>` is an invocation, not prose: the
    // daemon resolves the command by name and — for a Mainframe one —
    // substitutes its prompt template for `content`. Without this meta the
    // same text takes the plain-text path and the model receives the
    // literal "/launch-config" string.
    const command = matchCommandInvocation(text);
    await host.sendPrompt(text, {
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...(command ? { command: { ...command } } : {}),
    });
  } catch (error) {
    const stage = uploadItems.length > 0 && attachmentIds === undefined ? 'upload' : 'send';
    host.dispatch({ type: 'local.message.failed', clientId: pending.clientId, error, stage });
    throw error;
  }
}

/**
 * Re-send a failed optimistic user message (the "Failed to send" indicator).
 * Text-only: attachments are not re-uploaded — the common failure is the live
 * send, and re-deriving the original upload items isn't tracked on the pending.
 */
export async function retryChatMessage(host: ChatActionHost, clientId: string): Promise<void> {
  const pending = host.getState().pendingUserMessages[clientId];
  if (!pending) return;
  if (refuseIfDirectoryMissing(host)) return;

  host.dispatch({ type: 'local.message.retrying', clientId });
  host.dispatch({ type: 'run.started' });

  try {
    await host.load();
    await host.sendPrompt(pending.text, {});
  } catch (error) {
    host.dispatch({ type: 'local.message.failed', clientId, error, stage: 'send' });
    throw error;
  }
}

export function markAttachmentsRestoredForFailure(host: ChatActionHost, error: unknown): void {
  const failed = Object.values(host.getState().pendingUserMessages)
    .filter((pending) => pending.status === 'failed' && pending.error === error)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (failed) host.dispatch({ type: 'local.message.attachments_restored', clientId: failed.clientId });
}

/**
 * Accept a worktree-switch offer. The offer is left pending: only the daemon's
 * `worktree.offer.resolved` removes it, so a rebind that fails server-side
 * still leaves the user something to retry.
 */
export async function acceptWorktreeOffer(host: ChatActionHost, worktreePath: string): Promise<void> {
  host.dispatch({ type: 'worktree.switch.started', worktreePath });
  try {
    await postAcceptWorktreeOffer(host.getPort(), host.getDaemonId(), worktreePath);
  } catch (error) {
    host.dispatch({ type: 'worktree.switch.failed' });
    mfToast.error('Could not switch worktree', {
      description: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function dismissWorktreeOffer(host: ChatActionHost, worktreePath: string): Promise<void> {
  try {
    await postDismissWorktreeOffer(host.getPort(), host.getDaemonId(), worktreePath);
  } catch (error) {
    mfToast.error('Could not dismiss worktree offer', {
      description: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
