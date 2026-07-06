/**
 * ReasoningGroup — the native Reasoning block for a grouped-reasoning part,
 * with a client-side "Thought for Ns" duration.
 *
 * The daemon delivers thinking as complete blocks (no per-block timing), so the
 * duration is measured LIVE in the client: the wall-clock window during which
 * the group reports `running`. This is intentionally imprecise — `running`
 * tracks the whole message's run state, not a distinct thinking phase — and a
 * history-loaded turn (never observed running) shows no duration. Extracted to
 * its own component so the timing hook isn't called inside the GroupedParts
 * render-prop (rules-of-hooks).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
} from '@/components/ui/assistant-ui/reasoning';

/**
 * Returns the measured duration (whole seconds) once the group stops running,
 * or `undefined` while running / for a group never observed running (history).
 * Sub-second windows return `undefined` (avoids a "Thought for 0s" label).
 */
export function useReasoningDuration(running: boolean): number | undefined {
  const startRef = useRef<number | null>(null);
  const [duration, setDuration] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (running) {
      if (startRef.current === null) startRef.current = Date.now();
      setDuration(undefined);
      return;
    }
    if (startRef.current !== null) {
      const seconds = Math.round((Date.now() - startRef.current) / 1000);
      startRef.current = null;
      if (seconds >= 1) setDuration(seconds);
    }
  }, [running]);

  return duration;
}

export function ReasoningGroup({ running, children }: { running: boolean; children: ReactNode }) {
  const duration = useReasoningDuration(running);
  return (
    <ReasoningRoot defaultOpen={running} variant="ghost">
      <ReasoningTrigger active={running} duration={duration} />
      <ReasoningContent aria-busy={running}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
}
