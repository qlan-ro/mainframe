/**
 * The Automations view's header row (details only, 2026-10 redesign):
 * `AutomationsView` renders a slot element and provides it here; `AutomationDetails`
 * portals the open automation's name, run-status suffix and actions into it
 * instead of drawing a second title row of its own. A portal, not lifted
 * state, so Details keeps owning its own handlers. The editor and Describe
 * draw their own self-contained header bars and never use this slot.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const AutomationsHeaderSlot = createContext<HTMLElement | null>(null);

export function AutomationsHeaderPortal({ children }: { children: ReactNode }) {
  const target = useContext(AutomationsHeaderSlot);
  return target == null ? null : createPortal(children, target);
}
