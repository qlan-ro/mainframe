/**
 * AutomationsRuntime — the always-mounted half of automations: toasts for the
 * "you should know" events, the WS-driven store patches, and the
 * pending-interaction load that feeds the nav rail's dot. Lives in AppShell
 * beside the modal host so none of it depends on the modal ever opening.
 * Renders nothing.
 */
import { useEffect } from 'react';
import { useAutomationEvents } from './data/use-automation-events';
import { useAutomationToasts } from './data/use-automation-toasts';
import { useAutomationsStore } from './data/use-automations-store';

export function AutomationsRuntime(): null {
  const loadInteractions = useAutomationsStore((s) => s.loadInteractions);
  useAutomationToasts();
  useAutomationEvents();
  useEffect(() => {
    void loadInteractions();
  }, [loadInteractions]);
  return null;
}
