import { useState } from 'react';

/**
 * useAutoOpenOnTransition — controlled open-state for a collapsible card that
 * should auto-open the FIRST time it transitions from pending to answered on
 * an already-mounted instance, while still honoring a manual collapse.
 *
 * Why not `defaultOpen`: some adapters don't hide a pending tool-call from
 * the transcript (e.g. AskUserQuestion / ExitPlanMode aren't always in the
 * adapter's `hidden` category), so the card can mount PENDING and receive
 * its result on a later rerender of the SAME component instance. Radix's
 * `defaultOpen` only seeds the initial uncontrolled state — it never fires
 * again on prop updates — so the body silently stays closed forever.
 *
 * This derives the open/prev-answered state during render (no effect, no
 * extra paint) per React's "adjusting state on prop change" pattern: on the
 * false→true transition we force `open` to true exactly once. Any manual
 * toggle afterward (including re-collapsing) sticks, because `prevAnswered`
 * is already `true` and won't re-trigger the auto-open branch.
 */
export function useAutoOpenOnTransition(answered: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(answered);
  const [prevAnswered, setPrevAnswered] = useState(answered);

  if (answered !== prevAnswered) {
    setPrevAnswered(answered);
    if (answered) setOpen(true);
  }

  return [open, setOpen];
}
