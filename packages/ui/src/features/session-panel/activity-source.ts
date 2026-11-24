import type { ActivitySource } from './activity-model';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { messageElement, waitForMessage } from '@/features/chat/find/daemon-highlights';

export const ACTIVITY_JUMP_EVENT = 'mainframe:activity-jump';

/**
 * The transcript's side of the jump. A row, marker or card for a tool call
 * carries `data-activity-id` with the tool call's id; a row standing for
 * several calls lists them all, space-separated. A collapsed group that only
 * renders its rows once opened lists their ids in `data-activity-group`.
 */
type Anchor = 'activityId' | 'activityGroup';

const FLASH_MS = 2200;
/** Frames a folded turn, a group and a lazily rendered row get to appear. */
const REVEAL_FRAMES = 30;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function transcript(chatId: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-mf-chat-thread]')].find(
    (el) => el.dataset.mfChatId === chatId,
  );
}

function findAnchor(chatId: string, anchor: Anchor, toolCallId: string): HTMLElement | undefined {
  const attribute = anchor === 'activityId' ? 'data-activity-id' : 'data-activity-group';
  return [...(transcript(chatId)?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])].find((el) =>
    el.dataset[anchor]?.split(' ').includes(toolCallId),
  );
}

/** Opens an anchor's own disclosure, the first one in it. */
function openDisclosure(anchor: HTMLElement): HTMLElement | null {
  const trigger = anchor.querySelector<HTMLElement>('[aria-expanded]');
  if (trigger?.getAttribute('aria-expanded') === 'false') trigger.click();
  return trigger;
}

async function revealRow(chatId: string, toolCallId: string): Promise<HTMLElement | undefined> {
  for (let frame = 0; frame < REVEAL_FRAMES; frame++) {
    const row = findAnchor(chatId, 'activityId', toolCallId);
    if (row) return row;
    const group = findAnchor(chatId, 'activityGroup', toolCallId);
    if (group) openDisclosure(group);
    await nextFrame();
  }
  return undefined;
}

function highlight(element: HTMLElement): void {
  delete element.dataset.activityFlash;
  void element.offsetWidth; // restarts the animation on a second click
  element.dataset.activityFlash = '';
  setTimeout(() => delete element.dataset.activityFlash, FLASH_MS);
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Scrolls the transcript to an activity's row, opened and highlighted. False when its message isn't in the history. */
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
  const row = source.toolCallId ? await revealRow(chatId, source.toolCallId) : undefined;
  const target = row ?? message;
  const trigger = row && openDisclosure(row);
  await nextFrame();
  target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  highlight(target);
  (trigger ?? message).focus({ preventScroll: true });
  return true;
}

/** Moves focus to the request above this chat's composer. False when none is showing. */
export function focusPendingRequest(chatId: string): boolean {
  const gate = transcript(chatId)?.querySelector<HTMLElement>('[data-testid="chat-thread-gate-slot"]');
  const control = gate?.querySelector<HTMLElement>('button, input, textarea, [tabindex="0"]');
  control?.focus();
  return control != null;
}
