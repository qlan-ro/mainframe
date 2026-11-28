/**
 * Which comes first in this engine for the reader's own scroll: the `wheel` event or the `scroll` event it
 * causes? The owner's rules depend on it. Sends `count` native wheel events (`dy` each) from the tail while a
 * reply streams, and records the order and timing of the first events of each gesture.
 */
import { wheel } from '../input';
import { sleep, viewport } from '../probe';
import { startStream } from './stream';
import { ready } from './setup';

export async function inputOrder({
  dy = -120,
  gestures = 8,
  stream = true,
}: {
  dy?: number;
  gestures?: number;
  stream?: boolean;
}) {
  await ready(1500);
  const el = viewport();
  const stop = stream ? startStream({ commits: [] }) : null;
  const results: { first: string; lagMs: number; scrollsBeforeWheel: number }[] = [];
  for (let g = 0; g < gestures; g++) {
    await sleep(600);
    // Back to the tail and following.
    (await import('../controls')).controls.jump();
    await sleep(300);
    const events: { type: string; t: number; top: number }[] = [];
    const onScroll = () => events.push({ type: 'scroll', t: performance.now(), top: el.scrollTop });
    const onWheel = () => events.push({ type: 'wheel', t: performance.now(), top: el.scrollTop });
    el.addEventListener('scroll', onScroll, { passive: true, capture: true });
    el.addEventListener('wheel', onWheel, { passive: true, capture: true });
    await wheel(dy);
    await sleep(250);
    el.removeEventListener('scroll', onScroll, { capture: true });
    el.removeEventListener('wheel', onWheel, { capture: true });
    const firstWheel = events.findIndex((e) => e.type === 'wheel');
    const firstScroll = events.findIndex((e) => e.type === 'scroll' && e.top < (events[0]?.top ?? Infinity) + 1);
    results.push({
      first: events[0]?.type ?? 'none',
      lagMs: firstWheel >= 0 && firstScroll >= 0 ? Math.round(events[firstScroll]!.t - events[firstWheel]!.t) : NaN,
      scrollsBeforeWheel:
        firstWheel < 0 ? events.length : events.slice(0, firstWheel).filter((e) => e.type === 'scroll').length,
    });
  }
  await stop?.();
  return results;
}
