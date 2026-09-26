import { describe, it, expect } from 'vitest';
import { draftRowVisible, type DraftRowModel } from '../draft-row';

const model: DraftRowModel = { newThreadId: '__LOCALID_1', projectId: 'proj-a' };

describe('draftRowVisible', () => {
  it('is false when there is no draft', () => {
    expect(draftRowVisible(null, new Set())).toBe(false);
    expect(draftRowVisible(null, new Set(['proj-a']))).toBe(false);
  });

  it('is true in All view (empty scope)', () => {
    expect(draftRowVisible(model, new Set())).toBe(true);
  });

  it('is true when the scope contains the draft project', () => {
    expect(draftRowVisible(model, new Set(['proj-a']))).toBe(true);
  });

  it('is true when the scope contains the draft project among others', () => {
    expect(draftRowVisible(model, new Set(['proj-b', 'proj-a']))).toBe(true);
  });

  it('is false when the scope names only a different project', () => {
    expect(draftRowVisible(model, new Set(['proj-b']))).toBe(false);
  });

  it('is false when the scope names several projects, none of them the draft project', () => {
    expect(draftRowVisible(model, new Set(['proj-b', 'proj-c']))).toBe(false);
  });
});

describe('draftRowVisible — a "No project" draft (todo #346)', () => {
  const noProjectModel: DraftRowModel = { newThreadId: '__LOCALID_1', projectId: null };

  it('is true in All view (empty scope)', () => {
    expect(draftRowVisible(noProjectModel, new Set())).toBe(true);
  });

  it('is false under ANY active project pill — a no-project draft never matches one', () => {
    expect(draftRowVisible(noProjectModel, new Set(['proj-a']))).toBe(false);
  });
});
