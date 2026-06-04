import type { AdapterModel, ResolvedTuning } from '@qlan-ro/mainframe-types';
import type { CollaborationMode } from './types.js';

/** Codex-only provider config — stays in the codex package, never on shared spawn options. */
export interface CodexProviderTuning {
  personality?: 'none' | 'friendly' | 'pragmatic';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
  verbosity?: 'low' | 'medium' | 'high';
}

export interface CodexTurnConfig {
  collaborationMode: CollaborationMode;
  serviceTier: 'fast' | 'flex';
  personality?: string;
  summary?: string;
  verbosity?: string;
}

export function buildTurnConfig(
  tuning: ResolvedTuning,
  codex: CodexProviderTuning,
  model: AdapterModel,
  mode: 'plan' | 'default',
): CodexTurnConfig {
  const cfg: CodexTurnConfig = {
    collaborationMode: {
      mode,
      settings: {
        model: model.id,
        reasoning_effort: tuning.effort as string | null,
        developer_instructions: null,
      },
    },
    serviceTier: model.supportsFast && tuning.fast ? 'fast' : 'flex',
  };
  if (model.supportsPersonality && codex.personality) cfg.personality = codex.personality;
  if (codex.reasoningSummary) cfg.summary = codex.reasoningSummary;
  if (codex.verbosity) cfg.verbosity = codex.verbosity;
  return cfg;
}
