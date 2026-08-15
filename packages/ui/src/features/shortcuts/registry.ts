/**
 * The single source of truth for every app-level shortcut. Declarative data
 * only — no store, intent or React import (D4): handlers register separately
 * via `useShortcutAction`, so a chord with no registered handler is inert.
 */
import type { ShortcutDescriptor } from './shortcut-types';

/** ⌘1…⌘9 (Ctrl+1…9 off macOS), one chord per session-tab index. No platform
 *  split: the digits belong to the tabs on every platform now that the surface
 *  toggles have moved off them. */
const TAB_BY_INDEX_CHORDS = Array.from({ length: 9 }, (_, i) => ({
  code: `Digit${i + 1}`,
  mod: true,
}));

export const SHORTCUTS = [
  { id: 'sessions.new', chord: { code: 'KeyN', mod: true }, label: 'New session', group: 'Sessions' },
  {
    id: 'sessions.tab-by-index',
    // ⌘1…⌘9 is the platform's "switch to the Nth tab" (Safari, VS Code, Slack),
    // and session tabs are that. The surface toggles held these digits first but
    // have no such convention behind them, so they moved to ⌘⇧C / ⌘⇧E rather
    // than keep the chord issue #374 asked for.
    chord: TAB_BY_INDEX_CHORDS,
    label: 'Switch to tab N',
    group: 'Sessions',
  },
  {
    id: 'sessions.tab-next',
    chord: { code: 'Tab', ctrl: true },
    label: 'Next session tab',
    group: 'Sessions',
  },
  {
    id: 'sessions.tab-prev',
    chord: { code: 'Tab', ctrl: true, shift: true },
    label: 'Previous session tab',
    group: 'Sessions',
  },
  {
    id: 'sessions.open-in-split',
    chord: { code: 'Backslash', mod: true, shift: true },
    label: 'Open in split',
    group: 'Sessions',
    editorYielding: true,
  },
  {
    id: 'sessions.close-split',
    chord: { code: 'Backslash', mod: true },
    label: 'Close split',
    group: 'Sessions',
  },
  {
    id: 'sessions.toggle-sidebar',
    chord: { code: 'KeyB', mod: true },
    label: 'Toggle sessions sidebar',
    group: 'Sessions',
  },
  { id: 'chat.find', chord: { code: 'KeyF', mod: true }, label: 'Find in chat', group: 'Chat', editorYielding: true },
  {
    id: 'chat.focus-composer',
    chord: { code: 'KeyL', mod: true },
    label: 'Focus composer',
    group: 'Chat',
    editorYielding: true,
  },
  {
    id: 'workspace.toggle-chat',
    chord: { code: 'KeyC', mod: true, shift: true },
    label: 'Toggle Chat surface',
    group: 'Workspace',
  },
  {
    id: 'workspace.toggle-workspace',
    // ⌘⇧W is free: the app menu registers ⌘W (Close Window) and, apart from
    // ⇧⌘Z, no shifted accelerator at all — so nothing intercepts this before
    // the webview. Worth knowing it sits one dropped Shift away from that
    // ⌘W, which closes the window.
    chord: { code: 'KeyW', mod: true, shift: true },
    label: 'Toggle Workspace surface',
    group: 'Workspace',
  },
  { id: 'app.search-palette', chord: { code: 'KeyO', mod: true }, label: 'Open command palette', group: 'App' },
  { id: 'app.review', chord: { code: 'KeyR', mod: true, shift: true }, label: 'Open review', group: 'App' },
  { id: 'app.settings', chord: { code: 'Comma', mod: true }, label: 'Open settings', group: 'App' },
  { id: 'app.quick-task', chord: { code: 'KeyT', mod: true, shift: true }, label: 'Quick add task', group: 'App' },
  {
    id: 'app.cheat-sheet',
    chord: { code: 'Slash', mod: true },
    label: 'Show keyboard shortcuts',
    group: 'App',
    editorYielding: true,
  },
  {
    id: 'app.automations',
    chord: { code: 'KeyA', mod: true, shift: true },
    label: 'Open automations',
    group: 'App',
    dev: true,
  },
] as const satisfies readonly ShortcutDescriptor[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

// `ShortcutId` is derived from `SHORTCUTS`, so a real id is always found — the
// lookup exists to give callers the descriptor, not to validate the id.
export function shortcutById(id: ShortcutId): ShortcutDescriptor {
  return SHORTCUTS.find((entry) => entry.id === id) as ShortcutDescriptor;
}

export function visibleShortcuts(
  entries: readonly ShortcutDescriptor[],
  { dev }: { dev: boolean },
): readonly ShortcutDescriptor[] {
  return dev ? entries : entries.filter((entry) => !entry.dev);
}
