import type { ProviderConfig } from '@qlan-ro/mainframe-types';

interface SettingsReader {
  settings: { get(ns: string, key: string): string | null };
}

const FIELDS = [
  'defaultModel', 'defaultMode', 'defaultPlanMode', 'executablePath', 'systemPrompt',
  'defaultEffort', 'defaultFast', 'defaultUltracode', 'defaultAdaptiveThinking',
  'personality', 'reasoningSummary', 'verbosity',
] as const;

export function getProviderConfig(db: SettingsReader, adapterId: string): ProviderConfig {
  const cfg: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = db.settings.get('provider', `${adapterId}.${f}`);
    if (v != null) cfg[f] = v;
  }
  return cfg as ProviderConfig;
}
