import type { ResolvedTuning } from '@qlan-ro/mainframe-types';
import type { CollaborationMode } from './types.js';

/** Codex-only provider config — stays in the codex package, never on shared spawn options. */
export interface CodexProviderTuning {
  personality?: 'none' | 'friendly' | 'pragmatic';
  reasoningSummary?: 'auto' | 'concise' | 'detailed' | 'none';
}

export interface CodexTurnConfig {
  collaborationMode: CollaborationMode;
  /**
   * Only set to 'fast' when the (model-clamped) fast toggle is on. Left undefined
   * otherwise so turn/start omits service_tier and Codex uses the account default.
   * We never send 'flex': it's rejected by models that don't support it (e.g.
   * gpt-5.5 → 400 Unsupported service_tier: flex).
   */
  serviceTier?: 'fast';
  personality?: string;
  summary?: string;
}

/**
 * Builds the Codex turn/start config from ALREADY-RESOLVED inputs. It deliberately
 * does NOT re-gate on model capabilities: `tuning.fast` is already clamped by
 * resolveTuning against the real model, and `codex.personality` is already gated by
 * the settings UI. Re-checking caps here would require the real model (the session
 * only knows the model id), which previously produced an inert 'flex'/no-personality.
 */
export function buildTurnConfig(
  tuning: ResolvedTuning,
  codex: CodexProviderTuning,
  modelId: string,
  mode: 'plan' | 'default',
): CodexTurnConfig {
  const cfg: CodexTurnConfig = {
    collaborationMode: {
      mode,
      settings: {
        model: modelId,
        reasoning_effort: tuning.effort as string | null,
        developer_instructions: null,
      },
    },
  };
  if (tuning.fast) cfg.serviceTier = 'fast';
  if (codex.personality) cfg.personality = codex.personality;
  if (codex.reasoningSummary) cfg.summary = codex.reasoningSummary;
  return cfg;
}
