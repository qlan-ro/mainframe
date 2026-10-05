/**
 * AutomationsHost — now just the ⌘⇧A shortcut wiring. The library itself
 * lives in the body (`AutomationsSurface`, mounted while `sidebarView` is
 * 'automations', D1/D5) and the sidebar (`AutomationsSidebarList`); the
 * always-on concerns (toasts, WS patches, the pending-interaction load) stay
 * in `AutomationsRuntime`. Renders nothing.
 */
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { useAutomationsNav } from './data/use-automations-nav';

export function AutomationsHost(): null {
  const openHost = useAutomationsNav((s) => s.openHost);
  // The registry's `dev` flag is the only gate on ⌘⇧A now — the dispatcher
  // filters dev entries out of production builds at its one mount site.
  useShortcutAction('app.automations', openHost);
  return null;
}
