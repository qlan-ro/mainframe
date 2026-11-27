/**
 * P7 by hand (`?manual=1`): flick up with a trackpad; a page lands whenever the
 * reader comes within 1.5 viewports of the top, and the readout shows, per load,
 * the largest single-frame step of what the reader was looking at. Pass: the
 * steps stay at 2 px or less over five loads, three times, and nothing visibly jumps.
 */
import { Recorder, frame, viewport } from '../probe';
import { params } from '../params';
import { store } from '../store';
import { ready } from './setup';

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

async function measureLoad(recorder: Recorder, el: HTMLElement) {
  const box = el.getBoundingClientRect();
  recorder.anchor(document.elementFromPoint(box.left + el.clientWidth / 2, box.top + el.clientHeight / 2)!);
  // The page arrives after a daemon-like delay; the reader keeps scrolling meanwhile.
  if (params.pageDelay > 0) {
    const wait = params.pageDelay * (0.7 + Math.random() * 0.6);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const from = recorder.samples.length;
  store.prependPage();
  for (let i = 0; i < 14; i++) await frame();
  const window = recorder.samples.slice(from);
  const steps = window.slice(1).map((s, i) => Math.abs((s.top ?? NaN) - (window[i]!.top ?? NaN)));
  return Math.max(0, ...steps.filter(Number.isFinite));
}

export async function startManual() {
  await ready();
  const el = viewport();
  const recorder = new Recorder(el);
  recorder.anchor(el.querySelector('[data-message-id]')!);
  recorder.start();
  const steps: number[] = [];
  let busy = false;
  show(`flick up: a page loads near the top (${params.pageDelay} ms ±30%)`);
  el.addEventListener(
    'scroll',
    () => {
      if (busy || !store.hasMore() || el.scrollTop > el.clientHeight * 1.5) return;
      busy = true;
      void measureLoad(recorder, el).then((step) => {
        steps.push(Math.round(step * 10) / 10);
        show(`loads ${steps.length} · steps ${steps.join(', ')} px · max ${Math.max(...steps)}`);
        busy = false;
      });
    },
    { passive: true },
  );
}
