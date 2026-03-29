import { useEffect } from 'react';
import { usePluginLayoutStore } from '../store/plugins';

/**
 * App-level shortcuts that always take precedence over plugin shortcuts.
 * Uses the 'mod+key' format where 'mod' = Cmd on Mac, Ctrl elsewhere.
 */
const APP_SHORTCUTS = new Set([
  'mod+n', // New chat
  'mod+,', // Settings
  'mod+f', // Search palette
  'mod+o', // Search palette (alias)
]);

function toModKey(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'meta' || key === 'control') return null;
  const parts: string[] = [];
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  parts.push(key);
  return `mod+${parts.join('+')}`;
}

export function usePluginShortcuts(): void {
  const actions = usePluginLayoutStore((s) => s.actions);

  useEffect(() => {
    if (actions.length === 0) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const modKey = toModKey(e);
      if (!modKey) return;

      // App shortcuts always win
      if (APP_SHORTCUTS.has(modKey)) return;

      const match = actions.find((a) => a.shortcut === modKey);
      if (match) {
        e.preventDefault();
        e.stopPropagation();
        usePluginLayoutStore.getState().triggerAction(match.pluginId, match.id);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [actions]);
}
