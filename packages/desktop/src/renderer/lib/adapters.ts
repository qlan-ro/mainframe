import type { AdapterInfo } from '@mainframe/types';

const ADAPTER_LABEL_FALLBACK: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

const CLAUDE_MODELS: Array<{ id: string; label: string; contextWindow: number }> = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', contextWindow: DEFAULT_CONTEXT_WINDOW },
];

const CLAUDE_MODEL_ID_PATTERN = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d+)?$/i;

function getModelMetadata(adapters: AdapterInfo[]): Map<string, { label: string; contextWindow?: number }> {
  const metadata = new Map<string, { label: string; contextWindow?: number }>();
  for (const adapter of adapters) {
    for (const model of adapter.models) {
      metadata.set(model.id, { label: model.label, contextWindow: model.contextWindow });
    }
  }
  for (const model of CLAUDE_MODELS) {
    if (!metadata.has(model.id)) {
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

export function getModelOptions(adapterId: string, adapters: AdapterInfo[]): { id: string; label: string }[] {
  const adapter = adapters.find((entry) => entry.id === adapterId);
  if (!adapter) return [];
  return adapter.models.map((model) => ({ id: model.id, label: model.label }));
}

export function getModelLabel(modelId: string | undefined, adapters: AdapterInfo[]): string {
  if (!modelId) return '';

  const metadata = getModelMetadata(adapters);
  const explicitLabel = metadata.get(modelId)?.label;
  if (explicitLabel) return explicitLabel;

  const match = modelId.match(CLAUDE_MODEL_ID_PATTERN);
  if (!match) return modelId;

  const [, family, major, minor] = match;
  const familyLabel = `${family.slice(0, 1).toUpperCase()}${family.slice(1).toLowerCase()}`;
  return `${familyLabel} ${major}.${minor}`;
}

export function getModelContextWindow(modelId: string | undefined, adapters: AdapterInfo[]): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  return getModelMetadata(adapters).get(modelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}
