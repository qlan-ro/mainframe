import type { ActivitySource } from './activity-model';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { messageElement, waitForMessage } from '@/features/chat/find/daemon-highlights';

export const ACTIVITY_JUMP_EVENT = 'mainframe:activity-jump';

export async function jumpToActivitySource(chatId: string, source: ActivitySource): Promise<boolean> {
  if (!messageElement(chatId, source.messageId)) {
    const controller = chatControllerRegistry.get(chatId);
    const loaded = controller?.getState().messages.some((message) => message.id === source.messageId);
    if (controller && !loaded && !(await controller.loadEarlier(source.messageId))) return false;
  }
  window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId, source } }));
  const message = await waitForMessage(chatId, source.messageId);
  if (!message) return false;
  window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId, source } }));
  requestAnimationFrame(() => {
    message.scrollIntoView({ block: 'center', behavior: 'smooth' });
    message.focus({ preventScroll: true });
  });
  return true;
}
