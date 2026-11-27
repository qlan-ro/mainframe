/**
 * P7 by hand (`?manual=1`): flick up with a trackpad; a page lands, as in the app, when an upward
 * gesture finds the reader within one viewport of the top (`window=2` opens on a short window, as after a compaction), and the readout shows, per load,
 * the largest single-frame step of what the reader was looking at. Pass: the
 * steps stay at 2 px or less over five loads, three times, and nothing visibly jumps.
 */
import { Recorder, frame, viewport } from '../probe';
import { params } from '../params';
import { ready } from './setup';
import { installOlderPageLoader, pickReaderAnchor } from './older-page';

function show(text: string) {
  let hud = document.querySelector<HTMLDivElement>('.rig-manual');
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'rig-hud rig-manual';
    hud.style.top = '30px';
    document.body.append(hud);
  }
  hud.textContent = text;
}

/**
 * The largest single-frame step of the reader's anchor over the load. An anchor that is gone (not
 * mounted) counts as a jump (Infinity, shown as "lost"), never as a missing sample: dropping
 * non-finite samples hid the jumps where the anchor left the viewport or was unmounted.
 */
export function largestStep(tops: (number | null)[]) {
  let max = 0;
  for (let i = 1; i < tops.length; i++) {
    const from = tops[i - 1] ?? null;
    const to = tops[i] ?? null;
    max = Math.max(max, from === null || to === null ? Infinity : Math.abs(to - from));
  }
  return max;
}

const shown = (step: number) => (Number.isFinite(step) ? String(Math.round(step * 10) / 10) : 'lost');

export async function startManual() {
  await ready();
  const el = viewport();
  const recorder = new Recorder(el);
  recorder.anchor(el.querySelector('[data-message-id]')!);
  recorder.start();
  const steps: number[] = [];
  show(`flick up: a page loads near the top (${params.pageDelay} ms ±30%)`);
  installOlderPageLoader(el, {
    onRequest: () => pickReaderAnchor(recorder, el),
    onLanded: () => {
      const from = recorder.samples.length;
      void (async () => {
        for (let i = 0; i < 14; i++) await frame();
        steps.push(largestStep(recorder.samples.slice(from).map((s) => s.top)));
        const worst = Math.max(...steps);
        show(`loads ${steps.length} · steps ${steps.map(shown).join(', ')} px · max ${shown(worst)}`);
      })();
    },
  });
}
