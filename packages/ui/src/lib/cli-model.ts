import type { AdapterInfo, AdapterModel } from '@qlan-ro/mainframe-types';

export function supportsCliModel(adapterId: string | undefined): boolean {
  return adapterId === 'claude' || adapterId === 'codex';
}

export function resolveModel(adapter: AdapterInfo | null, modelId: string): AdapterModel {
  const base = (id: string) => id.replace(/\[1m\]$/i, '');
  return (
    adapter?.models.find((model) => model.id === modelId) ??
    adapter?.models.find(
      (model) => model.id !== 'default' && base(model.resolvedModel ?? model.id) === base(modelId),
    ) ?? { id: modelId, label: modelId }
  );
}

export function withCliModel(adapter: AdapterInfo, modelId: string | null | undefined): AdapterInfo {
  if (!supportsCliModel(adapter.id)) return adapter;
  const resolved = modelId ? resolveModel(adapter, modelId) : undefined;
  const inherited: AdapterModel = {
    ...resolved,
    id: 'default',
    label: modelId ? `Use CLI setting · ${resolved?.label ?? modelId}` : 'Use CLI setting',
    description: `Use the model configured in ${adapter.name ?? adapter.id} for this project.`,
    resolvedModel: modelId ?? undefined,
    isDefault: true,
  };
  return {
    ...adapter,
    models: [
      inherited,
      ...adapter.models.filter((model) => model.id !== 'default').map((model) => ({ ...model, isDefault: false })),
    ],
  };
}

export function selectedModel(adapter: AdapterInfo | null, modelId: string | null | undefined): AdapterModel | null {
  if (modelId) return { ...resolveModel(adapter, modelId), id: modelId };
  return adapter?.models.find((model) => model.isDefault) ?? adapter?.models[0] ?? null;
}

export function modelSelectionHint(
  selected: AdapterModel | null,
  current: AdapterModel | null,
  runtimeExpected = false,
): string {
  return current
    ? `Current: ${current.label}. Selected: ${selected?.label ?? 'Use CLI setting'}.`
    : `Selected: ${selected?.label ?? 'Use CLI setting'}.${runtimeExpected ? ' Current model unavailable.' : ''}`;
}
