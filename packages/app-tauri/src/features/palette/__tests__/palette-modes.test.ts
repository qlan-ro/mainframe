import { describe, it, expect } from 'vitest';
import { parseQuery } from '../palette-modes';

describe('parseQuery', () => {
  it('defaults to file mode and trims the term', () => {
    expect(parseQuery('  layout ')).toEqual({
      mode: 'file',
      term: 'layout',
      chip: null,
      placeholder: 'Search files…  · type > commands  @ symbols  # changes',
    });
  });

  it('> selects command mode and strips the prefix', () => {
    const r = parseQuery('> rev');
    expect(r.mode).toBe('cmd');
    expect(r.term).toBe('rev');
    expect(r.chip).toBe('Commands');
    expect(r.placeholder).toBe('Run a command…');
  });

  it('@ selects symbol mode', () => {
    const r = parseQuery('@useLayout');
    expect(r.mode).toBe('sym');
    expect(r.term).toBe('useLayout');
    expect(r.chip).toBe('Symbols');
  });

  it('# selects changes mode', () => {
    const r = parseQuery('#Side');
    expect(r.mode).toBe('chg');
    expect(r.term).toBe('Side');
    expect(r.chip).toBe('Changes');
  });

  it('a lone prefix yields an empty term', () => {
    expect(parseQuery('>').term).toBe('');
  });
});
