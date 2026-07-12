/**
 * useAutomationEvents — daemonWs.onEvent singleton subscription, patching the
 * automations store from the five `automation.*` WS events (contract §4).
 * Mirrors the v1 `use-workflows-events.ts` precedent by subscribing directly
 * to `daemonWs` rather than `gateway.onEvent` — unlike `use-automation-
 * toasts.ts` (backend-agnostic so toast copy renders against the fixture
 * gateway too), store patches only matter once a live daemon exists to patch
 * from, so this goes straight to the singleton.
 *
 * `automation.completed`/`automation.notification` are switched on (per the
 * contract's five events) but patch nothing: `use-automation-toasts.ts` owns
 * their user-facing behavior, and a completed run's terminal status already
 * lands via `automation.run.updated` — `finalizeAndEmit` (interpreter.ts)
 * emits it before `onRunFinalized` fires the completion event.
 */
import { useEffect } from 'react';
import { daemonWs } from '@/lib/daemon/ws-client';
import type { DaemonEvent } from '../contract';
import { useAutomationsStore } from './use-automations-store';

export function useAutomationEvents(): void {
  useEffect(() => {
    const s = useAutomationsStore.getState();
    return daemonWs.onEvent((event: DaemonEvent) => {
      switch (event.type) {
        case 'automation.run.updated':
          s.patchRun(event.run);
          break;
        case 'automation.interaction.created':
          s.addInteraction(event.interaction);
          break;
        case 'automation.interaction.resolved':
          s.resolveInteraction(event.interactionId);
          break;
        case 'automation.completed':
        case 'automation.notification':
          break;
        default:
          break;
      }
    });
  }, []);
}
