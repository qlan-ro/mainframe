/**
 * Opens a turn on one of its steps. The step's row may not exist yet: its turn
 * is folded, or its message is outside the virtualized window; so the transcript
 * is asked for the message and the row is awaited.
 */
import { useCallback } from 'react';
import { ACTIVITY_JUMP_EVENT } from '@/features/session-panel/activity-source';
import { useTurnActions } from './turn-context';
import { useTranscriptScope } from './transcript-scope';

const FLASH_MS = 2200;
/** Frames a folded turn and a virtualized row get to appear. */
const REVEAL_FRAMES = 30;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function findStep(root: ParentNode, toolCallId: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('[data-activity-id]')].find((element) =>
    element.dataset.activityId?.split(' ').includes(toolCallId),
  );
}

async function awaitStep(root: ParentNode, toolCallId: string): Promise<HTMLElement | undefined> {
  for (let frame = 0; frame < REVEAL_FRAMES; frame++) {
    const row = findStep(root, toolCallId);
    if (row) return row;
    await nextFrame();
  }
  return undefined;
}

function transcriptOf(chatId: string | undefined): ParentNode {
  const own = [...document.querySelectorAll<HTMLElement>('[data-mf-chat-thread]')].find(
    (element) => element.dataset.mfChatId === chatId,
  );
  return own ?? document;
}

function flash(row: HTMLElement): void {
  delete row.dataset.activityFlash;
  void row.offsetWidth; // restarts the animation on a second press
  row.dataset.activityFlash = '';
  setTimeout(() => delete row.dataset.activityFlash, FLASH_MS);
}

export function useRevealStep(turnKey: string) {
  const { reveal, model } = useTurnActions();
  const { chatId } = useTranscriptScope();
  return useCallback(
    async (toolCallId: string, { open }: { open: boolean }) => {
      reveal(turnKey);
      const slice = [...model().slices.values()].find(({ work }) =>
        work.some(({ part }) => part.type === 'tool-call' && part.toolCallId === toolCallId),
      );
      if (chatId && slice)
        window.dispatchEvent(
          new CustomEvent(ACTIVITY_JUMP_EVENT, {
            detail: { chatId, source: { messageId: slice.messageId, toolCallId } },
          }),
        );
      const row = await awaitStep(transcriptOf(chatId), toolCallId);
      if (!row) return;
      const trigger = row.querySelector<HTMLElement>('[aria-expanded]');
      if (open && trigger?.getAttribute('aria-expanded') === 'false') trigger.click();
      await nextFrame();
      row.scrollIntoView({ block: 'center' });
      flash(row);
      trigger?.focus({ preventScroll: true });
    },
    [reveal, turnKey, chatId, model],
  );
}
