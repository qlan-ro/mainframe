/**
 * Copy for the mid-session tuning-change confirm dialog (todo #288).
 *
 * One sentence names the change and the mechanism. It stays hedged on purpose: the
 * re-billing claim is upstream API behavior this repo does not measure, so the copy
 * describes what happens to the cached context and never promises a charge, a token
 * count, or a cache-hit outcome.
 */
import type { TuningChange } from './tuning-warning';

export interface TuningWarningCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

/** Rough, deliberately imprecise size of the conversation being re-sent; null when unknown. */
export function formatApproxTokens(totalTokens: number | null): string | null {
  if (totalTokens == null || totalTokens <= 0) return null;
  return totalTokens >= 1000 ? `~${Math.round(totalTokens / 1000)}k` : `~${totalTokens}`;
}

/** What the dialog calls the thing being changed — the feature's own name, else the control kind. */
function subject(change: TuningChange): string {
  return change.kind === 'feature' ? change.featureLabel : change.kind;
}

function transition(change: TuningChange): string {
  if (change.kind === 'feature') {
    return `${change.from ? 'On' : 'Off'} → ${change.to ? 'On' : 'Off'}`;
  }
  return `${change.fromLabel} → ${change.toLabel}`;
}

export function describeTuningChange(change: TuningChange, contextTokens: number | null): TuningWarningCopy {
  const noun = subject(change);
  const approx = formatApproxTokens(contextTokens);
  const size = approx == null ? '' : ` (${approx} tokens)`;

  return {
    title: `Change ${noun} for this session?`,
    body:
      `${transition(change)}. The session's cached context is discarded, ` +
      `so your next message re-sends the conversation${size} as new input.`,
    confirmLabel: `Change ${noun}`,
  };
}
