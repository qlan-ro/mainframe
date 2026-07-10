import type { AdapterModel } from '@qlan-ro/mainframe-types';

export function normalizeSavedDefaultModel(
  configuredModel: string | undefined,
  models: AdapterModel[],
): string | undefined {
  if (!configuredModel || models.length === 0) return configuredModel;
  return models.some((model) => model.id === configuredModel) ? configuredModel : undefined;
}
