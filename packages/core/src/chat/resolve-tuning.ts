import type {
  AdapterModel, EffortLevel, ResolvedTuning, SessionTuning, FeatureKey,
} from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES } from '@qlan-ro/mainframe-types';

const EFFORT_ORDER: EffortLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const rank = (e: EffortLevel): number => EFFORT_ORDER.indexOf(e);

/** Provider config slice the resolver reads (decoded lazily here). */
export interface ProviderTuningDefaults {
  defaultEffort?: EffortLevel;
  defaultFast?: 'true' | 'false';
  defaultUltracode?: 'true' | 'false';
  defaultAdaptiveThinking?: 'true' | 'false';
}

function clampEffort(requested: EffortLevel, model: AdapterModel): EffortLevel | null {
  const supported = model.supportedEfforts ?? [];
  if (supported.length === 0) return null; // model has no effort control
  if (supported.includes(requested)) return requested;
  if (model.defaultEffort && supported.includes(model.defaultEffort)) return model.defaultEffort;
  const below = supported
    .filter((e) => rank(e) <= rank(requested))
    .sort((a, b) => rank(b) - rank(a));
  if (below[0]) return below[0];
  return [...supported].sort((a, b) => rank(a) - rank(b))[0]!; // lowest supported
}

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
