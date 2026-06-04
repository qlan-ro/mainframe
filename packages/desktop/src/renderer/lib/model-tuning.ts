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

/**
 * Display-only effort for the chip. Mirrors the resolver's ultracode→xhigh coercion
 * for presentation WITHOUT persisting it (stored effort stays inherited). When
 * ultracode is on, the chip shows xhigh and is locked; otherwise the chat's effort
 * or the model default.
 */
export function displayEffort(
  chat: { effort?: EffortLevel | null; ultracode?: boolean | null },
  model: AdapterModel,
): { value: EffortLevel; locked: boolean } {
  if (chat.ultracode) return { value: 'xhigh', locked: true };
  return { value: chat.effort ?? model.defaultEffort ?? 'medium', locked: false };
}
