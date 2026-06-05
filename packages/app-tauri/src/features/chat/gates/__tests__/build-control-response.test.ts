/**
 * build-control-response — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - Source modules do not exist yet; these tests define the API contract for
 *    three pure builder functions: buildPermissionResponse,
 *    buildAskUserQuestionResponse, and buildPlanResponse.
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    functions under test.
 *
 * Behaviors covered:
 *  - buildPermissionResponse: deny, once (no updatedPermissions), always (with
 *    updatedPermissions from entry.request.suggestions).
 *  - buildAskUserQuestionResponse: with answers (spreads original input,
 *    appends answers key), without answers (behavior:'deny', no updatedInput).
 *  - buildPlanResponse: approve+yolo+clearContext, approve+default (no
 *    clearContext key), reject, revise (trims feedback into message).
 */
import { describe, it, expect } from 'vitest';
import type { ControlRequest, ControlUpdate } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import { buildPermissionResponse, buildAskUserQuestionResponse, buildPlanResponse } from '../build-control-response';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUG: ControlUpdate = {
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent: 'git:*' }],
  behavior: 'allow',
  destination: 'session',
};

function entry(over: Partial<ControlRequest> = {}, askedAt = 1): ChatPermissionEntry {
  const request: ControlRequest = {
    requestId: 'r1',
    toolName: 'Bash',
    toolUseId: 'tu1',
    input: { cmd: 'ls' },
    suggestions: [],
    ...over,
  };
  return { requestId: request.requestId, request, askedAt };
}

// ---------------------------------------------------------------------------
// buildPermissionResponse
// ---------------------------------------------------------------------------

describe('buildPermissionResponse', () => {
  it("kind='deny' returns behavior:'deny' with ids, no updatedInput or updatedPermissions", () => {
    const res = buildPermissionResponse(entry(), 'deny');
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'deny',
    });
  });

  it("kind='once' returns behavior:'allow' with updatedInput from entry.request.input, no updatedPermissions key", () => {
    const res = buildPermissionResponse(entry(), 'once');
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'allow',
      updatedInput: { cmd: 'ls' },
    });
    expect(res).not.toHaveProperty('updatedPermissions');
  });

  it("kind='always' returns behavior:'allow' with updatedInput and updatedPermissions from entry.request.suggestions", () => {
    const res = buildPermissionResponse(entry({ suggestions: [SUG] }), 'always');
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'allow',
      updatedInput: { cmd: 'ls' },
      updatedPermissions: [SUG],
    });
  });
});

// ---------------------------------------------------------------------------
// buildAskUserQuestionResponse
// ---------------------------------------------------------------------------

describe('buildAskUserQuestionResponse', () => {
  it('with answers: spreads original request.input and appends answers key', () => {
    const e = entry({ input: { questions: ['Pick a format'] } });
    const res = buildAskUserQuestionResponse(e, { 'Pick a format': 'MP4' });
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'allow',
      updatedInput: {
        questions: ['Pick a format'],
        answers: { 'Pick a format': 'MP4' },
      },
    });
  });

  it('with answers: result.updatedInput still contains original questions array', () => {
    const e = entry({ input: { questions: ['Pick a format', 'Choose codec'] } });
    const res = buildAskUserQuestionResponse(e, { 'Pick a format': 'MP4', 'Choose codec': 'H.264' });
    expect(res.updatedInput).toHaveProperty('questions', ['Pick a format', 'Choose codec']);
  });

  it('with answers=undefined: returns behavior:deny and no updatedInput key', () => {
    const res = buildAskUserQuestionResponse(entry(), undefined);
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'Bash',
      behavior: 'deny',
    });
    expect(res).not.toHaveProperty('updatedInput');
  });
});

// ---------------------------------------------------------------------------
// buildPlanResponse
// ---------------------------------------------------------------------------

describe('buildPlanResponse', () => {
  const planEntry = entry({ toolName: 'ExitPlanMode', toolUseId: 'tu1', requestId: 'r1' });

  it("kind='approve' with executionMode='yolo' and clearContext=true includes both fields", () => {
    const res = buildPlanResponse(planEntry, { kind: 'approve', executionMode: 'yolo', clearContext: true });
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      executionMode: 'yolo',
      clearContext: true,
    });
  });

  it("kind='approve' with executionMode='default' and clearContext=false omits clearContext key", () => {
    const res = buildPlanResponse(planEntry, { kind: 'approve', executionMode: 'default', clearContext: false });
    expect(res).toMatchObject({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'allow',
      executionMode: 'default',
    });
    expect(res).not.toHaveProperty('clearContext');
  });

  it("kind='revise' returns behavior:'deny' with message trimmed from feedback", () => {
    const res = buildPlanResponse(planEntry, { kind: 'revise', feedback: '  please redo  ' });
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'deny',
      message: 'please redo',
    });
  });
});
