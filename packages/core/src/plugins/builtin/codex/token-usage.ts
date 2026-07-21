import type { SessionSink } from '@qlan-ro/mainframe-types';
import type { TokenUsageUpdatedParams } from './types.js';

interface TokenUsageState {
  lastUsage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
  };
}

export function handleTokenUsage(params: TokenUsageUpdatedParams, sink: SessionSink, state: TokenUsageState): void {
  if ('tokenUsage' in params) {
    const { last, modelContextWindow } = params.tokenUsage;
    state.lastUsage = {
      input_tokens: last.inputTokens,
      output_tokens: last.outputTokens,
      cache_read_input_tokens: last.cachedInputTokens,
    };
    if (modelContextWindow != null && modelContextWindow > 0) {
      const contextTokens = Math.max(0, last.totalTokens - last.reasoningOutputTokens);
      sink.onContextUsage({
        totalTokens: contextTokens,
        maxTokens: modelContextWindow,
        percentage: Math.min(100, (contextTokens / modelContextWindow) * 100),
      });
    }
    return;
  }

  state.lastUsage = {
    input_tokens: params.usage.input_tokens,
    output_tokens: params.usage.output_tokens,
    cache_read_input_tokens: params.usage.cached_input_tokens,
  };
}
