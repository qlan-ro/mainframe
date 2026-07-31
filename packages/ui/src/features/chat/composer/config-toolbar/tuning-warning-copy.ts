/**
 * Copy for the mid-session tuning-change confirm dialog (todo #288).
 *
 * The body is one fixed sentence for every change kind — model, effort, and feature
 * all invalidate the same cache, and the title already names what is changing.
 * "Usage or cost" covers both ways a plan pays for the re-sent tokens; "contributing
 * to" is the hedge, since the re-billing is upstream behavior this repo cannot measure.
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

export function describeTuningChange(change: TuningChange, contextTokens: number | null): TuningWarningCopy {
  const noun = subject(change);
  const approx = formatApproxTokens(contextTokens);
  const size = approx == null ? '' : ` (${approx} tokens)`;

  return {
    title: `Change ${noun} for this session?`,
    body:
      `Changing model or reasoning effort will invalidate cached context, ` +
      `so your next message re-sends the conversation${size} as new input, ` +
      `contributing to your usage or cost.`,
    confirmLabel: `Change ${noun}`,
  };
}
