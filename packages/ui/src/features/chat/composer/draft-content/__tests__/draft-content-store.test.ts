import { beforeEach, describe, expect, it } from 'vitest';
import {
  draftItemsOf,
  forgetSentCaptures,
  holdSentCaptures,
  restoreSentCapture,
  useDraftContent,
  type DraftCapture,
  type NewDraftItem,
} from '../draft-content-store';

const CODE: NewDraftItem = {
  kind: 'code',
  filePath: 'src/quota.rs',
  startLine: 3,
  endLine: 5,
  lineContent: 'let a = 1;',
  note: '',
};
const SHOT: NewDraftItem = { kind: 'capture', type: 'screenshot', imageDataUrl: 'data:image/png;base64,AA', note: 'n' };
const capture = (id: string): DraftCapture => ({ ...SHOT, id }) as DraftCapture;
const store = () => useDraftContent.getState();

beforeEach(() => useDraftContent.setState({ byThread: {} }));

describe('useDraftContent', () => {
  it('keeps each draft its own items, in the order they were added', () => {
    store().add('t1', [CODE]);
    store().add('t2', [SHOT]);
    store().add('t1', [SHOT]);
    expect(draftItemsOf('t1').map((item) => item.kind)).toEqual(['code', 'capture']);
    expect(draftItemsOf('t2').map((item) => item.kind)).toEqual(['capture']);
    expect(draftItemsOf('t3')).toEqual([]);
  });

  it('changes one note, and removes one item, without touching the others', () => {
    store().add('t1', [CODE, SHOT]);
    const [code, shot] = draftItemsOf('t1');
    store().setNote('t1', code!.id, 'Keep resets_at');
    expect(draftItemsOf('t1').map((item) => item.note)).toEqual(['Keep resets_at', 'n']);
    store().remove('t1', code!.id);
    expect(draftItemsOf('t1')).toEqual([shot]);
  });

  it('gives two items added at once ids of their own', () => {
    store().add('t1', [SHOT, SHOT]);
    expect(new Set(draftItemsOf('t1').map((item) => item.id)).size).toBe(2);
  });

  it('clears one draft', () => {
    store().add('t1', [CODE]);
    store().add('t2', [CODE]);
    store().clear('t1');
    expect(draftItemsOf('t1')).toEqual([]);
    expect(draftItemsOf('t2')).toHaveLength(1);
  });
});

describe('captures a send has taken', () => {
  it('return to the draft they came from, whole, ahead of what was added since', () => {
    holdSentCaptures('t1', [capture('c1')]);
    store().add('t1', [CODE]);
    expect(restoreSentCapture('c1')).toBe(true);
    expect(draftItemsOf('t1')[0]).toEqual({ ...SHOT, id: 'c1' });
    expect(draftItemsOf('t1')).toHaveLength(2);
    expect(draftItemsOf('t2')).toEqual([]);
  });

  it('return once, however many times a failure is reported', () => {
    holdSentCaptures('t1', [capture('c2')]);
    restoreSentCapture('c2');
    expect(restoreSentCapture('c2')).toBe(true);
    expect(draftItemsOf('t1')).toHaveLength(1);
  });

  it('are let go once the send went through', () => {
    holdSentCaptures('t1', [capture('c3')]);
    forgetSentCaptures(['c3']);
    expect(restoreSentCapture('c3')).toBe(false);
    expect(draftItemsOf('t1')).toEqual([]);
  });

  it('are not mistaken for a file', () => {
    expect(restoreSentCapture('some-file')).toBe(false);
  });
});
