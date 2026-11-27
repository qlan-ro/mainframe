/**
 * The loaded window stays bounded (#462). On the `app` variant, the reader scrolls up many pages
 * (each lands the way the app's gesture rule requests it) and then back down to the bottom, twice.
 * The app cuts the window back to its newest page when they return (`use-trim-at-tail.ts`), so the
 * loaded messages and the DOM nodes of the transcript come back to what the first open had.
 * Reported only: nodes in the transcript, rows mounted and messages held, at open, at the peak, at
 * the top and after the return. WebKit has no `performance.memory`, so the DOM is the measure.
 */
import { frames, gapOf, sleep, viewport } from '../probe';
import { wheel } from '../input';
import { store } from '../store';
import { ready } from './setup';
import { installOlderPageLoader } from './older-page';

function count(el: HTMLElement) {
  return {
    nodes: el.querySelectorAll('*').length,
    rows: el.querySelectorAll('[data-message-id]').length,
    messages: store.get().messages.length,
  };
}

async function waitFor(done: () => boolean, ms: number) {
  const until = performance.now() + ms;
  while (!done() && performance.now() < until) await sleep(20);
}

export async function bound(options: { pages?: number; cycles?: number }) {
  const pages = options.pages ?? 10;
  await ready();
  const el = viewport();
  const open = count(el);
  const cycles: Array<{
    pages: number;
    peak: ReturnType<typeof count>;
    top: ReturnType<typeof count>;
    after: ReturnType<typeof count>;
    back: boolean;
  }> = [];
  for (let cycle = 0; cycle < (options.cycles ?? 2); cycle++) {
    const loader = installOlderPageLoader(el);
    let peak = count(el);
    for (let i = 0; i < 400 && loader.loads < pages && store.hasMore(); i++) {
      // Far from the top the reader has to scroll a long way: jump there, then flick up so the gesture arms a load.
      el.scrollTop = 0;
      await frames(1);
      const landed = loader.landedAt.length;
      await wheel(-60);
      await waitFor(() => loader.landedAt.length > landed, 3000);
      await frames(3);
      const now = count(el);
      if (now.nodes > peak.nodes) peak = now;
    }
    loader.stop();
    await sleep(500);
    await frames(2);
    const top = count(el);
    // Back down: near the bottom at once, then the reader's own wheel carries them to it.
    el.scrollTop = el.scrollHeight - el.clientHeight - 3000;
    await frames(2);
    for (let i = 0; i < 100 && gapOf(el) > 1; i++) {
      await wheel(600);
      await frames(2);
    }
    await sleep(800);
    await frames(3);
    cycles.push({ pages: loader.loads, peak, top, after: count(el), back: gapOf(el) <= 1 });
  }
  return { open, cycles };
}
