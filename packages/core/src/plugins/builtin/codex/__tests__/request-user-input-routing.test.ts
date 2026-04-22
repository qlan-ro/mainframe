import { describe, it, expect, vi } from 'vitest';
import { ApprovalHandler } from '../approval-handler.js';

function mkSink() {
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
  };
}

describe('Codex requestUserInput routing', () => {
  const requestUserInputParams = {
    toolCallId: 'tc1',
    questions: ['Implement this plan?'],
    options: [
      [{ label: 'Yes, implement this plan', description: 'Switch to Default and start coding.' }],
      [{ label: 'No, stay in Plan mode', description: 'Continue planning with the model.' }],
    ],
  };

  it('routes to ExitPlanMode when planMode=true and a plan was captured this turn', () => {
    const sink = mkSink();
    const handler = new ApprovalHandler(sink);
    handler.setPlanContext({ planMode: true, currentTurnPlan: { id: 'p1', text: 'full plan text' } });
    handler.handleRequest('item/tool/requestUserInput', requestUserInputParams, 42, vi.fn());

    expect(sink.onPermission).toHaveBeenCalledTimes(1);
    const req = sink.onPermission.mock.calls[0]![0] as { toolName: string; input: Record<string, unknown> };
    expect(req.toolName).toBe('ExitPlanMode');
    expect(req.input.plan).toBe('full plan text');
  });

  it('routes to AskUserQuestion when planMode=false', () => {
    const sink = mkSink();
    const handler = new ApprovalHandler(sink);
    handler.setPlanContext({ planMode: false, currentTurnPlan: { id: 'p1', text: 'x' } });
    handler.handleRequest('item/tool/requestUserInput', requestUserInputParams, 43, vi.fn());
    const req = sink.onPermission.mock.calls[0]![0] as { toolName: string };
    expect(req.toolName).toBe('AskUserQuestion');
  });

  it('routes to AskUserQuestion when no plan captured yet', () => {
    const sink = mkSink();
    const handler = new ApprovalHandler(sink);
    handler.setPlanContext({ planMode: true, currentTurnPlan: null });
    handler.handleRequest('item/tool/requestUserInput', requestUserInputParams, 44, vi.fn());
    const req = sink.onPermission.mock.calls[0]![0] as { toolName: string };
    expect(req.toolName).toBe('AskUserQuestion');
  });
});
