/**
 * build-control-response — behavior tests for four pure builder functions:
 * buildPermissionResponse, buildOptionResponse, buildAskUserQuestionResponse,
 * and buildPlanResponse.
 *
 * Strategy:
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    functions under test.
 *
 * Behaviors covered:
 *  - buildPermissionResponse: deny, once (no updatedPermissions, even when the
 *    request carries suggestions — #283), always (with updatedPermissions from
 *    entry.request.suggestions).
 *  - buildOptionResponse: allow_once/allow_always/reject_once map through to
 *    the matching buildPermissionResponse kind regardless of optionId/name;
 *    an unrecognized kind resolves to deny (never guessed as approval).
 *  - buildAskUserQuestionResponse: with answers (spreads original input,
 *    appends answers key), without answers (behavior:'deny', no updatedInput).
 *  - buildPlanResponse: approve+yolo+clearContext, approve+default (no
 *    clearContext key), reject, revise (trims feedback into message).
 */
import { describe, it, expect } from 'vitest';
import type { ControlRequest, ControlUpdate, PermissionOption, PermissionOptionKind } from '@qlan-ro/mainframe-types';
import type { ChatPermissionEntry } from '../../controller/chat-thread-state';
import {
  buildPermissionResponse,
  buildAskUserQuestionResponse,
  buildPlanResponse,
  buildOptionResponse,
} from '../build-control-response';

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
  return { requestId: request.requestId, request, askedAt, options: [] };
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

  it("kind='once' omits updatedPermissions even when the request carries suggestions (#283)", () => {
    const res = buildPermissionResponse(entry({ suggestions: [SUG] }), 'once');
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
// buildOptionResponse
// ---------------------------------------------------------------------------

function option(kind: PermissionOptionKind, over: Partial<PermissionOption> = {}): PermissionOption {
  return { optionId: 'opt-x', name: 'Some Option', kind, ...over };
}

describe('buildOptionResponse', () => {
  it("kind='allow_once' returns the same response as buildPermissionResponse(e, 'once'), regardless of optionId/name", () => {
    const e = entry();
    const res = buildOptionResponse(e, option('allow_once', { optionId: 'anything', name: 'Whatever' }));
    expect(res).toEqual(buildPermissionResponse(e, 'once'));
  });

  it("kind='allow_always' returns the same response as buildPermissionResponse(e, 'always'), including suggestions", () => {
    const e = entry({ suggestions: [SUG] });
    const res = buildOptionResponse(e, option('allow_always'));
    expect(res).toEqual(buildPermissionResponse(e, 'always'));
  });

  it("kind='reject_once' returns the same response as buildPermissionResponse(e, 'deny')", () => {
    const e = entry();
    const res = buildOptionResponse(e, option('reject_once'));
    expect(res).toEqual(buildPermissionResponse(e, 'deny'));
  });

  it('an unrecognized kind resolves to deny rather than being guessed as an approval', () => {
    const e = entry();
    // A future/adapter-extension kind our vocabulary doesn't cover yet — cast
    // past the current 4-literal union to exercise the defensive fallback.
    const unknown = option('nonstandard_kind' as PermissionOptionKind);
    const res = buildOptionResponse(e, unknown);
    expect(res).toEqual(buildPermissionResponse(e, 'deny'));
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
      updatedInput: { cmd: 'ls' },
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
      updatedInput: { cmd: 'ls' },
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

  it("kind='reject' returns bare deny with requestId/toolUseId/toolName and no message field", () => {
    const res = buildPlanResponse(planEntry, { kind: 'reject' });
    expect(res).toEqual({
      requestId: 'r1',
      toolUseId: 'tu1',
      toolName: 'ExitPlanMode',
      behavior: 'deny',
    });
    expect(res).not.toHaveProperty('message');
  });
});
