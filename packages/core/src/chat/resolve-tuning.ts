import type {
  AdapterModel, EffortLevel, ResolvedTuning, SessionTuning, FeatureKey,
} from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES, clampEffortToSupported } from '@qlan-ro/mainframe-types';

/** Provider config slice the resolver reads (decoded lazily here). */
export interface ProviderTuningDefaults {
  defaultEffort?: EffortLevel;
  defaultFast?: 'true' | 'false';
  defaultUltracode?: 'true' | 'false';
  defaultAdaptiveThinking?: 'true' | 'false';
}

const clampEffort = (requested: EffortLevel, model: AdapterModel): EffortLevel | null =>
  clampEffortToSupported(requested, model.supportedEfforts ?? [], model.defaultEffort);

function firstDefined<T>(...vals: (T | null | undefined)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return undefined;
}

export function resolveTuning(
  chat: SessionTuning,
  provider: ProviderTuningDefaults,
  model: AdapterModel,
): ResolvedTuning {
  const requestedEffort = firstDefined(chat.effort, provider.defaultEffort, model.defaultEffort) ?? 'medium';
  const out: ResolvedTuning = {
    effort: clampEffort(requestedEffort, model),
    fast: false,
    ultracode: false,
    adaptiveThinking: false,
  };

  for (const f of TUNABLE_FEATURES) {
    const providerRaw = provider[f.providerDefault as keyof ProviderTuningDefaults];
    const providerBool = providerRaw === undefined ? undefined : providerRaw === 'true';
    const requested = firstDefined<boolean>(chat[f.key as keyof SessionTuning] as boolean | null | undefined, providerBool);
    out[f.key as FeatureKey] = model[f.capability] ? Boolean(requested) : false;
  }

  if (out.ultracode) out.effort = 'xhigh';
  return out;
}
