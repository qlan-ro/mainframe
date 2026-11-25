/**
 * The controller's user-action pipeline — optimistic send/retry and the
 * worktree-offer actions — as free functions over the narrow `ChatActionHost`
 * the controller exposes to them. Split from `acp-chat-controller.ts` so the
 * controller keeps identity/lifecycle/dispatch and this module keeps the
 * imperative flows; the controller's public methods delegate here unchanged.
 */
import type { AppendMessage } from '@assistant-ui/react';
import type { PromptRemedy, PromptSendMeta } from '@qlan-ro/mainframe-types';
import { cancelQueuedMessage, unarchiveNativeSession } from '../../../lib/api/chats';
import { uploadAttachments } from '../../../lib/api/attachments';
import {
  acceptWorktreeOffer as postAcceptWorktreeOffer,
  dismissWorktreeOffer as postDismissWorktreeOffer,
} from '../../../lib/api/git';
import { mfToast } from '@/lib/toast';
import { matchCommandInvocation } from '../commands/command-registry';
import { buildPendingMessage, parseSendInput } from './chat-reconcile';
import { sendRefusal } from './describe-send-error';
import { previewsById } from './local-attachments';
import { wantsSteer } from './steer';
import { forgetSentCaptures, restoreSentCapture } from '../composer/draft-content/draft-content-store';
import { useHeldQueue } from '../composer/queue/held-queue-store';
import type { ChatStateEvent, ChatThreadState, PendingUserMessage } from './chat-thread-state';

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
  const fromComposer = typeof message.metadata?.custom?.mainframeSubmittedDraft === 'string';
  if (refuseIfDirectoryMissing(host)) {
    if (fromComposer) throw new Error('The working directory is missing');
    return;
  }

  const input = parseSendInput(message);
  if (!input) {
    if (fromComposer) throw new Error('The message has no sendable text or attachments');
    return;
  }
  const { text, uploadItems } = input;
  const sentIds = (message.attachments ?? []).map((attachment) => attachment.id);

  // A draft that is exactly `/<command>` is an invocation, not prose: the
  // daemon resolves the command by name and — for a Mainframe one —
  // substitutes its prompt template for `content`. Without this meta the
  // same text takes the plain-text path and the model receives the
  // literal "/launch-config" string. Computed before the pending is built
  // so a later retry can re-carry it (T34) — attachmentIds are NOT part of
  // it: a retry is text-only.
  const command = matchCommandInvocation(text);
  const sendMeta: PromptSendMeta = command ? { command: { ...command } } : {};
  const running = host.getState().runState.type === 'running';
  if (running && wantsSteer(message) && !command && uploadItems.length === 0) sendMeta.steer = true;
  const pending: PendingUserMessage = {
    ...buildPendingMessage(host.getDaemonId(), text, sendMeta, uploadItems),
    ...(running && !command && !sendMeta.steer ? { queueing: true } : {}),
  };
  host.dispatch({ type: 'local.message.queued', pending });
  host.dispatch({ type: 'run.started' });

  let attachmentIds: string[] | undefined;
  try {
    // The prompt needs the facade client, which needs the config seed —
    // load() is deduped, so repeat sends resolve instantly.
    await host.load();
    attachmentIds =
      uploadItems.length > 0 ? await uploadAttachments(host.getPort(), host.getDaemonId(), uploadItems) : undefined;
    const { queued } = await host.sendPrompt(text, {
      ...(attachmentIds && attachmentIds.length > 0 ? { attachmentIds } : {}),
      ...sendMeta,
    });
    // A queued acceptance renders as a queued turn from the queue snapshot
    // (D1, project-messages.ts) — reconcile the optimistic pending right
    // away, or the same send would render twice, side by side. The queue ref
    // carries attachment ids only, so its previews move to an id-keyed map.
    if (queued) {
      if (attachmentIds) {
        host.dispatch({ type: 'local.attachments.queued', previews: previewsById(attachmentIds, uploadItems) });
      }
      host.dispatch({ type: 'local.message.reconciled', clientId: pending.clientId });
    }
    forgetSentCaptures(sentIds);
  } catch (error) {
    const stage = uploadItems.length > 0 && attachmentIds === undefined ? 'upload' : 'send';
    host.dispatch({ type: 'local.message.failed', clientId: pending.clientId, error, stage, pending });
    // Preview captures go back to the draft with their notes; with nothing else attached that is all of it.
    const restored = sentIds.filter(restoreSentCapture);
    if (restored.length > 0 && restored.length === sentIds.length) {
      host.dispatch({ type: 'local.message.attachments_restored', clientId: pending.clientId });
    }
    throw error;
  }
}

