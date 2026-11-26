/** Shared steps: wait for a settled page, release follow, and approach a target from a direction. */
import { frames, gapOf, sleep, viewport } from '../probe';
import { wheel } from '../input';

export async function ready(settleMs = 1500) {
  for (let i = 0; i < 200 && !document.querySelector('[data-rig-viewport] [data-message-id]'); i++) await sleep(25);
  await document.fonts.ready;
  await sleep(settleMs);
  await frames(2);
}

/** Offset of an element from the top of the scrolled content, or null when it isn't mounted. */
export function contentOffset(selector: string) {
  const el = viewport();
  const node = el.querySelector(selector);
  return node ? node.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : null;
}

async function wheelBy(total: number, step = 200) {
  const steps = Math.max(1, Math.round(Math.abs(total) / step));
  for (let i = 0; i < steps; i++) {
    await wheel(total / steps);
    await frames(2);
  }
  await sleep(250);
}

/** Wheel up until `selector` is mounted and no longer more than `above` px over the viewport top. */
async function wheelUntilNear(selector: string, above: number) {
  const el = viewport();
  for (let i = 0; i < 400; i++) {
    const offset = contentOffset(selector);
    if (offset !== null && offset > el.scrollTop - above) return true;
    if (el.scrollTop <= 0) return false;
    await wheel(-300);
    await frames(2);
  }
  return false;
}

/**
 * Brings `selector` to `above` px over the viewport top (inside a virtualizer's
 * render distance), arriving by scrolling up (`dir = 'up'`) or down (`dir = 'down'`):
 * it overshoots the other way by 400 px first. Returns where the target ended up.
 */
export async function approach(selector: string, above: number, dir: 'up' | 'down') {
  const el = viewport();
  await wheel(-60);
  await frames(2);
  if (!(await wheelUntilNear(selector, above))) throw new Error(`could not place ${selector}`);
  const down = contentOffset(selector)! + above - el.scrollTop;
  if (dir === 'down') {
    await wheelBy(-400);
    await wheelBy(down + 400);
  } else {
    await wheelBy(down + 400);
    await wheelBy(-400);
  }
  await sleep(400);
  await frames(2);
  const offset = contentOffset(selector);
  return { above: offset === null ? null : Math.round(el.scrollTop - offset) };
}

/** Leaves the bottom with a wheel event (so every owner releases), then parks at `scrollTop`. */
export async function park(scrollTop: number) {
  const el = viewport();
  await wheel(-60);
  await frames(1);
  el.scrollTop = scrollTop;
  await sleep(400);
  await frames(2);
  return { scrollTop: el.scrollTop, gap: gapOf(el) };
}
