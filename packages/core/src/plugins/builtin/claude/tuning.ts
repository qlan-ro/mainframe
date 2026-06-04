import type { ResolvedTuning } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

// Input is a complete ResolvedTuning (no undefined). Emit all three booleans;
// omit effortLevel only when the model has no effort control (effort === null).
export function tuningToFlagSettings(t: ResolvedTuning): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (t.effort !== null) s.effortLevel = t.effort;
  for (const f of TUNABLE_FEATURES) s[f.claudeSetting] = t[f.key as keyof ResolvedTuning];
  return s;
}
