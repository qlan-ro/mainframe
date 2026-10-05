/**
 * The Automations view's ONE header row hosts its sub-views' crumb and actions:
 * `AutomationsView` renders a slot element after the "Workflows" crumb and
 * provides it here; a sub-view (details today) portals "› <name>", its tabs and
 * its actions into that row instead of drawing a second title row of its own.
 * A portal, not lifted state, so a sub-view keeps owning its own handlers.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const AutomationsHeaderSlot = createContext<HTMLElement | null>(null);

export function AutomationsHeaderPortal({ children }: { children: ReactNode }) {
  const target = useContext(AutomationsHeaderSlot);
  return target == null ? null : createPortal(children, target);
}
