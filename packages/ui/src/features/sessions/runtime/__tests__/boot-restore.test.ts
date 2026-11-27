// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatControllerRegistry } from '../chat-controller-registry';
import {
  BOOT_HOLD_MAX_MS,
  beginBootRestore,
  decideBootRestore,
  isBootRestoring,
  resetBootRestore,
} from '../boot-restore';

let loadState: Record<string, string | undefined>;

beforeEach(() => {
  vi.useFakeTimers();
  resetBootRestore();
  loadState = {};
  vi.spyOn(chatControllerRegistry, 'get').mockImplementation(((id: string) =>
    loadState[id] == null ? undefined : { getState: () => ({ loadState: { type: loadState[id] } }) }) as never);
});

afterEach(() => {
  resetBootRestore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mountTranscript(chatId: string) {
  const el = document.createElement('div');
  el.setAttribute('data-mf-chat-thread', '');
  el.setAttribute('data-mf-chat-id', chatId);
  const box = { scrollHeight: 100, scrollTop: 0 };
  Object.defineProperty(el, 'scrollHeight', { get: () => box.scrollHeight });
  Object.defineProperty(el, 'scrollTop', { get: () => box.scrollTop, configurable: true });
  document.body.append(el);
  return { el, box };
}

describe('boot restore hold', () => {
  afterEach(() => void document.body.replaceChildren());

  it('does not hold before the daemon answers, so nothing else is affected', () => {
    expect(isBootRestoring()).toBe(false);
    decideBootRestore('chat-1');
    expect(isBootRestoring()).toBe(false);
  });

  it('holds from the first healthy connection', () => {
    beginBootRestore();
    expect(isBootRestoring()).toBe(true);
  });

  it('releases at once when there is nothing to restore: the welcome is then the right screen', () => {
    beginBootRestore();
    decideBootRestore(null);
    expect(isBootRestoring()).toBe(false);
  });

  it('keeps holding while the chosen chat has no history, and releases a beat after it is in', () => {
    beginBootRestore();
    decideBootRestore('chat-1');
    vi.advanceTimersByTime(500);
    expect(isBootRestoring()).toBe(true);

    loadState['chat-1'] = 'loading';
    vi.advanceTimersByTime(200);
    expect(isBootRestoring()).toBe(true);

    loadState['chat-1'] = 'ready';
    vi.advanceTimersByTime(16);
    expect(isBootRestoring()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(isBootRestoring()).toBe(false);
  });

  it('a failed history load ends the hold too: the thread shows its own error', () => {
    beginBootRestore();
    loadState['chat-1'] = 'error';
    decideBootRestore('chat-1');
    vi.advanceTimersByTime(100);
    expect(isBootRestoring()).toBe(false);
  });

  it('gives up at the deadline when the chat never loads', () => {
    beginBootRestore();
    decideBootRestore('chat-1');
    vi.advanceTimersByTime(BOOT_HOLD_MAX_MS - 1);
    expect(isBootRestoring()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isBootRestoring()).toBe(false);
  });

  it('gives up at the deadline when the list never answers', () => {
    beginBootRestore();
    vi.advanceTimersByTime(BOOT_HOLD_MAX_MS);
    expect(isBootRestoring()).toBe(false);
  });

  it('is once per page load: a later begin or decision does not hold again', () => {
    beginBootRestore();
    decideBootRestore(null);
    beginBootRestore();
    expect(isBootRestoring()).toBe(false);
  });

  it('a later decision replaces the one being watched', () => {
    beginBootRestore();
    decideBootRestore('a');
    decideBootRestore('b');
    loadState['a'] = 'ready';
    vi.advanceTimersByTime(200);
    expect(isBootRestoring()).toBe(true);
    loadState['b'] = 'ready';
    vi.advanceTimersByTime(200);
    expect(isBootRestoring()).toBe(false);
  });

  it('waits for the transcript to stop moving: rows arrive in pieces, then the thread pins to the end', () => {
    const { box } = mountTranscript('chat-1');
    beginBootRestore();
    loadState['chat-1'] = 'ready';
    decideBootRestore('chat-1');

    // History in, but the window keeps growing and the offset keeps catching up.
    for (const [height, top] of [
      [9000, 0],
      [11000, 8000],
      [11300, 10500],
    ] as const) {
      box.scrollHeight = height;
      box.scrollTop = top;
      vi.advanceTimersByTime(80);
      expect(isBootRestoring()).toBe(true);
    }

    // Quiet for the stable window: now it is shown.
    vi.advanceTimersByTime(200);
    expect(isBootRestoring()).toBe(false);
  });

  it('does not read a transcript as settled before the chat has loaded', () => {
    mountTranscript('chat-1');
    beginBootRestore();
    loadState['chat-1'] = 'loading';
    decideBootRestore('chat-1');
    vi.advanceTimersByTime(1000);
    expect(isBootRestoring()).toBe(true);
  });

  it('watches the decided chat’s transcript, not another one on screen (a side chat)', () => {
    const side = mountTranscript('side-1');
    mountTranscript('chat-1');
    beginBootRestore();
    loadState['chat-1'] = 'ready';
    decideBootRestore('chat-1');
    // The side chat is still loading rows; the main transcript is quiet.
    for (let i = 0; i < 8; i++) {
      side.box.scrollHeight += 500;
      vi.advanceTimersByTime(40);
    }
    expect(isBootRestoring()).toBe(false);
  });

  it('keeps holding while a restored side chat still shows its history spinner', () => {
    mountTranscript('chat-1');
    const spinner = document.createElement('div');
    spinner.setAttribute('data-testid', 'chat-thread-loading');
    document.body.append(spinner);
    beginBootRestore();
    loadState['chat-1'] = 'ready';
    decideBootRestore('chat-1');
    vi.advanceTimersByTime(1000);
    expect(isBootRestoring()).toBe(true);

    spinner.remove();
    vi.advanceTimersByTime(200);
    expect(isBootRestoring()).toBe(false);
  });
});
