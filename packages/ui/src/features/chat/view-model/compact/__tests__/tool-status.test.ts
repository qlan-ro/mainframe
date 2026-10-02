import { expect, it } from 'vitest';
import { resolveToolStatus } from '../tool-status';
import { tool } from './fixtures';

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
