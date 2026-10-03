import { useEffect, useState } from 'react';
import type { ActivityLabel } from '../../view-model/compact/types';

export function useStableActivityLabel(label: ActivityLabel, active: boolean): string {
  const [displayed, setDisplayed] = useState(() => ({ ...label, changedAt: Date.now() }));
  useEffect(() => {
    if (!active || label.identity === displayed.identity) {
      if (label.identity !== displayed.identity || label.text !== displayed.text)
        setDisplayed({ ...label, changedAt: active ? displayed.changedAt : Date.now() });
      return;
    }
    const delay = Math.max(0, 1000 - (Date.now() - displayed.changedAt));
    if (delay === 0) {
      setDisplayed({ ...label, changedAt: Date.now() });
      return;
    }
    const timer = setTimeout(() => setDisplayed({ ...label, changedAt: Date.now() }), delay);
    return () => clearTimeout(timer);
  }, [label.identity, label.text, active, displayed]);
  return !active || label.identity === displayed.identity ? label.text : displayed.text;
}
