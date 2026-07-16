import type { AdapterInfo, FeatureKey, ProviderConfig } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES, clampEffortToSupported } from '@qlan-ro/mainframe-types';
import type { DraftCfg } from '../runtime/draft-config';

export function resolveDraftDefaults(projectId: string, adapter: AdapterInfo, provider?: ProviderConfig): DraftCfg {
  const model =
    adapter.models.find((candidate) => candidate.id === provider?.defaultModel) ??
    adapter.models.find((candidate) => candidate.isDefault) ??
    adapter.models[0];
  if (!model) throw new Error('Cannot initialize draft: adapter has no models');

  const features: Record<FeatureKey, boolean> = {
    fast: false,
    ultracode: false,
    adaptiveThinking: false,
  };
  for (const feature of TUNABLE_FEATURES) {
    features[feature.key] = Boolean(model[feature.capability] && provider?.[feature.providerDefault] === 'true');
  }

  const requestedEffort = provider?.defaultEffort ?? model.defaultEffort ?? 'medium';
  const effort = features.ultracode
    ? 'xhigh'
    : clampEffortToSupported(requestedEffort, model.supportedEfforts ?? [], model.defaultEffort);

  return {
    projectId,
    adapterId: adapter.id,
    model: model.id,
    permissionMode: provider?.defaultMode ?? 'default',
    planMode: provider?.defaultPlanMode === 'true',
    effort,
    fast: features.fast,
    ultracode: features.ultracode,
    adaptiveThinking: features.adaptiveThinking,
  };
}
