import { describe, it, expect } from 'vitest';
import { toRunSummary } from '../../workflows/engine/engine.js';
import type { RunRecord } from '../../workflows/store/types.js';

function makeRun(over: Partial<RunRecord>): RunRecord {
  return {
    id: 'r1',
    workflowId: 'w1',
    definition: { version: 1, name: 'x', steps: [] } as any,
    status: 'running',
    triggerKind: 'manual',
    triggerPayload: null,
    inputs: {},
    outputs: null,
    parentRunId: null,
    parentStepPath: null,
    wakeAt: null,
    startedAt: 0,
    finishedAt: null,
    error: null,
    ...over,
  };
}

describe('toRunSummary banner', () => {
  it('waiting → Answer-now CTA', () => {
    const s = toRunSummary(makeRun({ status: 'waiting' }));
    expect(s.banner).toBe('Waiting for you…');
    expect(s.bannerCta).toEqual({ label: 'Answer now', action: 'answer' });
  });
  it('running → no banner', () => {
    const s = toRunSummary(makeRun({ status: 'running' }));
    expect(s.banner).toBeNull();
    expect(s.bannerCta).toBeNull();
  });
  it('failed → error head banner, no CTA', () => {
    const s = toRunSummary(makeRun({ status: 'failed', error: 'boom\ndetails' }));
    expect(s.banner).toBe('Failed — boom');
    expect(s.bannerCta).toBeNull();
  });
});
