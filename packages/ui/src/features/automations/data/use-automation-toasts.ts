/**
 * useAutomationToasts — toast notifications for the two "you should know
 * about this" automation events, ported from the v1 `use-workflows-toasts.ts`
 * precedent but subscribing through `gateway.onEvent` (backend-agnostic —
 * the fixture gateway's local emitter today, Phase 6's http-gateway
 * wrapping `daemonWs.onEvent` behind the same shape tomorrow) instead of
 * `daemonWs.onEvent` directly.
 *
 * Mount once, unconditionally (in `AutomationsHost`, ahead of its open/close
 * early return), so notifications fire even while the panel is closed.
 *
 * Events handled:
 *   automation.notification → mfToast; a chat-carrying notification gets the
 *     native "Open session" CTA (`chatId`), otherwise a "View run" action —
 *     `action` takes precedence over `chatId` in `WsToastCard`, so only one
 *     of the two is ever set.
 *   automation.completed    → mfToast.success/error by status, always with
 *     a "View run" action (a failed run also puts the result in `description`).
 * automation.run.updated / interaction.created / interaction.resolved carry
 * no user-facing toast here — Phase 6's `use-automation-events.ts` patches
 * the store from those instead.
 */
import { useEffect } from 'react';
import { mfToast } from '@/lib/toast';
import type { DaemonEvent } from '../contract';
import { useAutomationsNav } from './use-automations-nav';
import { useAutomationsStore } from './use-automations-store';

function viewRunAction(runId: string) {
  return {
    label: 'View run',
    onClick: () => {
      useAutomationsNav.getState().openHost();
      useAutomationsNav.getState().openRun(runId);
    },
  };
}

export function useAutomationToasts(): void {
  const gateway = useAutomationsStore((s) => s.gateway);

  useEffect(() => {
    return gateway.onEvent((event: DaemonEvent) => {
      switch (event.type) {
        case 'automation.notification': {
          const [chatId] = event.links.chatIds;
          mfToast({
            type: 'info',
            title: event.title,
            description: event.body,
            ...(chatId ? { chatId } : { action: viewRunAction(event.links.runId) }),
          });
          break;
        }
        case 'automation.completed': {
          const fire = event.status === 'succeeded' ? mfToast.success : mfToast.error;
          fire(`${event.automationName} ${event.status === 'succeeded' ? 'finished' : 'failed'}`, {
            description: event.status === 'failed' ? event.result : undefined,
            action: viewRunAction(event.runId),
          });
          break;
        }
        default:
          break;
      }
    });
  }, [gateway]);
}
