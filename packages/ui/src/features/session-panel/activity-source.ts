import { findToolCall, type ActivitySource } from './activity-model';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { messageElement, waitForMessage } from '@/features/chat/find/daemon-highlights';
import { scrollToRow } from './scroll-to-row';

/** Asks the transcript to mount a message; its `detail` is an `ActivityJump`. */
export const ACTIVITY_JUMP_EVENT = 'mainframe:activity-jump';

export interface ActivityJump {
  chatId: string;
  source: { messageId: string; toolCallId?: string };
  /** The transcript leaves its scroll position alone until this settles. */
  settled?: Promise<void>;
}

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

type LocatedSource = ActivityJump['source'];

/** The message a source is in, loading the history up to its call. Undefined when the history doesn't hold it. */
async function locateSource(chatId: string, { messageId, toolCallId }: ActivitySource) {
  if (messageId && messageElement(chatId, messageId)) return { messageId, toolCallId };
  const controller = chatControllerRegistry.get(chatId);
  const loaded = (): LocatedSource | undefined => {
    const messages = controller?.getState().messages ?? [];
    if (messageId && messages.some((message) => message.id === messageId)) return { messageId, toolCallId };
    return toolCallId ? findToolCall(messages, toolCallId) : undefined;
  };
  const target = toolCallId ?? messageId;
  if (!controller || !target) return messageId ? { messageId, toolCallId } : undefined;
  return loaded() ?? ((await controller.loadEarlier(target)) ? loaded() : undefined);
}

function focusElement(element: HTMLElement): void {
  if (element.tabIndex < 0 && !element.hasAttribute('tabindex')) element.tabIndex = -1;
  element.focus({ preventScroll: true });
}

/** Only the last jump asked for still scrolls and takes focus. */
let latestJump = 0;

async function showSource(
  chatId: string,
  source: LocatedSource,
  isLatest: () => boolean,
  settled: Promise<void>,
): Promise<boolean> {
  const mount = () =>
    window.dispatchEvent(new CustomEvent<ActivityJump>(ACTIVITY_JUMP_EVENT, { detail: { chatId, source, settled } }));
  mount();
  const message = await waitForMessage(chatId, source.messageId);
  if (!message) return false;
  if (!isLatest()) return true;
  mount();
  const { toolCallId } = source;
  const revealed = toolCallId ? await revealRow(chatId, toolCallId) : undefined;
  if (!isLatest()) return true;
  const target = () =>
    (toolCallId ? findAnchor(chatId, 'activityId', toolCallId) : undefined) ?? messageElement(chatId, source.messageId);
  const trigger = revealed && openDisclosure(revealed);
  await nextFrame();
  const landed = target() ?? message;
  highlight(landed);
  focusElement(trigger ?? landed);
  const viewport = transcript(chatId);
  if (viewport) await scrollToRow(viewport, target);
  // A row remounted on the way takes its focus with it.
  if (isLatest() && document.activeElement === document.body) {
    const row = target();
    if (row) focusElement(row.querySelector<HTMLElement>('[aria-expanded]') ?? row);
  }
  return true;
}

/** Scrolls the transcript to an activity's row, opened and highlighted. False when the history doesn't hold it. */
export async function jumpToActivitySource(chatId: string, source: ActivitySource): Promise<boolean> {
  const jump = ++latestJump;
  const located = await locateSource(chatId, source);
  if (!located) return false;
  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  try {
    return await showSource(chatId, located, () => jump === latestJump, settled);
  } finally {
    settle();
  }
}

/** Moves focus to the request above this chat's composer. False when none is showing. */
export function focusPendingRequest(chatId: string): boolean {
  const gate = transcript(chatId)?.querySelector<HTMLElement>('[data-chat-gate]');
  const control = gate?.querySelector<HTMLElement>('button, input, textarea, [tabindex="0"]');
  control?.focus();
  return control != null;
}
