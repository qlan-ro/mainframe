import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import { FILL_MAX_PAGES, useFillShortWindow } from '../use-fill-short-window';
import { TranscriptScrollProvider } from '../transcript-scroll-context';

/** A viewport 500 tall whose content height the test sets; `load` lands a page of `page` px. */
let viewport: HTMLDivElement;
let height: number;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
const state = { chatId: 'a', floor: 'f0', hasMore: true, busy: false, following: true, locked: false };
let landed = 0;
let load: Mock<(target?: string) => Promise<boolean>>;
let page = 300;
let view: ReturnType<typeof render>;

function Probe() {
  useFillShortWindow(state.chatId, load, state.hasMore, state.busy, state.floor);
  return null;
}
function mount() {
  const controller = {
    viewportElement: { current: viewport },
    isFollowing: () => state.following,
    isInteracting: () => state.locked,
    beginInteraction: () => () => {},
  };
  return (
    <TranscriptScrollProvider value={controller}>
      <Probe />
    </TranscriptScrollProvider>
  );
}
const rerender = () => view.rerender(mount());
function run() {
  const due = [...frames.values()];
  frames.clear();
  due.forEach((callback) => callback(0));
}
function settle() {
  // Three equal-height frames end the settle wait and run the check.
  for (let i = 0; i < 5; i++) act(() => run());
}
/** A page lands the way the plane does: the floor moves and the content grows. */
async function land() {
  await act(async () => {
    landed++;
    height += page;
    state.floor = `f${landed}`;
    rerender();
  });
}

beforeEach(() => {
  frames = new Map();
  landed = 0;
  page = 300;
  height = 600;
  Object.assign(state, { chatId: 'a', floor: 'f0', hasMore: true, busy: false, following: true, locked: false });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  viewport = document.createElement('div');
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 },
    scrollHeight: { get: () => height },
  });
  document.body.append(viewport);
  load = vi.fn(async () => true);
  view = render(mount());
});
afterEach(() => {
  vi.unstubAllGlobals();
  viewport.remove();
});

it('fills a short window page by page until it is tall enough', async () => {
  settle();
  expect(load).toHaveBeenCalledTimes(1);
  await land();
  settle();
  expect(load).toHaveBeenCalledTimes(2);
  await land();
  settle();
  expect(height).toBe(1200);
  await land();
  settle();
  expect(height).toBe(1500);
  expect(load).toHaveBeenCalledTimes(3);
});

it('stops when the chat has no earlier history', () => {
  state.hasMore = false;
  rerender();
  settle();
  expect(load).not.toHaveBeenCalled();
});

it('stops at the cap of automatic pages', async () => {
  page = 10;
  settle();
  for (let i = 0; i < FILL_MAX_PAGES; i++) {
    await land();
    settle();
  }
  // The last page landed and the content is still short: the cap holds.
  expect(load).toHaveBeenCalledTimes(FILL_MAX_PAGES);
  settle();
  expect(load).toHaveBeenCalledTimes(FILL_MAX_PAGES);
});

it('starts a fresh count after a page the reader asked for', async () => {
  page = 10;
  settle();
  for (let i = 0; i < FILL_MAX_PAGES; i++) {
    await land();
    settle();
  }
  expect(load).toHaveBeenCalledTimes(FILL_MAX_PAGES);
  // The reader's own page lands without the fill having asked for it.
  state.busy = true;
  rerender();
  await act(async () => {
    state.busy = false;
    landed++;
    state.floor = `f${landed}`;
    rerender();
  });
  settle();
  expect(load).toHaveBeenCalledTimes(FILL_MAX_PAGES + 1);
});

it('does not fill once the reader has left the bottom or while a lock is held', async () => {
  state.following = false;
  settle();
  expect(load).not.toHaveBeenCalled();
  state.following = true;
  state.locked = true;
  await land();
  settle();
  expect(load).not.toHaveBeenCalled();
});

it('waits for the height to settle while the list measures its rows', () => {
  for (let i = 0; i < 4; i++) {
    height += 50;
    act(() => run());
  }
  expect(load).not.toHaveBeenCalled();
  settle();
  expect(load).toHaveBeenCalledTimes(1);
});

it('does not fill a window that is already tall', () => {
  height = 1300;
  settle();
  expect(load).not.toHaveBeenCalled();
});

it('does not retry the same floor after a page that added nothing', async () => {
  load.mockResolvedValue(false);
  settle();
  await act(async () => rerender());
  settle();
  expect(load).toHaveBeenCalledTimes(1);
});

it('cancels the fill in flight when the session switches', () => {
  act(() => run());
  state.chatId = 'b';
  state.floor = 'g0';
  rerender();
  // Only the new chat's settle runs: the old chat's pending frames are cancelled.
  settle();
  expect(load).toHaveBeenCalledTimes(1);
});
