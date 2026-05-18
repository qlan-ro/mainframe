import { daemonClient } from './client.js';
import { uploadAttachments } from './api/attachments-api.js';
import { useChatsStore } from '../store/chats.js';
import { getActiveProjectId } from '../hooks/useActiveProjectId.js';
import { getDefaultModelForAdapter } from './adapters.js';
import { formatCaptures, type CaptureLike } from './format-captures.js';

export type { CaptureLike } from './format-captures.js';
import { createLogger } from './logger.js';

const log = createLogger('renderer:captures');

async function uploadAndSend(chatId: string, captures: ReadonlyArray<CaptureLike>): Promise<void> {
  const { markdown, attachments } = formatCaptures(captures);
  if (attachments.length === 0) return;
  const process = useChatsStore.getState().processes.get(chatId);
  if (!process || process.status === 'stopped') {
    daemonClient.resumeChat(chatId);
  }
  const uploaded = await uploadAttachments(chatId, attachments);
  daemonClient.sendMessage(
    chatId,
    markdown,
    uploaded.map((a) => a.id),
  );
}

export async function sendCapturesDirect(captures: ReadonlyArray<CaptureLike>, explicitChatId?: string): Promise<void> {
  if (captures.length === 0) return;

  const chatId = explicitChatId ?? useChatsStore.getState().activeChatId;

  if (chatId) {
    await uploadAndSend(chatId, captures);
    return;
  }

  const projectId = getActiveProjectId();
  if (!projectId) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      log.warn('timed out waiting for chat.created');
      resolve();
    }, 5000);

    const unsub = useChatsStore.subscribe((state, prev) => {
      if (state.chats.length > prev.chats.length) {
        const newChat = state.chats.find((c) => !prev.chats.some((p) => p.id === c.id));
        if (newChat) {
          clearTimeout(timeout);
          unsub();
          void uploadAndSend(newChat.id, captures)
            .catch((err: unknown) => {
              log.warn('uploadAndSend failed', { err });
            })
            .finally(resolve);
        }
      }
    });

    daemonClient.createChat(projectId, 'claude', getDefaultModelForAdapter('claude'));
  });
}

export interface PendingCaptureInput {
  id: string;
  dataUrl: string;
  annotation: string;
}

export function buildCaptureLikes(pending: readonly PendingCaptureInput[]): CaptureLike[] {
  return pending.map((c) => ({
    id: c.id,
    type: 'screenshot' as const,
    imageDataUrl: c.dataUrl,
    ...(c.annotation.trim() ? { annotation: c.annotation.trim() } : {}),
  }));
}

export function submitCapturesDirect(
  pending: readonly PendingCaptureInput[],
  opts: { onSuccess: () => void },
  send: (captures: ReadonlyArray<CaptureLike>) => Promise<void> = sendCapturesDirect,
): void {
  if (pending.length === 0) return;
  void send(buildCaptureLikes(pending))
    .then(opts.onSuccess)
    .catch((err) => console.warn('[sandbox] direct capture send failed', err));
}
