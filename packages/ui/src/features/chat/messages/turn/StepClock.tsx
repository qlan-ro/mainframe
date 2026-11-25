import { useEffect, useState } from 'react';
import type { ToolCallTiming } from '@assistant-ui/react';
import { formatElapsedSeconds } from '../../format-duration';
import { formatStepDuration } from '../../format-step';
import { stepElapsedMs, stepElapsedTicks } from './step-timing';

export interface StepTiming {
  timing?: ToolCallTiming;
  running: boolean;
  reportedDurationMs?: number;
}

/** A step's duration: ticking in whole seconds while it runs. */
export function useStepDuration({ timing, running, reportedDurationMs }: StepTiming): string | undefined {
  // The clock is state, not a render-time `Date.now()`: the React Compiler would
  // cache that read alongside `elapsed` and the timer would stop moving.
  const [now, setNow] = useState(() => Date.now());
  const ticking = stepElapsedTicks(timing, running, now);
  useEffect(() => {
    if (!ticking) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [ticking]);
  const elapsed = stepElapsedMs(timing, running, now, reportedDurationMs);
  // Under a tenth of a second there is nothing to say.
  if (elapsed === undefined || (!running && elapsed < 100)) return undefined;
  return running ? formatElapsedSeconds(elapsed / 1000) : formatStepDuration(elapsed);
}
