/**
 * The app-root half of the shortcut registry: the chords that work wherever
 * you are, because the shell that owns them is always mounted. Chat- and
 * workspace-scoped chords register in their own surfaces instead, so they go
 * inert when that surface unmounts.
 *
 * Each action is exactly what the window listener it replaced did — settings
 * opens its store directly (never the `open-settings` intent), matching the
 * ⌘, handler this hook retires.
 */
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useSettingsStore } from '@/store/settings';
import { toggleCheatSheet } from '@/features/shortcuts/cheat-sheet-store';
import { useShortcutAction } from '@/features/shortcuts/action-store';

export function useAppShortcutActions({ onNewSession }: { onNewSession: () => void }): void {
  useShortcutAction('sessions.new', onNewSession);
  useShortcutAction('app.search-palette', () => emitSurfaceIntent({ type: 'open-search-palette' }));
  useShortcutAction('app.review', () => emitSurfaceIntent({ type: 'open-review' }));
  useShortcutAction('app.settings', () => useSettingsStore.getState().open());
  useShortcutAction('sessions.toggle-sidebar', () => emitSurfaceIntent({ type: 'toggle-sidebar' }));
  useShortcutAction('app.cheat-sheet', () => toggleCheatSheet());
}
