import { expect, it } from 'vitest';
import { groupSteps } from '../group-steps';
import type { ToolPart, TurnUnit } from '../types';
import { bash, call } from './fixtures';

const unit = (part: ToolPart): TurnUnit => ({ key: part.toolCallId, messageId: 'm', index: 0, part });
const read = (id: string, overrides = {}) => unit(call('Read', { file_path: id }, { toolCallId: id, ...overrides }));
const shape = (units: TurnUnit[], open = false) =>
  groupSteps(units, new Set(), open).map((step) => (step.type === 'explore' ? step.units.map((u) => u.key) : step.key));
const four = () => ['a', 'b', 'c', 'd'].map((id) => read(id));

it('folds a run of four, keyed by its first step', () => {
  const steps = groupSteps(four(), new Set());
  expect(steps).toHaveLength(1);
  expect(steps[0]).toMatchObject({ type: 'explore', key: 'a' });
});

it('leaves three as rows', () => expect(shape(four().slice(0, 3))).toEqual(['a', 'b', 'c']));

it('ends a run at any other step, and at one that did not succeed', () => {
  const run = unit(bash('ls', { toolCallId: 'run' }));
  expect(shape([...four(), run, read('e')])).toEqual([['a', 'b', 'c', 'd'], 'run', 'e']);
  const [a, b, c] = four() as [TurnUnit, TurnUnit, TurnUnit];
  expect(shape([a, b, read('bad', { isError: true }), c])).toEqual(['a', 'b', 'bad', 'c']);
});

it('does not fold a run the turn may still add to', () => {
  expect(shape(four(), true)).toEqual(['a', 'b', 'c', 'd']);
  expect(shape([...four(), unit(bash('ls', { toolCallId: 'run' }))], true)).toEqual([['a', 'b', 'c', 'd'], 'run']);
});
