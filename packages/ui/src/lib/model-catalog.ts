import type { AdapterModel } from '@qlan-ro/mainframe-types';

const withoutContext = (id: string) => id.replace(/\[1m\]$/i, '');
const namespaceOf = (id: string) => id.slice(0, id.lastIndexOf('/') + 1);
const withoutContextLabel = (label: string) =>
  label.replace(/\s*(?:\(\d+(?:\.\d+)?[km] context\)|with \d+(?:\.\d+)?[km] context|·\s*\d+(?:\.\d+)?[km])$/i, '');

export function matchCatalogModel(models: AdapterModel[], modelId: string) {
  const exact =
    models.find((model) => model.id === modelId) ??
    models.find(
      (model) =>
        model.id !== 'default' && namespaceOf(model.id) === namespaceOf(modelId) && model.resolvedModel === modelId,
    );
  if (exact) return { model: exact, contextVariant: false };
  const variants = models.filter(
    (model) =>
      model.id !== 'default' &&
      namespaceOf(model.id) === namespaceOf(modelId) &&
      [model.id, model.resolvedModel].some((id) => id && withoutContext(id) === withoutContext(modelId)),
  );
  return variants.length === 1 ? { model: variants[0]!, contextVariant: true } : null;
}

export function modelDisplayLabel(model: AdapterModel): string {
  const window =
    model.contextWindow && model.contextWindow > 0
      ? model.contextWindow
      : /\[1m\]$/i.test(model.id)
        ? 1_000_000
        : undefined;
  if (model.id === 'default' || !window || window < 0) return model.label;
  const size = window >= 1_000_000 ? `${window / 1_000_000}M` : `${window / 1_000}K`;
  if (model.label.endsWith(` · ${size}`)) return model.label;
  return `${withoutContextLabel(model.label)} · ${size}`;
}

export function contextVariantModel(model: AdapterModel, id: string): AdapterModel {
  return {
    ...model,
    id,
    label: withoutContextLabel(model.label),
    description: undefined,
    contextWindow: undefined,
    resolvedModel: undefined,
  };
}

export function distinctModelRows(models: AdapterModel[], selectedId?: string | null): AdapterModel[] {
  const groups = new Map<string, AdapterModel[]>();
  for (const model of models) {
    const key =
      model.id !== 'default' && model.contextWindow && model.resolvedModel
        ? JSON.stringify([
            model.group,
            namespaceOf(model.id),
            withoutContext(model.id),
            model.contextWindow,
            withoutContext(model.resolvedModel),
            model.supportedEfforts,
            model.defaultEffort,
            model.supportsFast,
            model.supportsUltracode,
            model.supportsAdaptiveThinking,
            model.supportsPersonality,
          ])
        : model.id;
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }
  return [...groups.values()].map(
    (models) =>
      models.find((model) => model.id === selectedId) ??
      models.find((model) => !/\[1m\]$/i.test(model.id)) ??
      models[0]!,
  );
}
