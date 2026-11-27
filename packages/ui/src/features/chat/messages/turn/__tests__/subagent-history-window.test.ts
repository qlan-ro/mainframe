import { beforeEach, describe, expect, it } from 'vitest';
import {
  historyKey,
  loadSubagentPage,
  loadSubagentTarget,
  releaseSubagentHistory,
  useSubagentHistoryStore,
  type RequestPage,
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

  it('keeps the message object of every row a page leaves untouched, so those rows do not render again', async () => {
    const { request } = fakeSubagentPager(PAGE * 6);
    await loadSubagentPage(key, request);
    const held = new Map(entry().messages.map((message) => [message.id, message]));
    await loadSubagentPage(key, request, 'older');
    for (const message of entry().messages.slice(PAGE)) expect(message).toBe(held.get(message.id));
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
});

describe('Find in a bounded window', () => {
  const total = PAGE * 50;
  const pages = () => entry().window.bottom - entry().window.top + 1;
  const find = (request: RequestPage, n: number) => loadSubagentTarget(key, request, `m${n}`, `m${n}`);

  /** The reader paged far up a 2,000-step agent: m160 to m279 held, the newest pages dropped. */
  async function pagedUp() {
    const pager = fakeSubagentPager(total);
    await loadSubagentPage(key, pager.request);
    for (let page = 0; page < 45; page++) await loadSubagentPage(key, pager.request, 'older');
    expect(ids()).toEqual(range(160, 280));
    expect(entry().later).toBe(true);
    pager.request.mockClear();
    return pager.request;
  }

  it('loads the page up to a match just above the window, and stays within three pages', async () => {
    const request = await pagedUp();
    await find(request, 155);
    expect(request).toHaveBeenCalledExactlyOnceWith('m160', 'm155');
    expect(ids()).toEqual(range(155, 240));
    expect(pages()).toBeLessThanOrEqual(SUBAGENT_PAGES_KEPT);
  });

  it('brings dropped pages back one at a time for a match just below, and stays within three pages', async () => {
    const request = await pagedUp();
    await find(request, 285);
    // The daemon's empty page says the match is not above; one newer page holds it.
    expect(request.mock.calls).toEqual([
      ['m160', 'm285'],
      ['m320', 'm280'],
    ]);
    expect(ids()).toEqual(range(200, 320));
    expect(pages()).toBeLessThanOrEqual(SUBAGENT_PAGES_KEPT);
  });

  it('holds at most three pages for a match far above: the page up to it, and two below', async () => {
    const request = await pagedUp();
    await find(request, 10);
    expect(ids()).toEqual(range(10, 240));
    expect(pages()).toBe(SUBAGENT_PAGES_KEPT);
    expect(entry().messages.length).toBeLessThan(260);
  });

  it('does not seek a match the transcript does not have twice in a row', async () => {
    const request = await pagedUp();
    await find(request, total + 5);
    request.mockClear();
    await find(request, total + 5);
    expect(request).not.toHaveBeenCalled();
  });

  it('finds a match again after the window moved on from it', async () => {
    const request = await pagedUp();
    await find(request, 300); // below: brought back, and the seek is remembered on the entry
    expect(ids()).toContain('m300');
    await find(request, 10); // far above
    for (let page = 0; page < 2; page++) await loadSubagentPage(key, request, 'older');
    expect(ids()).not.toContain('m300');
    expect(entry().target).toBeUndefined();
    await find(request, 300);
    expect(ids()).toContain('m300');
    expect(pages()).toBeLessThanOrEqual(SUBAGENT_PAGES_KEPT);
  });
});
