'use client';

/**
 * RunningHint — explains why a composer tuning control is inert mid-turn.
 *
 * The triggers carry `disabled:pointer-events-none`, so a tooltip on the button
 * itself never fires; the hint has to wrap the whole control. It wraps only while
 * the turn runs, leaving the enabled markup exactly as it is today.
 */

import type { ReactElement } from 'react';
import { Hint } from '@v2/components/ui/hint';

export const RUNNING_HINT = 'Unavailable while the assistant is working';

export function RunningHint({ active, children }: { active: boolean; children: ReactElement }) {
  if (!active) return children;
  return (
    <Hint label={RUNNING_HINT}>
      <span className="inline-flex">{children}</span>
    </Hint>
  );
}
