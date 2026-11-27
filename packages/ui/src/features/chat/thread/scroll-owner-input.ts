/**
 * The reader's own scroll input, as the scroll owner reads it. Up releases follow; down
 * (or the End key) asks for it back. The scrollbar is hidden in the transcript, so there is no
 * drag to read. Typing in a field never counts.
 */
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const DOWN_KEYS = new Set(['ArrowDown', 'PageDown', ' ']);
const FIELDS = 'input, textarea, [contenteditable="true"]';
/** A click on a disclosure (a row the reader opens) is the reader taking over: it reads what opens. */
const DISCLOSURE = '[aria-expanded]';

export interface ScrollInputHandlers {
  /** The reader moved up, or opened a row: stop following. */
  release: () => void;
  /** The reader moved down: following may resume once the bottom is reached. */
  down: () => void;
  /** The End key. */
  end: () => void;
}

export function listenForScrollInput(viewport: HTMLElement, { release, down, end }: ScrollInputHandlers) {
  const wheel = (event: WheelEvent) => (event.deltaY < 0 ? release() : event.deltaY > 0 && down());
  const key = (event: KeyboardEvent) => {
    if ((event.target as Element).closest(FIELDS)) return;
    if (event.key === 'End') end();
    else if (UP_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey)) release();
    else if (DOWN_KEYS.has(event.key)) down();
  };
  let lastY: number | null = null;
  const touchStart = (event: TouchEvent) => {
    lastY = event.touches[0]?.clientY ?? null;
  };
  const touchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    // A finger moving up scrolls the content down.
    if (lastY !== null && y < lastY) down();
    else release();
    lastY = y;
  };
  const click = (event: MouseEvent) => {
    if ((event.target as Element).closest(DISCLOSURE)) release();
  };
  viewport.addEventListener('wheel', wheel, { passive: true });
  viewport.addEventListener('touchstart', touchStart, { passive: true });
  viewport.addEventListener('touchmove', touchMove, { passive: true });
  viewport.addEventListener('keydown', key);
  viewport.addEventListener('click', click, true);
  return () => {
    viewport.removeEventListener('wheel', wheel);
    viewport.removeEventListener('touchstart', touchStart);
    viewport.removeEventListener('touchmove', touchMove);
    viewport.removeEventListener('keydown', key);
    viewport.removeEventListener('click', click, true);
  };
}
