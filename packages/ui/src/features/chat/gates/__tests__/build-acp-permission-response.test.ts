/**
 * build-acp-permission-response — behavior tests for the ACP facade's
 * `session/request_permission` answer builders.
 *
 * Strategy:
 *  - All expected values are hardcoded; no logic is duplicated from the
 *    functions under test.
 *
 * Behaviors covered:
 *  - buildAcpSelection / buildAcpCancelled: bare outcome shapes.
 *  - buildAcpRichAnswer: wraps a ControlResponse under
 *    `_meta["_mainframe.dev"].controlResponse` alongside the plain outcome.
 *  - buildAcpAskUserQuestionAnswer: spreads original input, appends answers key.
 *  - buildAcpAlwaysAllowAnswer: original input plus updatedPermissions from
 *    caller-supplied suggestions.
 *  - buildAcpPlanAnswer: executionMode always present, clearContext key
 *    present only when true.
 */
import { describe, it, expect } from 'vitest';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import {
  buildAcpSelection,
  buildAcpCancelled,
  buildAcpRichAnswer,
  buildAcpAskUserQuestionAnswer,
  buildAcpAlwaysAllowAnswer,
  buildAcpPlanAnswer,
  type AcpControlBase,
} from '../build-acp-permission-response';

const BASE: AcpControlBase = { requestId: 'r1', toolUseId: 'tu1', toolName: 'Bash' };

const SUG: ControlUpdate = {
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent: 'git:*' }],
  behavior: 'allow',
  destination: 'session',
};

describe('buildAcpSelection', () => {
  it('returns the plain selected outcome with no _meta key', () => {
    const res = buildAcpSelection('allow-once');
    expect(res).toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    expect(res).not.toHaveProperty('_meta');
  });
});

describe('buildAcpCancelled', () => {
  it('returns the bare cancelled outcome', () => {
    expect(buildAcpCancelled()).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('buildAcpRichAnswer', () => {
  it('wraps the given ControlResponse under _meta["_mainframe.dev"].controlResponse', () => {
    const controlResponse = { ...BASE, behavior: 'allow' as const, updatedInput: { cmd: 'ls' } };
    const res = buildAcpRichAnswer('allow-once', controlResponse);
    expect(res).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
      _meta: { '_mainframe.dev': { controlResponse } },
    });
  });
});

describe('buildAcpAskUserQuestionAnswer', () => {
  it('spreads original input and appends the answers key inside the rich controlResponse', () => {
    const res = buildAcpAskUserQuestionAnswer(
      BASE,
      'allow-once',
      { questions: ['Pick a format'] },
      { 'Pick a format': 'MP4' },
    );
    expect(res).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
      _meta: {
        '_mainframe.dev': {
          controlResponse: {
            ...BASE,
            behavior: 'allow',
            updatedInput: { questions: ['Pick a format'], answers: { 'Pick a format': 'MP4' } },
          },
        },
      },
    });
  });
});

describe('buildAcpAlwaysAllowAnswer', () => {
  it('includes updatedInput and updatedPermissions from the caller-supplied suggestions', () => {
    const res = buildAcpAlwaysAllowAnswer(BASE, 'allow-always', { cmd: 'ls' }, [SUG]);
    expect(res).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-always' },
      _meta: {
        '_mainframe.dev': {
          controlResponse: { ...BASE, behavior: 'allow', updatedInput: { cmd: 'ls' }, updatedPermissions: [SUG] },
        },
      },
    });
  });
});

describe('buildAcpPlanAnswer', () => {
  it('clearContext=true includes the clearContext key', () => {
    const res = buildAcpPlanAnswer(BASE, 'allow-once', { cmd: 'ls' }, 'yolo', true);
    expect(res).toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
      _meta: {
        '_mainframe.dev': {
          controlResponse: {
            ...BASE,
            behavior: 'allow',
            updatedInput: { cmd: 'ls' },
            executionMode: 'yolo',
            clearContext: true,
          },
        },
      },
    });
  });

  it('clearContext=false omits the clearContext key', () => {
    const res = buildAcpPlanAnswer(BASE, 'allow-once', { cmd: 'ls' }, 'default', false);
    const controlResponse = res._meta?.['_mainframe.dev'] as { controlResponse: Record<string, unknown> };
    expect(controlResponse.controlResponse).not.toHaveProperty('clearContext');
  });
});
