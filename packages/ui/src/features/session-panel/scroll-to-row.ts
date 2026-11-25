/**
 * scroll-to-row — scrolls the transcript to a row that may be taller than it,
 * and whose neighbours are still being measured on the way.
 */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Frames the offset holds still for before a scroll counts as over: WebKit has no reliable `scrollend`. */
const STILL_FRAMES = 8;
const SCROLL_LIMIT_MS = 2000;

/** Resolves when the scroll comes to rest; false when the reader took over with input of their own. */
async function scrollAtRest(viewport: HTMLElement): Promise<boolean> {
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  const inputs = ['wheel', 'touchmove', 'keydown'];
  for (const input of inputs) viewport.addEventListener(input, interrupt, { passive: true });
  const deadline = performance.now() + SCROLL_LIMIT_MS;
  let top = viewport.scrollTop;
  for (let still = 0; still < STILL_FRAMES && !interrupted && performance.now() < deadline;) {
    await nextFrame();
    still = viewport.scrollTop === top ? still + 1 : 0;
    top = viewport.scrollTop;
  }
  for (const input of inputs) viewport.removeEventListener(input, interrupt);
  return !interrupted;
}

/** Where a row goes: centred, or from its top when centring would push an end of it out of sight. */
function placement(viewport: HTMLElement, row: HTMLElement) {
  const footer = viewport.querySelector<HTMLElement>('[data-chat-footer]')?.offsetHeight ?? 0;
  const usable = viewport.clientHeight - footer;
  const box = row.getBoundingClientRect();
  const top = box.top - viewport.getBoundingClientRect().top;
  const block = box.height / 2 > usable - viewport.clientHeight / 2 ? 'start' : 'center';
  const inPlace = block === 'start' ? Math.abs(top) <= 2 : top >= 0 && top + box.height <= usable;
  return { block, inPlace } as const;
}

/** Rows around the target are measured as they mount, which can move it after the scroll aimed at it. */
const CORRECTIONS = 3;

/** `row` is looked up again after each step: the list may remount it. */
export async function scrollToRow(viewport: HTMLElement, row: () => HTMLElement | undefined): Promise<void> {
  const first = row();
  if (!first) return;
  first.scrollIntoView({
    block: placement(viewport, first).block,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
  for (let correction = 0; correction < CORRECTIONS; correction++) {
    if (!(await scrollAtRest(viewport))) return;
    const current = row();
    if (!current) return;
    const { block, inPlace } = placement(viewport, current);
    if (inPlace) return;
    current.scrollIntoView({ block, behavior: 'auto' });
  }
}
