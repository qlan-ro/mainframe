/**
 * The typing reveal for streamed text: shows a growing prefix of `text`, one
 * animation frame at a time, at assistant-ui's pacing (a backlog drains in about
 * 250 ms, and no slower than one character per 5 ms).
 *
 * - Text that arrives already settled shows whole; so does text that settles
 *   before any of it was shown. Text that settles mid-reveal finishes revealing.
 * - Text that stops extending what is shown (a replaced reply), or a new `part`
 *   (another part reusing the element), starts over: empty while running,
 *   whole otherwise.
 * - `paused` holds what is shown, so a selection inside it survives; the reveal
 *   resumes from there.
 * - Under `prefers-reduced-motion: reduce` the text shows whole.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const DRAIN_MS = 250;
const MAX_CHAR_INTERVAL_MS = 5;
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

class Reveal {
  shown: string;
  target = '';
  private frame: number | null = null;
  private last = 0;

  constructor(
    shown: string,
    public part: unknown,
    private readonly commit: (text: string) => void,
  ) {
    this.shown = shown;
  }

  start() {
    if (this.frame !== null) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.step);
  }

  stop() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private step = () => {
    const now = performance.now();
    let budget = now - this.last;
    const remaining = this.target.length - this.shown.length;
    const perChar = Math.min(MAX_CHAR_INTERVAL_MS, DRAIN_MS / remaining);
    let add = 0;
    while (budget >= perChar && add < remaining) {
      add++;
      budget -= perChar;
    }
    this.frame = add < remaining ? requestAnimationFrame(this.step) : null;
    if (add === 0) return;
    this.last = now - budget;
    this.shown = this.target.slice(0, this.shown.length + add);
    this.commit(this.shown);
  };
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const prefersReducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;

/** A reveal starting over: empty while running, whole once settled. */
const restart = (text: string, running: boolean) => (running ? '' : text);

/** Where the reveal stands for `text`, given what was shown before. */
function resync(shown: string, text: string, running: boolean): string {
  if (!text.startsWith(shown)) return restart(text, running);
  if (!running && shown === '') return text;
  return shown;
}

interface SmoothTextOptions {
  /** Holds what is shown. */
  paused?: boolean;
  /** The part's identity: a different one starts the reveal over. */
  part?: unknown;
}

export function useSmoothText(
  text: string,
  running: boolean,
  { paused = false, part }: SmoothTextOptions = {},
): string {
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const [shown, setShown] = useState(() => (running && !reducedMotion ? '' : text));
  const [shownPart, setShownPart] = useState(part);
  const revealRef = useRef<Reveal | null>(null);

  let next: string;
  if (reducedMotion) next = text;
  else if (part !== shownPart) next = restart(text, running);
  else next = resync(shown, text, running);
  if (part !== shownPart) setShownPart(part);
  if (next !== shown) setShown(next);

  useEffect(() => {
    revealRef.current ??= new Reveal(shown, part, setShown);
    const reveal = revealRef.current;
    const partChanged = reveal.part !== part;
    reveal.part = part;
    if (reducedMotion) reveal.shown = text;
    else reveal.shown = partChanged ? restart(text, running) : resync(reveal.shown, text, running);
    reveal.target = text;
    if (paused || reveal.shown === text) reveal.stop();
    else reveal.start();
    // `shown` only seeds the animator on its first run; afterwards it owns it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, running, paused, reducedMotion, part]);

  useEffect(() => () => revealRef.current?.stop(), []);

  return next;
}
