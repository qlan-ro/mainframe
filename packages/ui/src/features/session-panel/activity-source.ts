import type { ActivitySource } from './activity-model';

export const ACTIVITY_JUMP_EVENT = 'mainframe:activity-jump';

export function jumpToActivitySource(chatId: string, source: ActivitySource): void {
  window.dispatchEvent(new CustomEvent(ACTIVITY_JUMP_EVENT, { detail: { chatId, source } }));
  const findMessage = () => {
    const viewport = [...document.querySelectorAll<HTMLElement>('[data-mf-chat-thread]')].find(
      (node) => node.dataset.mfChatId === chatId,
    );
    return [...(viewport?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find(
      (node) => node.dataset.messageId === source.messageId,
    );
  };
  const scroll = (message: HTMLElement) => {
    message.scrollIntoView({ block: 'center', behavior: 'smooth' });
    message.focus({ preventScroll: true });
  };
  const mounted = findMessage();
  if (mounted) {
    requestAnimationFrame(() => scroll(mounted));
    return;
  }
  const observer = new MutationObserver(() => {
    const message = findMessage();
    if (!message) return;
    observer.disconnect();
    clearTimeout(timeout);
    requestAnimationFrame(() => scroll(message));
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timeout = window.setTimeout(() => observer.disconnect(), 10_000);
}
