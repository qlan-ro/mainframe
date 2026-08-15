/**
 * The override layer: defaults, rebinds, unassignment, and the steal.
 *
 * These are the rules the pane and the dispatcher both depend on, so they are
 * pinned here against fixtures rather than through either consumer.
 */
import { describe, expect, it } from 'vitest';
import type { ShortcutDescriptor } from '../shortcut-types';
import {
  bindWithSteal,
  chordHolder,
  dispatchableShortcuts,
  effectiveBindings,
  isRebindable,
} from '../effective-bindings';

const ENTRIES: ShortcutDescriptor[] = [
  { id: 'a.one', chord: { code: 'KeyO', mod: true }, label: 'One', group: 'App' },
  { id: 'a.two', chord: { code: 'KeyT', mod: true }, label: 'Two', group: 'App' },
  {
    id: 'a.family',
    chord: [
      { code: 'Digit1', mod: true },
      { code: 'Digit2', mod: true },
    ],
    label: 'Family',
    group: 'Sessions',
  },
];

const byId = (id: string) => ENTRIES.find((e) => e.id === id) as ShortcutDescriptor;

describe('isRebindable', () => {
  it('is false for a multi-chord family — one recorder cannot express nine chords', () => {
    expect(isRebindable(byId('a.one'))).toBe(true);
    expect(isRebindable(byId('a.family'))).toBe(false);
  });
});

describe('effectiveBindings', () => {
  it('uses the registry default when there is no override', () => {
    const [one] = effectiveBindings([byId('a.one')], {});

    expect(one?.isDefault).toBe(true);
    expect(one?.chord).toEqual({ code: 'KeyO', mod: true });
  });

  it('applies a rebind and marks it non-default', () => {
    const [one] = effectiveBindings([byId('a.one')], { 'a.one': { code: 'KeyK', mod: true } });

    expect(one?.isDefault).toBe(false);
    expect(one?.chord).toEqual({ code: 'KeyK', mod: true });
  });

  it('treats a null override as unassigned, not as absent', () => {
    const [one] = effectiveBindings([byId('a.one')], { 'a.one': null });

    expect(one?.chord).toBeNull();
    expect(one?.isDefault).toBe(false);
  });

  it('ignores an override aimed at a multi-chord family', () => {
    const [family] = effectiveBindings([byId('a.family')], { 'a.family': { code: 'KeyZ', mod: true } });

    expect(family?.isDefault).toBe(true);
    expect(family?.chord).toEqual(byId('a.family').chord);
  });
});

describe('dispatchableShortcuts', () => {
  it('drops an unassigned action so its old chord stops firing', () => {
    const ids = dispatchableShortcuts(ENTRIES, { 'a.one': null }).map((e) => e.id);

    expect(ids).toEqual(['a.two', 'a.family']);
  });

  it('hands the dispatcher the rebound chord, not the default', () => {
    const entry = dispatchableShortcuts(ENTRIES, { 'a.one': { code: 'KeyK', mod: true } }).find(
      (e) => e.id === 'a.one',
    );

    expect(entry?.chord).toEqual({ code: 'KeyK', mod: true });
  });
});

describe('chordHolder', () => {
  const bindings = effectiveBindings(ENTRIES, {});

  it('names the action already answering to a chord', () => {
    expect(chordHolder(bindings, { code: 'KeyT', mod: true }, true, 'a.one')?.id).toBe('a.two');
  });

  it('ignores the action doing the asking', () => {
    expect(chordHolder(bindings, { code: 'KeyO', mod: true }, true, 'a.one')).toBeNull();
  });

  it('finds a holder inside a multi-chord family', () => {
    expect(chordHolder(bindings, { code: 'Digit2', mod: true }, true, 'a.one')?.id).toBe('a.family');
  });

  it('returns null for a free chord', () => {
    expect(chordHolder(bindings, { code: 'KeyQ', mod: true, shift: true }, true, 'a.one')).toBeNull();
  });
});

describe('bindWithSteal', () => {
  it('binds a free chord without touching anyone else', () => {
    const next = bindWithSteal({}, ENTRIES, 'a.one', { code: 'KeyQ', mod: true }, true);

    expect(next).toEqual({ 'a.one': { code: 'KeyQ', mod: true } });
  });

  it('unassigns the previous holder rather than leaving two claims', () => {
    const next = bindWithSteal({}, ENTRIES, 'a.one', { code: 'KeyT', mod: true }, true);

    expect(next['a.one']).toEqual({ code: 'KeyT', mod: true });
    expect(next['a.two']).toBeNull();
  });

  it('leaves the loser unassigned, not back on its default — that would re-create the conflict', () => {
    const next = bindWithSteal({}, ENTRIES, 'a.one', { code: 'KeyT', mod: true }, true);
    const bindings = effectiveBindings(ENTRIES, next);

    expect(bindings.find((b) => b.entry.id === 'a.two')?.chord).toBeNull();
    expect(chordHolder(bindings, { code: 'KeyT', mod: true }, true, 'a.one')).toBeNull();
  });
});
