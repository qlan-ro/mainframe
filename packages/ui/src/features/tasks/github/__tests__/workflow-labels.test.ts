/**
 * workflow-labels.test.ts
 *
 * `isWorkflowLabel`/`partitionLabels` take the denylist as a parameter
 * instead of restating it — these tests pin that a caller's set, not a
 * baked-in list, decides what gets withheld (finding #6, todo #286).
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowLabelSet } from '@/lib/api/todos-github';
import { isWorkflowLabel, partitionLabels, withheldLabelsSentence } from '../workflow-labels';

const SET: WorkflowLabelSet = {
  prefixes: ['route:', 'gate:'],
  labels: ['ready-for-agent'],
};

describe('isWorkflowLabel', () => {
  it('matches an exact reserved label', () => {
    expect(isWorkflowLabel('ready-for-agent', SET)).toBe(true);
  });

  it('matches a reserved prefix', () => {
    expect(isWorkflowLabel('route:no-spec', SET)).toBe(true);
  });

  it('does not match a label outside the given set, even if some other set would reserve it', () => {
    expect(isWorkflowLabel('wontfix', SET)).toBe(false);
  });
});

describe('partitionLabels', () => {
  it('splits labels into syncable and withheld using only the given set', () => {
    const result = partitionLabels(['bug', 'route:no-spec', 'ready-for-agent'], SET);
    expect(result).toEqual({ syncable: ['bug'], withheld: ['route:no-spec', 'ready-for-agent'] });
  });

  it('withholds nothing for an empty set', () => {
    const result = partitionLabels(['bug', 'route:no-spec'], { prefixes: [], labels: [] });
    expect(result).toEqual({ syncable: ['bug', 'route:no-spec'], withheld: [] });
  });
});

describe('withheldLabelsSentence', () => {
  it('is empty when nothing is withheld', () => {
    expect(withheldLabelsSentence([])).toBe('');
  });

  it('names a single withheld label with singular wording', () => {
    expect(withheldLabelsSentence(['wontfix'])).toBe(
      "1 workflow label stays local — wontfix. Mainframe's pipeline labels are never published and never accepted back from GitHub.",
    );
  });
});
