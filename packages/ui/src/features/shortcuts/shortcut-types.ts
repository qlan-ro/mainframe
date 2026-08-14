/**
 * The shortcut registry's type contract — shared by the chord matcher, the
 * cheat sheet and the registry itself. Pure types only: no store, no React,
 * no `navigator` reads (those live in `platform.ts`).
 */

export interface Chord {
  /** `KeyboardEvent.code` — the physical key ('KeyN', 'Digit1', 'Backslash', 'Comma', 'Slash', 'Tab'). */
  code: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /** Literal Control, independent of platform. */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** A chord that resolves differently per platform (⌃1 on macOS, Alt+1 off it). */
export type PlatformChord = Chord | { mac: Chord; other: Chord };

/** The four flags a `Chord` resolves to for the live platform, exact-matched
 *  against a keydown event. */
export interface ResolvedChord {
  code: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type ShortcutGroup = 'Sessions' | 'Chat' | 'Workspace' | 'App';

export interface ShortcutDescriptor {
  /** Stays `string` so a test can pass a fixture entry the app does not ship (AC 15). */
  id: string;
  chord: PlatformChord | readonly PlatformChord[];
  label: string;
  group: ShortcutGroup;
  /** Absent from production builds and the production cheat sheet. */
  dev?: boolean;
  /** Stands down when the keystroke came from inside the code editor. */
  editorYielding?: boolean;
}

/** `chordIndex` is the position of the matched chord in a multi-chord entry (D3). */
export type ShortcutAction = (chordIndex: number) => void;
