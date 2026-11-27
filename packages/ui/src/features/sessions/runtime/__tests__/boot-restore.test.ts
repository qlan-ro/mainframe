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

/** A transcript in the chat column (`main`) or a workspace tab (a side chat). jsdom has no layout: set the box by hand. */
function mountTranscript(chatId: string | null, where: 'main' | 'side' = 'main') {
  const host = document.createElement('div');
  if (where === 'main') host.setAttribute('data-surface', 'chat');
  const el = document.createElement('div');
  el.setAttribute('data-mf-chat-thread', '');
  if (chatId != null) el.setAttribute('data-mf-chat-id', chatId);
  const box = { scrollHeight: 100, scrollTop: 0, clientHeight: 100 };
  for (const key of ['scrollHeight', 'scrollTop', 'clientHeight'] as const) {
    Object.defineProperty(el, key, { get: () => box[key], configurable: true });
  }
  host.append(el);
  document.body.append(host);
  return { el, host, box };
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

  it('waits for the history, then releases a beat after it is in when no transcript is mounted at all', () => {
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

  it('the deadline is short: a slow restore shows the app within 1.5 s', () => {
    expect(BOOT_HOLD_MAX_MS).toBeLessThanOrEqual(1500);
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

  describe('the transcript on screen', () => {
    it('waits for the first pin to land at the tail: rows arrive in pieces and the offset trails them', () => {
      const { box } = mountTranscript('chat-1');
      beginBootRestore();
      loadState['chat-1'] = 'ready';
      decideBootRestore('chat-1');

      // Window grew, offset still at the top: not pinned.
      box.scrollHeight = 9000;
      box.scrollTop = 0;
      vi.advanceTimersByTime(200);
      expect(isBootRestoring()).toBe(true);

      // Pinned for a poll or two is not enough...
      box.scrollTop = 8900;
      vi.advanceTimersByTime(32);
      expect(isBootRestoring()).toBe(true);
      // ...a growth under it resets the count.
      box.scrollHeight = 11000;
      vi.advanceTimersByTime(48);
      expect(isBootRestoring()).toBe(true);
      box.scrollTop = 10900;
      vi.advanceTimersByTime(100);
      expect(isBootRestoring()).toBe(false);
    });

    it('counts two px short of the end as the tail', () => {
      const { box } = mountTranscript('chat-1');
      beginBootRestore();
      loadState['chat-1'] = 'ready';
      box.scrollHeight = 1000;
      box.scrollTop = 898;
      decideBootRestore('chat-1');
      vi.advanceTimersByTime(100);
      expect(isBootRestoring()).toBe(false);
    });

    it('does not wait for a running turn to go quiet: a streaming transcript that sits at its tail is shown', () => {
      const { box } = mountTranscript('chat-1');
      beginBootRestore();
      loadState['chat-1'] = 'ready';
      box.scrollHeight = 5000;
      box.scrollTop = 4900;
      decideBootRestore('chat-1');
      // Each poll the stream appends a line and the pin follows it.
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(16);
        box.scrollHeight += 20;
        box.scrollTop += 20;
      }
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

    it('loaded before the transcript mounts: keeps waiting while the column still holds the draft welcome', () => {
      // assistant-ui switches threads asynchronously: the chat is loaded, the column shows a draft.
      const draft = mountTranscript(null);
      beginBootRestore();
      loadState['chat-1'] = 'ready';
      decideBootRestore('chat-1');
      vi.advanceTimersByTime(400);
      expect(isBootRestoring()).toBe(true);

      // Another chat's transcript is not this one either.
      draft.el.setAttribute('data-mf-chat-id', 'other');
      vi.advanceTimersByTime(400);
      expect(isBootRestoring()).toBe(true);

      // The switch lands: this chat's transcript mounts, pinned.
      draft.host.remove();
      mountTranscript('chat-1');
      vi.advanceTimersByTime(100);
      expect(isBootRestoring()).toBe(false);
    });

    it('watches the decided chat’s transcript in the chat column, not a side chat’s', () => {
      const side = mountTranscript('side-1', 'side');
      side.box.scrollHeight = 9000; // never at its tail
      mountTranscript('chat-1');
      beginBootRestore();
      loadState['chat-1'] = 'ready';
      decideBootRestore('chat-1');
      vi.advanceTimersByTime(100);
      expect(isBootRestoring()).toBe(false);
    });

    it('does not wait for a side chat’s spinner', () => {
      mountTranscript('chat-1');
      const spinner = document.createElement('div');
      spinner.setAttribute('data-testid', 'chat-thread-loading');
      document.body.append(spinner);
      beginBootRestore();
      loadState['chat-1'] = 'ready';
      decideBootRestore('chat-1');
      vi.advanceTimersByTime(100);
      expect(isBootRestoring()).toBe(false);
    });
  });
});
