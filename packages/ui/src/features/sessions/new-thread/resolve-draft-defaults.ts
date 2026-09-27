import type { AdapterInfo, FeatureKey, ProviderConfig } from '@qlan-ro/mainframe-types';
import { TUNABLE_FEATURES, clampEffortToSupported } from '@qlan-ro/mainframe-types';
import { selectedModel, withCliModel } from '@/lib/cli-model';
import type { DraftCfg } from '../runtime/draft-config';

export function resolveDraftDefaults(
  projectId: string | null,
  adapter: AdapterInfo,
  provider?: ProviderConfig,
  cliModel?: string | null,
): DraftCfg {
  const catalog = withCliModel(adapter, cliModel);
  const model = selectedModel(catalog, provider?.defaultModel);
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
    : model.supportedEfforts
      ? clampEffortToSupported(requestedEffort, model.supportedEfforts, model.defaultEffort)
      : (provider?.defaultEffort ?? null);

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
