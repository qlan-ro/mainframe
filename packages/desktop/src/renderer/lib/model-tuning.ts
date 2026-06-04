import type { AdapterModel, EffortLevel, FeatureKey } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

export const EFFORT_META: Record<EffortLevel, { label: string; description: string }> = {
  none: { label: 'None', description: 'No reasoning' },
  minimal: { label: 'Minimal', description: 'Fastest, least reasoning' },
  low: { label: 'Low', description: 'Quick, straightforward' },
  medium: { label: 'Medium', description: 'Balanced speed and depth' },
  high: { label: 'High', description: 'Thorough reasoning' },
  xhigh: { label: 'Extra-high', description: 'Extra reasoning for hard tasks' },
  max: { label: 'Maximum', description: 'Maximum reasoning depth' },
};

export const FEATURE_LABELS: Record<FeatureKey, { label: string; desc: string }> = {
  fast: { label: 'Fast mode', desc: 'Faster output; may draw on usage credits' },
  ultracode: { label: 'Ultracode', desc: 'xhigh effort + dynamic workflows' },
  adaptiveThinking: { label: 'Adaptive thinking', desc: 'Claude decides when/how much to think' },
};

export function effortOptions(model: AdapterModel) {
  return (model.supportedEfforts ?? []).map((id) => ({ id, ...EFFORT_META[id] }));
}

export function visibleFeatures(model: AdapterModel) {
  return TUNABLE_FEATURES.filter((f) => model[f.capability as keyof AdapterModel]).map((f) => ({
    key: f.key as FeatureKey,
    ...FEATURE_LABELS[f.key as FeatureKey],
  }));
}

/** Provider-default slice the composer reads to display the EFFECTIVE (inherited) value. */
export interface TuningDefaults {
  defaultEffort?: EffortLevel;
  defaultFast?: 'true' | 'false';
  defaultUltracode?: 'true' | 'false';
  defaultAdaptiveThinking?: 'true' | 'false';
}

type ChatTuningFields = {
  effort?: EffortLevel | null;
  fast?: boolean | null;
  ultracode?: boolean | null;
  adaptiveThinking?: boolean | null;
};

/** Effective value of a boolean feature for DISPLAY: chat override → provider default → off. */
export function effectiveFeature(chat: ChatTuningFields, provider: TuningDefaults | undefined, key: FeatureKey): boolean {
  const own = chat[key];
  if (own != null) return own;
  const f = TUNABLE_FEATURES.find((t) => t.key === key)!;
  return provider?.[f.providerDefault as keyof TuningDefaults] === 'true';
}

/**
 * Display-only effort for the chip. Mirrors the resolver's ultracode→xhigh coercion
 * and the inherit precedence (chat → provider default → model default) for presentation
 * WITHOUT persisting it. When ultracode is effectively on, the chip shows xhigh + locks.
 */
export function displayEffort(
  chat: ChatTuningFields,
  model: AdapterModel,
  provider?: TuningDefaults,
): { value: EffortLevel; locked: boolean } {
  // Lock to xhigh only when ultracode is BOTH effectively on AND supported by the
  // current model — mirrors the resolver, which forces unsupported ultracode false.
  if (effectiveFeature(chat, provider, 'ultracode') && model.supportsUltracode) {
    return { value: 'xhigh', locked: true };
  }
  const requested = chat.effort ?? provider?.defaultEffort ?? model.defaultEffort ?? 'medium';
  const supported = model.supportedEfforts ?? [];
  // Never display an effort the model doesn't support (the resolver would clamp it).
  const value =
    supported.length === 0 || supported.includes(requested)
      ? requested
      : model.defaultEffort && supported.includes(model.defaultEffort)
        ? model.defaultEffort
        : (supported[0] ?? requested);
  return { value, locked: false };
}
