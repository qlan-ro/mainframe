/**
 * Where registry defaults and user overrides become one answer.
 *
 * Everything that spells or dispatches a chord reads through here — the
 * dispatcher, the cheat sheet, `chordHint` — so a rebind reaches the toolbar
 * hint and the palette in the same render. Splitting that was what let the
 * sidebar advertise ⌘\ against a ⌘B binding.
 */
import { chordKey, chordList, resolveChord } from './chord';
import type { Chord, PlatformChord, ShortcutDescriptor } from './shortcut-types';
import type { Overrides } from './keybindings-store';

/**
 * A multi-chord entry is ONE action holding nine chords (⌘1…⌘9). A single
 * recorder cannot express that, so the family stays at its defaults for now
 * rather than pretending otherwise in the UI.
 */
export function isRebindable(entry: ShortcutDescriptor): boolean {
  return !Array.isArray(entry.chord);
}

export interface EffectiveBinding {
  entry: ShortcutDescriptor;
  /** `null` when the user left this action unassigned. */
  chord: ShortcutDescriptor['chord'] | null;
  /** False once a user override is in play — what drives the Reset affordance. */
  isDefault: boolean;
  rebindable: boolean;
}

export function effectiveBindings(entries: readonly ShortcutDescriptor[], overrides: Overrides): EffectiveBinding[] {
  return entries.map((entry) => {
    const rebindable = isRebindable(entry);
    // `hasOwnProperty`, not a truthy check: `null` is a real value here
    // (unassigned) and must not read as "no override".
    const overridden = rebindable && Object.prototype.hasOwnProperty.call(overrides, entry.id);
    if (!overridden) return { entry, chord: entry.chord, isDefault: true, rebindable };
    return { entry, chord: overrides[entry.id] ?? null, isDefault: false, rebindable };
  });
}

/** The dispatcher's view: the entries that currently have a chord to match. */
export function dispatchableShortcuts(
  entries: readonly ShortcutDescriptor[],
  overrides: Overrides,
): ShortcutDescriptor[] {
  return effectiveBindings(entries, overrides)
    .filter((binding) => binding.chord !== null)
    .map((binding) => ({ ...binding.entry, chord: binding.chord as ShortcutDescriptor['chord'] }));
}

/** Every resolved chord key an effective binding currently answers to. */
function keysOf(binding: EffectiveBinding, isMac: boolean): string[] {
  if (binding.chord === null) return [];
  const entry = { ...binding.entry, chord: binding.chord } as ShortcutDescriptor;
  return chordList(entry).map((chord) => chordKey(resolveChord(chord, isMac)));
}

/**
 * Which action already answers to `chord`, ignoring `selfId`. The recorder
 * needs the holder by name — "⌘K is already Open command palette" beats
 * "that chord is taken".
 */
export function chordHolder(
  bindings: readonly EffectiveBinding[],
  chord: Chord,
  isMac: boolean,
  selfId: string,
): ShortcutDescriptor | null {
  const key = chordKey(resolveChord(chord as PlatformChord, isMac));
  const hit = bindings.find((binding) => binding.entry.id !== selfId && keysOf(binding, isMac).includes(key));
  return hit?.entry ?? null;
}

/**
 * Bind `id` to `chord`, unassigning whoever held it — the "use it anyway"
 * steal. Pure: the caller hands the result to the store.
 *
 * The loser becomes explicitly unassigned rather than dropping back to its
 * default, which would silently recreate the very conflict the steal resolved.
 */
export function bindWithSteal(
  overrides: Overrides,
  entries: readonly ShortcutDescriptor[],
  id: string,
  chord: Chord,
  isMac: boolean,
): Overrides {
  const holder = chordHolder(effectiveBindings(entries, overrides), chord, isMac, id);
  const next: Overrides = { ...overrides, [id]: chord };
  if (holder) next[holder.id] = null;
  return next;
}
