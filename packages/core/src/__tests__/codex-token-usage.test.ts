import { describe, expect, it, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { handleNotification, type CodexSessionState } from '../plugins/builtin/codex/event-mapper.js';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
    onCliMessage: vi.fn(),
    onSkillLoaded: vi.fn(),
    onSubagentChild: vi.fn(),
  };
}

describe('Codex token usage', () => {
  it('reports context usage from the current tokenUsage notification', () => {
    const sink = createSink();
    const state: CodexSessionState = { threadId: null, currentTurnId: null, currentTurnPlan: null };

    handleNotification(
      'thread/tokenUsage/updated',
      {
        threadId: 't1',
        turnId: 'turn_1',
        tokenUsage: {
          total: {
            totalTokens: 250_000,
            inputTokens: 240_000,
            cachedInputTokens: 200_000,
            outputTokens: 10_000,
            reasoningOutputTokens: 4_000,
          },
          last: {
            totalTokens: 100_000,
            inputTokens: 95_000,
            cachedInputTokens: 80_000,
            outputTokens: 5_000,
            reasoningOutputTokens: 2_000,
          },
          modelContextWindow: 200_000,
        },
      },
      sink,
      state,
    );

    expect(sink.onContextUsage).toHaveBeenCalledWith({
      totalTokens: 98_000,
      maxTokens: 200_000,
      percentage: 49,
    });
  });
});
