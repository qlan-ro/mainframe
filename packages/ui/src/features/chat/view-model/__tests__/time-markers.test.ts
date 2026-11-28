import { describe, expect, it } from 'vitest';
import { hasTimeMarker, timeMarker } from '../time-markers';

const at = (iso: string) => ({ createdAt: new Date(iso) });
const NOW = new Date('2026-11-24T20:00:00');
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

describe('timeMarker', () => {
  it('opens the conversation with its day and time', () => {
    expect(timeMarker([at('2026-11-24T11:18:00')], 0, true, NOW)).toBe(`Today, ${clock('2026-11-24T11:18:00')}`);
    expect(timeMarker([at('2026-11-23T11:18:00')], 0, true, NOW)).toBe(`Yesterday, ${clock('2026-11-23T11:18:00')}`);
  });

  it('says nothing at the top of a window that has earlier messages', () => {
    expect(timeMarker([at('2026-11-24T11:18:00')], 0, false, NOW)).toBeNull();
  });

  it('marks a gap of 30 minutes, not a shorter one', () => {
    const start = at('2026-11-24T11:00:00');
    expect(timeMarker([start, at('2026-11-24T11:29:59')], 1, true, NOW)).toBeNull();
    expect(timeMarker([start, at('2026-11-24T11:30:00')], 1, true, NOW)).toBe(clock('2026-11-24T11:30:00'));
  });

  it('marks a new day even without a gap', () => {
    const marker = timeMarker([at('2026-11-23T23:59:00'), at('2026-11-24T00:01:00')], 1, true, NOW);
    expect(marker).toBe(`Today, ${clock('2026-11-24T00:01:00')}`);
  });

  it('names an older day by its date, with the year once it differs', () => {
    expect(timeMarker([at('2026-11-02T09:00:00')], 0, true, NOW)).toContain('2');
    expect(timeMarker([at('2025-11-02T09:00:00')], 0, true, NOW)).toContain('2025');
  });

  it('is silent without a usable time or when times run backwards', () => {
    expect(timeMarker([{}], 0, true, NOW)).toBeNull();
    expect(timeMarker([at('2026-11-24T12:00:00'), at('2026-11-24T11:00:00')], 1, true, NOW)).toBeNull();
  });
});

describe('hasTimeMarker', () => {
  it('says a marker shows exactly where timeMarker draws one at the start of the conversation', () => {
    const times = [
      '2026-11-23T23:50:00',
      '2026-11-23T23:59:00',
      '2026-11-24T00:01:00',
      '2026-11-24T00:20:00',
      '2026-11-24T00:50:00',
      '2026-11-24T00:40:00',
      '2026-11-24T01:19:59',
      '2026-11-26T09:00:00',
    ].map(at);
    const messages = [...times.slice(0, 3), {}, ...times.slice(3)];
    for (let index = 0; index < messages.length; index++)
      expect(hasTimeMarker(messages, index)).toBe(timeMarker(messages, index, true, NOW) !== null);
  });
});