/**
 * Re-send a failed optimistic user message (the "Failed to send" indicator).
 * Text-only: attachments are not re-uploaded — the common failure is the live
 * send, and re-deriving the original upload items isn't tracked on the pending.
 * `remedy` (the failed send's own) runs first: `unarchive_native_session`
 * unarchives the chat's provider session before the resend.
 */
export async function retryChatMessage(host: ChatActionHost, clientId: string, remedy?: PromptRemedy): Promise<void> {
  const pending = host.getState().pendingUserMessages[clientId];
  if (!pending) return;
  if (refuseIfDirectoryMissing(host)) return;

  host.dispatch({ type: 'local.message.retrying', clientId });
  host.dispatch({ type: 'run.started' });

  try {
    if (remedy === 'unarchive_native_session') await unarchiveNativeSession(host.getPort(), host.getDaemonId());
    await host.load();
    await host.sendPrompt(pending.text, pending.sendMeta ?? {});
  } catch (error) {
    host.dispatch({ type: 'local.message.failed', clientId, error, stage: 'send', pending });
    throw error;
  }
}

/** How long Stop waits for the queue to be taken back before interrupting anyway. */
const HOLD_QUEUE_BUDGET_MS = 1000;

/**
 * Take the queue back from the agent before a Stop, so nothing queued starts a
 * new turn behind it (C10), and cancel what "Send now" has not sent yet. Each row is kept the moment its cancel wins; one the
 * agent had already picked up is part of the conversation and is not held.
 */
export async function holdQueuedMessages(host: ChatActionHost): Promise<void> {
  useHeldQueue.getState().releaseUnsent(host.getDaemonId());
  const refs = Object.values(host.getState().interactions.queued).filter((ref) => ref.delivery == null);
  if (refs.length === 0) return;
  const chatId = host.getDaemonId();
  const temporary = host.getState().chatConfig?.temporary === true;
  const cancels = refs.map((ref) =>
    cancelQueuedMessage(host.getPort(), chatId, ref.messageId).then(
      (takenBack) => {
        // The agent already had it: it is in the conversation, not held.
        if (takenBack) useHeldQueue.getState().hold(chatId, ref, { temporary });
      },
      (error: unknown) => console.warn('[chat] queued message could not be held', { error }),
    ),
  );
  await Promise.race([Promise.all(cancels), new Promise((resolve) => setTimeout(resolve, HOLD_QUEUE_BUDGET_MS))]);
}

/**
 * Send a held row, then line the rows behind it up again in their order. They
 * are claimed first, so a second press (or another window) finds nothing to
 * send, and each leaves the queue only once the daemon has it: a quit in between
 * loses none. What does not go out is given back: with the reason when it was
 * refused, or marked when it may have reached the agent. A Stop meanwhile takes
 * back the rows that have not gone out.
 */
export async function sendHeldMessages(host: ChatActionHost, firstId: string): Promise<void> {
  const chatId = host.getDaemonId();
  const held = useHeldQueue.getState();
  const rows = held.claimFrom(chatId, firstId);
  // Another press holds the claims, and gives them back itself.
  if (rows.length === 0) return;
  try {
    // The prompt needs the facade client; failing here, nothing has gone out.
    await host.load();
    for (const { messageId, content, attachmentIds } of rows) {
      // Removed meanwhile, with its chat say, stopped, or no longer this window's: not sent.
      if (!held.startSending(chatId, messageId)) continue;
      try {
        await host.sendPrompt(content, attachmentIds ? { attachmentIds } : {});
      } catch (error) {
        const reason = sendRefusal(error);
        if (reason !== undefined) held.refuse(chatId, messageId, reason);
        throw error;
      }
      held.remove(chatId, messageId);
    }
  } finally {
    held.releaseClaims(chatId);
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
