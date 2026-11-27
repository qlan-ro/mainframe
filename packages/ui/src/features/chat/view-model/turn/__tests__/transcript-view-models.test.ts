import { describe, expect, it } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { TranscriptViewModels, type ViewModelInputs } from '../transcript-view-models';
import { assistant, bash, scope, text, user } from './fixtures';

const window1 = (): ThreadMessage[] => [
  user('u1', 'first'),
  assistant('a1', [bash('ls'), text('Listed')]),
  user('u2', 'second'),
  assistant('a2', [text('Done')]),
];

const inputs = (messages: readonly ThreadMessage[], overrides: Partial<ViewModelInputs> = {}): ViewModelInputs => ({
  messages,
  scope: scope(),
  presentation: 'fold',
  ...overrides,
});

/** A watched owner whose window change can be fired from the test. */
function watchedCache(budget?: number) {
  const fire = new Map<object, () => void>();
  const stopped: object[] = [];
  const cache = new TranscriptViewModels({
    budget,
    watch: (owner, changed) => {
      fire.set(owner, changed);
      return () => stopped.push(owner);
    },
  });
  return { cache, fire: (owner: object) => fire.get(owner)?.(), stopped };
}

describe('transcript view models', () => {
  it('gives a chat its own model back after a switch away and back', () => {
    const cache = new TranscriptViewModels();
    const chat = {};
    const messages = window1();
    const release = cache.hold(chat, 'root');
    const model = cache.model(chat, 'root', inputs(messages));
    release();
    cache.hold(chat, 'root');
    // The projection hands back a new array of the same messages: same window, same model.
    expect(cache.model(chat, 'root', inputs([...messages]))).toBe(model);
  });

  it('rebuilds when the window changes, keeping the turns that did not', () => {
    const cache = new TranscriptViewModels();
    const chat = {};
    const messages = window1();
    cache.hold(chat, 'root');
    const before = cache.model(chat, 'root', inputs(messages));
    const next = [...messages.slice(0, 3), assistant('a2', [text('Done, and more')])];
    const after = cache.model(chat, 'root', inputs(next));
    expect(after).not.toBe(before);
    expect(after.slices.get('a2')?.answer[0]?.part).toMatchObject({ text: 'Done, and more' });
    expect(after.slices.get('a1')).toBe(before.slices.get('a1'));
  });

  it('rebuilds for another scope or other display settings', () => {
    const cache = new TranscriptViewModels();
    const chat = {};
    const messages = window1();
    const model = cache.model(chat, 'root', inputs(messages));
    expect(cache.model(chat, 'root', inputs(messages, { presentation: 'open' }))).not.toBe(model);
    const running = cache.model(
      chat,
      'root',
      inputs(messages, { presentation: 'open', scope: scope({ isRunning: true }) }),
    );
    expect(running.runningKey).toBeDefined();
  });

  it('keeps views of one chat apart', () => {
    const cache = new TranscriptViewModels();
    const chat = {};
    const messages = window1();
    const column = cache.model(chat, 'column', inputs(messages));
    const other = cache.model(chat, 'other', inputs(messages, { scope: scope({ rootThreadId: 'other' }) }));
    expect(other).not.toBe(column);
    expect(cache.model(chat, 'column', inputs(messages))).toBe(column);
  });

  it('drops a chat nobody shows when its window changes (an older page, a trim, a jump window)', () => {
    const { cache, fire, stopped } = watchedCache();
    const chat = {};
    const messages = window1();
    const release = cache.hold(chat, 'root');
    const model = cache.model(chat, 'root', inputs(messages));
    release();
    fire(chat);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(stopped).toEqual([chat]);
    // Coming back builds anew: no row from the old window survives.
    expect(cache.model(chat, 'root', inputs(messages))).not.toBe(model);
  });

  it('rebuilds a shown chat after its window changes, keeping row identity for what did not change', () => {
    const { cache, fire } = watchedCache();
    const chat = {};
    const messages = window1();
    cache.hold(chat, 'root');
    const before = cache.model(chat, 'root', inputs(messages));
    fire(chat);
    const older = [user('u0', 'older'), assistant('a0', [text('Older reply')]), ...messages];
    const after = cache.model(chat, 'root', inputs(older));
    expect(after.slices.get('a0')).toBeDefined();
    // An older page re-renders only its own rows.
    expect(after.slices.get('a2')).toBe(before.slices.get('a2'));
  });

  it('drops what a disposed chat had, shown or not', () => {
    const { cache, stopped } = watchedCache();
    const chat = {};
    cache.hold(chat, 'root');
    cache.model(chat, 'root', inputs(window1()));
    cache.release(chat);
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(stopped).toEqual([chat]);
  });

  it('stays within its budget, evicting the least recently used chat nobody shows', () => {
    const one = {};
    const two = {};
    const three = {};
    const probe = new TranscriptViewModels();
    probe.model(one, 'root', inputs(window1()));
    const entry = probe.bytes;
    const cache = new TranscriptViewModels({ budget: entry * 2 });
    const shown = cache.hold(three, 'root');
    cache.model(three, 'root', inputs(window1()));
    cache.model(one, 'root', inputs(window1()));
    cache.model(two, 'root', inputs(window1()));
    expect(cache.bytes).toBeLessThanOrEqual(entry * 2);
    expect(cache.size).toBe(2);
    // The shown chat stays; `one` was the oldest idle entry.
    const kept = window1();
    const model = cache.model(two, 'root', inputs(kept));
    expect(cache.model(two, 'root', inputs(kept))).toBe(model);
    shown();
  });
});
