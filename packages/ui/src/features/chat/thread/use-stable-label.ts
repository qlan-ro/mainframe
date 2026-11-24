import { useEffect, useState } from 'react';

export interface StableLabel {
  readonly identity: string;
  readonly text: string;
}

/** Holds a label for at least a second, so a word that changes faster doesn't flicker. New text under the same identity shows at once. */
export function useStableLabel(label: StableLabel): string {
  const [displayed, setDisplayed] = useState(() => ({ ...label, changedAt: Date.now() }));
  useEffect(() => {
    if (label.identity === displayed.identity) {
      if (label.text !== displayed.text) setDisplayed({ ...label, changedAt: displayed.changedAt });
      return;
    }
    const delay = Math.max(0, 1000 - (Date.now() - displayed.changedAt));
    if (delay === 0) {
      setDisplayed({ ...label, changedAt: Date.now() });
      return;
    }
    const timer = setTimeout(() => setDisplayed({ ...label, changedAt: Date.now() }), delay);
    return () => clearTimeout(timer);
  }, [label.identity, label.text, displayed]);
  return label.identity === displayed.identity ? label.text : displayed.text;
}
