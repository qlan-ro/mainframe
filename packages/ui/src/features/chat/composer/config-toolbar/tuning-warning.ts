/**
 * Pure decision layer for the mid-session tuning warning (todo #288).
 *
 * `resolveTuningChange` turns a raw control request into a before/after pair;
 * `shouldWarnTuningChange` decides whether that pair is worth interrupting for. Both
 * are plain functions of their arguments — no React, no store reads, no network — so
 * the rule is testable without rendering the composer. The pair is compared, never
 * displayed: the dialog copy names the kind of change, not the values.
 *
 * The "from" value is always the EFFECTIVE one the control displays (see
 * `displayEffort` / `effectiveFeature`), never the raw chat override: a re-pick of
 * the value on screen must read as a no-op even when the value is inherited or
 * clamped.
 */
import type { AdapterModel, Chat, EffortLevel, FeatureKey, ProviderConfig } from '@qlan-ro/mainframe-types';
import { FEATURE_LABELS, displayEffort, effectiveFeature } from '@/lib/model-tuning';

export type TuningChangeRequest =
  | { kind: 'model'; to: string }
  | { kind: 'effort'; to: EffortLevel }
  | { kind: 'feature'; key: FeatureKey; to: boolean };

export type TuningChange =
  | { kind: 'model'; from: string | null; to: string }
  | { kind: 'effort'; from: EffortLevel; to: EffortLevel }
  | { kind: 'feature'; key: FeatureKey; from: boolean; to: boolean; featureLabel: string };

export interface TuningWarningContext {
  chat: Chat | null;
  model: AdapterModel | null;
  providerDefaults: ProviderConfig | undefined;
  hasMessages: boolean;
  contextTokens: number | null;
}

/** `displayEffort` needs a model; this stand-in advertises none, so it falls through to the inherited value. */
const NO_MODEL: AdapterModel = { id: '', label: '' };

/** Describes what a control request would change, or null when there is no chat to change. */
export function resolveTuningChange(ctx: TuningWarningContext, request: TuningChangeRequest): TuningChange | null {
  const chat = ctx.chat;
  if (chat == null) return null;

  switch (request.kind) {
    case 'model':
      return { kind: 'model', from: ctx.model?.id ?? chat.model ?? null, to: request.to };
    case 'effort':
      return {
        kind: 'effort',
        from: displayEffort(chat, ctx.model ?? NO_MODEL, ctx.providerDefaults).value,
        to: request.to,
      };
    case 'feature': {
      return {
        kind: 'feature',
        key: request.key,
        from: effectiveFeature(chat, ctx.providerDefaults, request.key),
        to: request.to,
        featureLabel: FEATURE_LABELS[request.key].label,
      };
    }
  }
}

/**
 * Warn only when the change is real and the user has not opted out. An unresolvable
 * "from" (null) counts as different, so a change we cannot describe still warns
 * rather than slipping through.
 */
export function shouldWarnTuningChange(args: {
  change: TuningChange;
  hasMessages: boolean;
  suppressed: boolean;
}): boolean {
  if (args.suppressed || !args.hasMessages) return false;
  return args.change.from !== args.change.to;
}
