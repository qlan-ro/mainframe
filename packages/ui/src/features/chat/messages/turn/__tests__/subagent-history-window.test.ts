import { beforeEach, describe, expect, it } from 'vitest';
import {
  historyKey,
  loadSubagentPage,
  loadSubagentTarget,
  releaseSubagentHistory,
  useSubagentHistoryStore,
} from '../subagent-history-store';
import { SUBAGENT_PAGES_KEPT, firstWindow, landNewer, landOlder, newerCursor, olderCursor } from '../subagent-window';
import { PAGE, fakeSubagentPager } from './subagent-pager';

const key = historyKey('chat', 'agent');
const entry = () => useSubagentHistoryStore.getState().entries.get(key)!;
const ids = () => entry().messages.map((message) => message.id);
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `m${from + i}`);

beforeEach(() => releaseSubagentHistory('chat'));

describe('the page window', () => {
  it('pages up from the newest page and drops the newest once full', () => {
    let window = firstWindow('f3', true);
    expect(olderCursor(window)).toEqual({ before: 'f3' });
    expect(newerCursor(window)).toBeNull();
    for (const floor of ['f2', 'f1']) window = landOlder(window, floor, true).window;
    const full = landOlder(window, 'f0', false);
    expect(full.dropFrom).toBe('f3');
    expect(full.window).toEqual({ floors: ['f0', 'f1', 'f2', 'f3'], top: 0, bottom: 2, start: true });
    expect(olderCursor(full.window)).toBeNull();
    // The newest page is the one the daemon cuts from the end.
    expect(newerCursor(full.window)).toEqual({});
  });

  it('brings a dropped page back exactly, and drops the oldest for it', () => {
    const window = { floors: ['f0', 'f1', 'f2', 'f3', 'f4'], top: 0, bottom: 2, start: true };
    expect(newerCursor(window)).toEqual({ before: 'f4', until: 'f3' });
    const landed = landNewer(window, 'f3')!;
    expect(landed).toEqual({ window: { ...window, top: 1, bottom: 3 }, dropBefore: 'f1' });
    expect(olderCursor(landed.window)).toEqual({ before: 'f1', until: 'f0' });
    expect(landNewer(window, 'elsewhere')).toBeNull();
  });

  it('starts the floors again from a page it did not know', () => {
    const window = { floors: ['f0', 'f1', 'f2'], top: 1, bottom: 2, start: true };
    expect(landOlder(window, 'target', true).window).toEqual({
      floors: ['target', 'f1', 'f2'],
      top: 0,
      bottom: 2,
      start: false,
    });
  });
});

describe('a long sub-agent', () => {
  it('holds a bounded window while paging all the way up and back down', async () => {
    const total = PAGE * 12;
    const { request } = fakeSubagentPager(total);
    await loadSubagentPage(key, request);
    expect(ids()).toEqual(range(total - PAGE, total));
    let peak = 0;
    for (let page = 1; page < 12; page++) {
      await loadSubagentPage(key, request, 'older');
      peak = Math.max(peak, entry().messages.length, entry().accumulator.itemsInOrder.length);
    }
    expect(peak).toBe(SUBAGENT_PAGES_KEPT * PAGE);
    expect(ids()).toEqual(range(0, SUBAGENT_PAGES_KEPT * PAGE));
    expect(entry()).toMatchObject({ before: undefined, later: true });
    while (entry().later) {
      await loadSubagentPage(key, request, 'newer');
      expect(entry().messages.length).toBeLessThanOrEqual(SUBAGENT_PAGES_KEPT * PAGE);
    }
    expect(ids()).toEqual(range(total - SUBAGENT_PAGES_KEPT * PAGE, total));
    // Every page came back exactly: a page above is refetched with its own floor.
    expect(request).toHaveBeenLastCalledWith(undefined);
    expect(request.mock.calls).toContainEqual([`m${PAGE * 4}`, `m${PAGE * 3}`]);
  });

  it('pages up again over pages it dropped from the top', async () => {
    const { request } = fakeSubagentPager(PAGE * 6);
    await loadSubagentPage(key, request);
    for (let page = 0; page < 5; page++) await loadSubagentPage(key, request, 'older');
    await loadSubagentPage(key, request, 'newer');
    await loadSubagentPage(key, request, 'newer');
    expect(ids()).toEqual(range(PAGE * 2, PAGE * 5));
    request.mockClear();
    await loadSubagentPage(key, request, 'older');
    expect(request).toHaveBeenCalledExactlyOnceWith(`m${PAGE * 2}`, `m${PAGE}`);
    expect(ids()).toEqual(range(PAGE, PAGE * 4));
  });

  it('finds a target below a window whose newest pages were dropped', async () => {
    const { request } = fakeSubagentPager(PAGE * 8);
    await loadSubagentPage(key, request);
    for (let page = 0; page < 5; page++) await loadSubagentPage(key, request, 'older');
    expect(entry().later).toBe(true);
    const target = `m${PAGE * 6 + 3}`;
    await loadSubagentTarget(key, request, target, target);
    expect(ids()).toContain(target);
    expect(ids()).toEqual(range(PAGE * 6 + 3, PAGE * 8));
    expect(entry().later).toBe(false);
  });

  it('finds a target above the window with one page up to it', async () => {
    const { request } = fakeSubagentPager(PAGE * 8);
    await loadSubagentPage(key, request);
    const target = `m${PAGE * 2 + 5}`;
    await loadSubagentTarget(key, request, target, target);
    expect(request).toHaveBeenLastCalledWith(`m${PAGE * 7}`, target);
    expect(ids()[0]).toBe(target);
    expect(ids()).toHaveLength(PAGE * 8 - (PAGE * 2 + 5));
  });
});
