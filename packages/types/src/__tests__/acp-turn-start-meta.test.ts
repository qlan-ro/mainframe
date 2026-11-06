import { describe, expect, it } from 'vitest';
import { SessionUpdateSchema, UpdateSessionNotificationSchema } from '../acp/update.js';

function running(meta?: unknown) {
  return { sessionUpdate: 'state_update', state: 'running', ...(meta === undefined ? {} : { _meta: meta }) };
}

function startedAtMs(update: unknown): number | undefined {
  const parsed = SessionUpdateSchema.parse(update);
  if (parsed.sessionUpdate !== 'state_update' || parsed.state !== 'running') throw new Error('not a running update');
  return parsed._meta?.['_mainframe.dev']?.startedAtMs;
}

describe('running state_update turn start (_meta["_mainframe.dev"].startedAtMs)', () => {
  it('reads a non-negative integer epoch-ms start', () => {
    expect(startedAtMs(running({ '_mainframe.dev': { startedAtMs: 1_790_000_000_000 } }))).toBe(1_790_000_000_000);
  });

  it('accepts a running update with no _meta, or no start in it', () => {
    expect(startedAtMs(running())).toBeUndefined();
    expect(startedAtMs(running({}))).toBeUndefined();
    expect(startedAtMs(running({ '_mainframe.dev': {} }))).toBeUndefined();
  });

  it.each([
    ['negative', -1],
    ['fractional', 12.5],
    ['a string', '1790000000000'],
    ['null', null],
    ['beyond the safe-integer range', 2 ** 60],
    ['not finite', Number.POSITIVE_INFINITY],
  ])('drops a malformed start (%s) instead of rejecting the update', (_label, value) => {
    expect(startedAtMs(running({ '_mainframe.dev': { startedAtMs: value } }))).toBeUndefined();
  });

  it('drops a malformed namespace value or _meta without failing the frame', () => {
    expect(startedAtMs(running({ '_mainframe.dev': 'garbage' }))).toBeUndefined();
    expect(startedAtMs(running('garbage'))).toBeUndefined();
  });

  it('keeps other namespaces and sibling keys it does not model', () => {
    const parsed = SessionUpdateSchema.parse(
      running({ other: { a: 1 }, '_mainframe.dev': { startedAtMs: 5, future: true } }),
    );
    expect(parsed).toMatchObject({ _meta: { other: { a: 1 }, '_mainframe.dev': { startedAtMs: 5, future: true } } });
  });

  it('parses inside a full session/update notification', () => {
    const result = UpdateSessionNotificationSchema.safeParse({
      sessionId: 'chat_1',
      update: running({ '_mainframe.dev': { startedAtMs: 7 } }),
    });
    expect(result.success).toBe(true);
  });

  it('does not touch idle updates', () => {
    const parsed = SessionUpdateSchema.parse({ sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    expect(parsed).toMatchObject({ state: 'idle', stopReason: 'end_turn' });
  });
});
