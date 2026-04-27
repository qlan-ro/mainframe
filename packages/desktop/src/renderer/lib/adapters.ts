import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../store/settings';
import { useAdaptersStore } from '../store/adapters';

const ADAPTER_LABEL_FALLBACK: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

const CLAUDE_MODEL_ID_PATTERN = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d+)?$/i;

function getModelMetadata(adapters: AdapterInfo[]): Map<string, { label: string; contextWindow?: number }> {
  const metadata = new Map<string, { label: string; contextWindow?: number }>();
  for (const adapter of adapters) {
    for (const model of adapter.models) {
      metadata.set(model.id, { label: model.label, contextWindow: model.contextWindow });
    }
  }
  return metadata;
}

export function getAdapterOptions(adapters: AdapterInfo[]): { id: string; label: string }[] {
  return adapters.map((adapter) => ({ id: adapter.id, label: adapter.name }));
}

export function getAdapterLabel(adapterId: string, adapters?: AdapterInfo[]): string {
  const name = adapters?.find((adapter) => adapter.id === adapterId)?.name;
  return name ?? ADAPTER_LABEL_FALLBACK[adapterId] ?? adapterId;
}

export function getModelOptions(
  adapterId: string,
  adapters: AdapterInfo[],
): { id: string; label: string; description?: string }[] {
  const adapter = adapters.find((entry) => entry.id === adapterId);
  if (!adapter) return [];
  return adapter.models.map((model) => ({
    id: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
  }));
}

export function getModelLabel(modelId: string | undefined, adapters: AdapterInfo[]): string {
  if (!modelId) return '';

  const metadata = getModelMetadata(adapters);
  const explicitLabel = metadata.get(modelId)?.label;
  if (explicitLabel) return explicitLabel;

  const match = modelId.match(CLAUDE_MODEL_ID_PATTERN);
  if (!match) return modelId;

  const [, family = '', major, minor] = match;
  const familyLabel = `${family.slice(0, 1).toUpperCase()}${family.slice(1).toLowerCase()}`;
  return `${familyLabel} ${major}.${minor}`;
}

/**
 * Resolve the default model for an adapter: provider setting → isDefault entry → first model.
 * Safe to call outside React (reads stores via getState()).
 */
export function getDefaultModelForAdapter(adapterId: string): string | undefined {
  const providerDefault = useSettingsStore.getState().providers[adapterId]?.defaultModel;
  if (providerDefault) return providerDefault;
  const adapter = useAdaptersStore.getState().adapters.find((a) => a.id === adapterId);
  return adapter?.models.find((m) => m.isDefault)?.id ?? adapter?.models[0]?.id;
}

export function getModelContextWindow(modelId: string | undefined, adapters: AdapterInfo[]): number {
  if (!modelId) return 200_000;
  return getModelMetadata(adapters).get(modelId)?.contextWindow ?? 200_000;
}
