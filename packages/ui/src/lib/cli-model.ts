import type { AdapterInfo, AdapterModel } from '@qlan-ro/mainframe-types';
import { contextVariantModel, distinctModelRows, matchCatalogModel, modelDisplayLabel } from './model-catalog';

export function supportsCliModel(adapterId: string | undefined): boolean {
  return adapterId === 'claude' || adapterId === 'codex';
}

export function resolveModel(adapter: Pick<AdapterInfo, 'models'> | null, modelId: string): AdapterModel {
  const match = matchCatalogModel(adapter?.models ?? [], modelId);
  if (!match) return { id: modelId, label: modelId };
  const model = match.contextVariant ? contextVariantModel(match.model, modelId) : match.model;
  return { ...model, label: modelDisplayLabel(model) };
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
      ...adapter.models
        .filter((model) => model.id !== 'default')
        .map((model) => ({ ...model, label: modelDisplayLabel(model), isDefault: false })),
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

export function modelChoices(adapter: Pick<AdapterInfo, 'models'> | null, storedId?: string | null): AdapterModel[] {
  const catalog = adapter?.models ?? [];
  const match = storedId ? matchCatalogModel(catalog, storedId) : null;
  const rows = distinctModelRows(
    catalog.map((model) => ({ ...model, label: modelDisplayLabel(model) })),
    match && !match.contextVariant ? match.model.id : storedId,
  );
  if (!storedId || catalog.some((model) => model.id === storedId)) return rows;
  const selected = { ...resolveModel({ models: catalog }, storedId), id: storedId };
  if (match && !match.contextVariant) {
    return rows.map((model) => (model.id === match.model.id ? selected : model));
  }
  return [selected, ...rows];
}
