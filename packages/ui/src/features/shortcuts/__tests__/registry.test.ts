/**
 * The registry and its conflict guard. The registry is declarative data (no
 * feature is allowed to register a second entry under a chord already taken —
 * AC 9), and `visibleShortcuts` is the one dev-gate the cheat sheet and the
 * dispatcher both read (AC 16).
 */
import { describe, expect, it } from 'vitest';
import type { ShortcutDescriptor } from '../shortcut-types';
import { findChordConflicts } from '../conflicts';
import { SHORTCUTS, shortcutById, visibleShortcuts } from '../registry';

const VALID_GROUPS = ['Sessions', 'Chat', 'Workspace', 'App'];

describe('SHORTCUTS — well-formedness', () => {
  it('has no chord conflicts on macOS (AC 9)', () => {
    expect(findChordConflicts(SHORTCUTS, true)).toEqual([]);
  });

  it('has no chord conflicts off macOS (AC 9)', () => {
    expect(findChordConflicts(SHORTCUTS, false)).toEqual([]);
  });

  it('declares every id exactly once', () => {
    const ids = SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares every entry under one of the four groups', () => {
    expect(SHORTCUTS.every((entry) => VALID_GROUPS.includes(entry.group))).toBe(true);
  });

  it('gives every entry a non-empty label', () => {
    expect(SHORTCUTS.every((entry) => entry.label.trim().length > 0)).toBe(true);
  });
});

describe('findChordConflicts — the guard itself', () => {
  it('reports a deliberately duplicated chord as a conflict pair', () => {
    const fixture: ShortcutDescriptor[] = [
      { id: 'fixture.a', chord: { code: 'KeyZ', mod: true }, label: 'A', group: 'App' },
      { id: 'fixture.b', chord: { code: 'KeyZ', mod: true }, label: 'B', group: 'App' },
      { id: 'fixture.c', chord: { code: 'KeyY', mod: true }, label: 'C', group: 'App' },
    ];

    const conflicts = findChordConflicts(fixture, true);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.slice().sort()).toEqual(['fixture.a', 'fixture.b']);
  });

  it('reports no conflicts when every chord is distinct', () => {
    const fixture: ShortcutDescriptor[] = [
      { id: 'fixture.a', chord: { code: 'KeyZ', mod: true }, label: 'A', group: 'App' },
      { id: 'fixture.b', chord: { code: 'KeyY', mod: true }, label: 'B', group: 'App' },
    ];

    expect(findChordConflicts(fixture, true)).toEqual([]);
  });
});

describe('visibleShortcuts — AC 16', () => {
  it('excludes the dev-only entry when dev is false', () => {
    const visible = visibleShortcuts(SHORTCUTS, { dev: false });
    expect(visible.some((entry) => entry.id === 'app.automations')).toBe(false);
  });

  it('includes the dev-only entry when dev is true', () => {
    const visible = visibleShortcuts(SHORTCUTS, { dev: true });
    expect(visible.some((entry) => entry.id === 'app.automations')).toBe(true);
  });

  it('accepts a fixture set the app does not ship (AC 15 seam)', () => {
    const fixture: ShortcutDescriptor[] = [
      { id: 'fixture.public', chord: { code: 'KeyZ', mod: true }, label: 'Public', group: 'App' },
      { id: 'fixture.dev', chord: { code: 'KeyY', mod: true }, label: 'Dev', group: 'App', dev: true },
    ];

    expect(visibleShortcuts(fixture, { dev: false }).map((e) => e.id)).toEqual(['fixture.public']);
    expect(visibleShortcuts(fixture, { dev: true }).map((e) => e.id)).toEqual(['fixture.public', 'fixture.dev']);
  });
});

describe('shortcutById — compile-time id safety', () => {
  it('looks up a real entry by id', () => {
    expect(shortcutById('sessions.new').id).toBe('sessions.new');
  });

  it('rejects an unknown id at compile time', () => {
    // @ts-expect-error unknown shortcut id — ShortcutId is derived from SHORTCUTS, not `string`
    shortcutById('app.nope');
  });
});
