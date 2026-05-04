import { describe, it, expect, vi } from 'vitest';
import { ApprovalHandler } from '../approval-handler.js';
import type { ControlRequest, ControlResponse } from '@qlan-ro/mainframe-types';

function mkSink(onPermissionSpy = vi.fn()) {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: onPermissionSpy,
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

const planExitParams = {
  toolCallId: 'tc1',
  questions: [{ id: 'q1', question: 'Exit plan mode?' }],
  options: [
    [{ label: 'Yes, implement this plan', description: 'Switch to Default and start coding.' }],
    [{ label: 'No, stay in Plan mode', description: 'Continue planning.' }],
  ],
};

function setupPlanExit(): {
  handler: ApprovalHandler;
  respond: ReturnType<typeof vi.fn>;
  request: ControlRequest;
} {
  const respond = vi.fn();
  const onPermission = vi.fn();
  const handler = new ApprovalHandler(mkSink(onPermission));
  handler.setPlanContext({ planMode: true, currentTurnPlan: { id: 'p1', text: 'PLAN' } });
  handler.handleRequest('item/tool/requestUserInput', planExitParams, 7, respond);
  const request = onPermission.mock.calls[0]![0] as ControlRequest;
  return { handler, respond, request };
}

describe('ApprovalHandler.resolve — ExitPlanMode option mapping', () => {
  it('allow → picks the "Yes" label as the answer', () => {
    const { handler, respond, request } = setupPlanExit();
    const response: ControlResponse = {
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'allow',
      toolName: 'ExitPlanMode',
      executionMode: 'acceptEdits',
      updatedInput: { plan: 'PLAN' },
    };
    handler.resolve(response);

    expect(respond).toHaveBeenCalledTimes(1);
    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    expect(payload.answers.q1!.answers[0]).toBe('Yes, implement this plan');
  });

  it('deny with no message → picks the "No" label as the answer', () => {
    const { handler, respond, request } = setupPlanExit();
    const response: ControlResponse = {
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'deny',
      toolName: 'ExitPlanMode',
    };
    handler.resolve(response);

    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    expect(payload.answers.q1!.answers[0]).toBe('No, stay in Plan mode');
  });

  it('deny with message (revise) → falls back to "No" label (free-form not supported)', () => {
    const { handler, respond, request } = setupPlanExit();
    const response: ControlResponse = {
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'deny',
      toolName: 'ExitPlanMode',
      message: 'Please also add tests.',
    };
    handler.resolve(response);

    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    expect(payload.answers.q1!.answers[0]).toBe('No, stay in Plan mode');
  });

  it('AskUserQuestion → keeps legacy free-text message passthrough', () => {
    const respond = vi.fn();
    const onPermission = vi.fn();
    const handler = new ApprovalHandler(mkSink(onPermission));
    handler.setPlanContext({ planMode: false, currentTurnPlan: null });
    handler.handleRequest(
      'item/tool/requestUserInput',
      {
        toolCallId: 'tc2',
        questions: [{ id: 'q2', question: 'Pick one' }],
        options: [[{ label: 'A' }], [{ label: 'B' }], [{ label: 'C' }]],
      },
      8,
      respond,
    );
    const request = onPermission.mock.calls[0]![0] as ControlRequest;

    handler.resolve({
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'allow',
      toolName: 'AskUserQuestion',
      message: 'B',
    });

    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    expect(payload.answers.q2!.answers[0]).toBe('B');
  });

  it('AskUserQuestion → extracts answer from updatedInput.answers when message is absent (UI option click path)', () => {
    // The desktop AskUserQuestionCard sends { updatedInput: { ...request.input, answers: { [questionText]: label } } }
    // but leaves response.message undefined. The handler must extract the answer from updatedInput.answers.
    const respond = vi.fn();
    const onPermission = vi.fn();
    const handler = new ApprovalHandler(mkSink(onPermission));
    handler.setPlanContext({ planMode: false, currentTurnPlan: null });
    handler.handleRequest(
      'item/tool/requestUserInput',
      {
        toolCallId: 'tc3',
        questions: [{ id: 'q3', question: 'Which approach?' }],
        options: [[{ label: 'Option A' }], [{ label: 'Option B' }]],
      },
      9,
      respond,
    );
    const request = onPermission.mock.calls[0]![0] as ControlRequest;

    // Simulate UI sending the selected option label in updatedInput.answers keyed by question text
    handler.resolve({
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'allow',
      toolName: 'AskUserQuestion',
      // No message — the UI puts the selection in updatedInput instead
      updatedInput: {
        ...request.input,
        answers: { 'Which approach?': 'Option B' },
      },
    });

    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    expect(payload.answers.q3!.answers[0]).toBe('Option B');
  });

  it('AskUserQuestion → handles array selection from updatedInput.answers (multiSelect path)', () => {
    const respond = vi.fn();
    const onPermission = vi.fn();
    const handler = new ApprovalHandler(mkSink(onPermission));
    handler.setPlanContext({ planMode: false, currentTurnPlan: null });
    handler.handleRequest(
      'item/tool/requestUserInput',
      {
        toolCallId: 'tc4',
        questions: [{ id: 'q4', question: 'Select features' }],
        options: [[{ label: 'Tests' }], [{ label: 'Docs' }], [{ label: 'CI' }]],
      },
      10,
      respond,
    );
    const request = onPermission.mock.calls[0]![0] as ControlRequest;

    handler.resolve({
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'allow',
      toolName: 'AskUserQuestion',
      updatedInput: {
        ...request.input,
        answers: { 'Select features': ['Tests', 'CI'] },
      },
    });

    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    // For Codex, we deliver the first selected value; multi-select support is best-effort
    expect(payload.answers.q4!.answers[0]).toBe('Tests');
  });

  it('AskUserQuestion → falls back to empty string when both message and updatedInput.answers are absent', () => {
    const respond = vi.fn();
    const onPermission = vi.fn();
    const handler = new ApprovalHandler(mkSink(onPermission));
    handler.setPlanContext({ planMode: false, currentTurnPlan: null });
    handler.handleRequest(
      'item/tool/requestUserInput',
      {
        toolCallId: 'tc5',
        questions: [{ id: 'q5', question: 'Any input?' }],
      },
      11,
      respond,
    );
    const request = onPermission.mock.calls[0]![0] as ControlRequest;

    handler.resolve({
      requestId: request.requestId,
      toolUseId: request.toolUseId,
      behavior: 'deny',
      toolName: 'AskUserQuestion',
    });

    const payload = respond.mock.calls[0]![1] as { answers: Record<string, { answers: string[] }> };
    expect(payload.answers.q5!.answers[0]).toBe('');
  });
});
