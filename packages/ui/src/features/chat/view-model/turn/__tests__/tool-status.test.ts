import { describe, expect, it } from 'vitest';
import { resolveToolStatus, settledStatus, wasCancelled } from '../tool-status';
import type { ToolPart, TurnUnit } from '../types';
import { presented, tool } from './fixtures';

it('keeps a partial result active despite native completion', () => {
  expect(
    resolveToolStatus(
      tool({ result: 'partial', providerMetadata: { mainframe: { acpStatus: 'in_progress' } } }),
      new Set(),
    ),
  ).toBe('running');
});

it.each([
  ['completed', 'success'],
  ['failed', 'failed'],
  ['cancelled', 'stopped'],
  ['pending', 'running'],
] as const)('respects explicit %s with empty output', (acpStatus, expected) => {
  expect(resolveToolStatus(tool({ providerMetadata: { mainframe: { acpStatus } } }), new Set())).toBe(expected);
});

it.each([
  [{ result: '' }, 'success'],
  [{ result: 'failed' }, 'success'],
  [{ result: { isError: true } }, 'failed'],
  [{ isError: true, result: 'passed' }, 'failed'],
  [{}, 'unknown'],
  [{ status: { type: 'running' }, result: 'partial' }, 'running'],
  [{ status: { type: 'incomplete', reason: 'cancelled' }, result: '' }, 'stopped'],
  [{ status: { type: 'incomplete', reason: 'error' }, result: '' }, 'failed'],
  [{ status: { type: 'incomplete', reason: 'length' }, result: '' }, 'unknown'],
  [{ status: { type: 'requires-action', reason: 'interrupt' } }, 'unknown'],
] as const)('resolves native facts without guessing from prose: %j', (overrides, expected) => {
  expect(resolveToolStatus(tool(overrides), new Set())).toBe(expected);
});

it.each([
  [{ id: 'approval' }, 'awaiting-approval'],
  [{ id: 'approval', approved: false }, 'declined'],
  [{ id: 'approval', resolution: 'cancelled' }, 'stopped'],
  [{ id: 'approval', resolution: 'expired' }, 'stopped'],
  [{ id: 'approval', approved: true }, 'success'],
] as const)('respects native approval: %j', (approval, expected) => {
  expect(resolveToolStatus(tool({ approval, result: '' }), new Set())).toBe(expected);
});

it('gives correlated pending approval priority over all terminal facts', () => {
  expect(resolveToolStatus(tool({ isError: true, approval: { id: 'a', approved: false } }), new Set(['call']))).toBe(
    'awaiting-approval',
  );
});

it('gives explicit failure priority over completed lifecycle', () => {
  expect(
    resolveToolStatus(tool({ isError: true, providerMetadata: { mainframe: { acpStatus: 'completed' } } }), new Set()),
  ).toBe('failed');
});

it.each([null, [], 'completed', {}, { acpStatus: 'not-real' }])('ignores malformed lifecycle metadata: %j', (value) => {
  const part = tool({ providerMetadata: { mainframe: value } as never });
  expect(resolveToolStatus(part, new Set())).toBe('unknown');
});

describe('a call with no outcome', () => {
  const open = tool({ providerMetadata: { mainframe: { acpStatus: 'in_progress' } } });
  const none = new Set<string>();

  it('runs while its part can, and claims no end once nothing runs it', () => {
    expect(settledStatus(open, none, true)).toBe('running');
    expect(settledStatus(open, none, false)).toBe('unknown');
    expect(settledStatus(tool({ approval: { id: 'a' } }), none, false)).toBe('unknown');
  });

  it('is stopped only when something says its turn was', () => {
    expect(settledStatus(open, none, false, true)).toBe('stopped');
    expect(settledStatus(tool({ result: 'x' }), none, false, true)).toBe('success');
    expect(settledStatus(tool(), none, false, true)).toBe('unknown');
  });

  it('still waits on its own request', () => {
    expect(settledStatus(open, new Set(['call']), false, true)).toBe('awaiting-approval');
  });

  type Said = Partial<Pick<TurnUnit, 'presentation'> & Pick<ToolPart, 'status'>>;
  it.each<[string, string, Said, boolean]>([
    ['its provider turn was cancelled', 'Bash', { presentation: presented({ state: 'cancelled' }) }, true],
    ['its message was cancelled', 'Bash', { status: { type: 'incomplete', reason: 'cancelled' } }, true],
    ['its provider turn failed', 'Bash', { presentation: presented({ state: 'failed' }) }, false],
    ['its provider turn was cut', 'Bash', { presentation: presented({ state: 'invalid' }) }, false],
    ['nothing says', 'Bash', {}, false],
    // What it started may outlive the turn, and its own evidence says how that stands.
    ['it started an agent', 'Task', { presentation: presented({ state: 'cancelled' }) }, false],
    [
      'it delegated a task',
      'mcp__mainframe__delegate_task',
      { presentation: presented({ state: 'cancelled' }) },
      false,
    ],
    ['it started a workflow', 'Workflow', { presentation: presented({ state: 'cancelled' }) }, false],
  ])('is cancelled with its turn: %s', (_when, toolName, { presentation, status }, cancelled) => {
    const part = tool({ toolName, ...(status && { status }) });
    expect(wasCancelled({ part, presentation }, false)).toBe(cancelled);
  });

  it('is cancelled with the agent whose step it is', () => {
    expect(wasCancelled({ part: tool({ toolName: 'Bash' }) }, true)).toBe(true);
    expect(wasCancelled({ part: tool({ toolName: 'Task' }) }, true)).toBe(false);
  });
});
