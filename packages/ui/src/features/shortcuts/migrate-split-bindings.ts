import { chordHolder, effectiveBindings } from './effective-bindings';
import type { Binding, Overrides } from './keybindings-store';
import { isMacPlatform } from './platform';
import { SHORTCUTS } from './registry';

const renamedIds = [
  ['sessions.open-in-split', 'sessions.open-beside'],
  ['sessions.close-split', 'sessions.close-beside'],
] as const;

function isBinding(value: unknown): value is Binding {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const chord = value as Record<string, unknown>;
  return (
    typeof chord.code === 'string' &&
    /^[A-Za-z][A-Za-z0-9]*$/.test(chord.code) &&
    Object.entries(chord).every(
      ([key, flag]) => key === 'code' || (['mod', 'ctrl', 'alt', 'shift'].includes(key) && typeof flag === 'boolean'),
    )
  );
}

export function migrateSplitBindings(overrides: unknown): Overrides {
  const next: Overrides =
    overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? Object.fromEntries(Object.entries(overrides).filter(([, value]) => isBinding(value)))
      : {};
  const isMac = isMacPlatform();

  const moved: string[] = [];
  for (const [oldId, newId] of renamedIds) {
    const chord = next[oldId];
    delete next[oldId];
    if (chord === undefined || Object.prototype.hasOwnProperty.call(next, newId)) continue;
    next[newId] = chord;
    if (chord) moved.push(newId);
  }

  const bindings = effectiveBindings(SHORTCUTS, next);
  for (const id of moved) {
    const chord = next[id];
    if (chord && chordHolder(bindings, chord, isMac, id)) next[id] = null;
  }
  return next;
}
