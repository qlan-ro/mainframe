import { describe, it, expect } from 'vitest';
import { draftRowVisible, type DraftRowModel } from '../draft-row';

const model: DraftRowModel = { newThreadId: '__LOCALID_1', projectId: 'proj-a' };

describe('draftRowVisible', () => {
  it('is false when there is no draft', () => {
    expect(draftRowVisible(null, null)).toBe(false);
    expect(draftRowVisible(null, 'proj-a')).toBe(false);
  });

  it('is true in All view (no pill filter)', () => {
    expect(draftRowVisible(model, null)).toBe(true);
  });

  it('is true when the active pill matches the draft project', () => {
    expect(draftRowVisible(model, 'proj-a')).toBe(true);
  });

  it('is false when a different project pill is active', () => {
    expect(draftRowVisible(model, 'proj-b')).toBe(false);
  });
});
