/**
 * R-type (#519): the cost of the owner's footer observer while the reader types. A reply streams and the owner
 * follows it; the reader types `keys` characters into the composer, one every `every` ms, through the editing
 * path the engine uses for real typing (`insertText`). With the chip field (`chips=1`) every key changes the
 * footer's DOM, so the observer samples layout on each. Per key: the time from the insert to the end of its task
 * and microtasks (`taskMs`), and to the next frame (`frameMs`). `nofooter=1` is the same page without the observer.
 */
import { percentile, round, sleep } from '../probe';
import { startLiveTurn } from '../live-turn';
import { controls } from '../controls';
import { ready } from './setup';

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now())));
const afterTask = () => new Promise<number>((resolve) => setTimeout(() => resolve(performance.now()), 0));

export async function typing({ keys = 60, every = 80, lead = 2 }: { keys?: number; every?: number; lead?: number }) {
  await ready(1500);
  const field =
    document.querySelector<HTMLElement>('[data-testid="chat-composer-frame"] [contenteditable="true"]') ??
    document.querySelector<HTMLElement>('[contenteditable="true"]') ??
    document.querySelector<HTMLTextAreaElement>('[data-rig-input]');
  if (!field) throw new Error('no composer field');
  const turn = startLiveTurn({ steps: 200, tag: 'type' });
  await sleep(lead * 1000);
  field.focus();
  const task: number[] = [];
  const frame: number[] = [];
  for (let i = 0; i < keys; i++) {
    const t0 = performance.now();
    document.execCommand('insertText', false, i % 12 === 11 ? ' ' : 'a');
    const [t1, t2] = await Promise.all([afterTask(), nextFrame()]);
    task.push(t1 - t0);
    frame.push(t2 - t0);
    await sleep(every);
  }
  turn.pause();
  const text = field instanceof HTMLTextAreaElement ? field.value : (field.textContent ?? '');
  return {
    field: field instanceof HTMLTextAreaElement ? 'textarea' : 'chips',
    typed: text.length,
    following: controls.isFollowing?.() ?? null,
    taskP50: round(percentile(task, 50)),
    taskP95: round(percentile(task, 95)),
    taskMax: round(Math.max(...task)),
    frameP50: round(percentile(frame, 50)),
    frameP95: round(percentile(frame, 95)),
  };
}
