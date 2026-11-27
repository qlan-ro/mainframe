/**
 * P7 by hand (`?manual=1`): flick up with a trackpad; a page lands, as in the app, when an upward
 * gesture finds the reader within one viewport of the top (`window=2` opens on a short window, as after a compaction), and the readout shows, per load,
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
  // A short window may leave the viewport centre empty; fall back to the newest visible row.
  const centre = document.elementFromPoint(box.left + el.clientWidth / 2, box.top + el.clientHeight / 2);
  const rows = el.querySelectorAll('[data-message-id]');
  recorder.anchor(
    centre && el.contains(centre) && centre.closest('[data-message-id]') ? centre : rows[rows.length - 1]!,
  );
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
  // The app's rule (EarlierMessages `useOlderPageGesture`): an upward gesture arms a load, which
  // fires once the reader is within one viewport of the top. A short window that doesn't fill the
  // viewport has no scroll events, so the gesture itself must be able to fire the load.
  let armed = false;
  const check = () => {
    if (!armed || busy || !store.hasMore() || el.scrollTop > el.clientHeight) return;
    armed = false;
    busy = true;
    void measureLoad(recorder, el).then((step) => {
      steps.push(Math.round(step * 10) / 10);
      show(`loads ${steps.length} · steps ${steps.join(', ')} px · max ${Math.max(...steps)}`);
      busy = false;
    });
  };
  const gesture = (event: Event) => {
    if (event instanceof WheelEvent && event.deltaY >= 0) return;
    if (event instanceof KeyboardEvent && !['ArrowUp', 'PageUp', 'Home'].includes(event.key)) return;
    armed = true;
    check();
  };
  for (const name of ['wheel', 'touchmove', 'keydown']) el.addEventListener(name, gesture, { passive: true });
  el.addEventListener('scroll', check, { passive: true });
}
