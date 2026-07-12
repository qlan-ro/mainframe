/**
 * createHttpGateway — the real `AutomationsGateway` over `lib/api/automations.ts`,
 * mirroring `fixtures/fixture-gateway.ts`'s shape so `use-automations-store.ts`
 * (and every consumer that only knows the `AutomationsGateway` interface) is
 * indifferent to which one is wired in. Two methods aren't pure delegation:
 * `getRun`/`getRunTimeline` both read the single `GET /api/automation-runs/:id`
 * response (contract §4 returns `{run, timeline}` together) and pick a field;
 * `listCredentialLabels` unwraps the route's `{labels}` envelope into the
 * gateway's bare `string[]`. `onEvent` wraps the `daemonWs` singleton,
 * filtering to the five `automation.*` events — `daemonWs` broadcasts every
 * `DaemonEvent` (chat/session/etc.), and the fixture gateway's local emitter
 * only ever produces automation ones, so this keeps the two backends
 * behaviorally identical from a listener's point of view.
 */
import { daemonWs } from '@/lib/daemon/ws-client';
import * as api from '@/lib/api/automations';
import type { DaemonEvent } from '../contract';
import type { AutomationsGateway } from './gateway';

function isAutomationEvent(event: DaemonEvent): boolean {
  return event.type.startsWith('automation.');
}

export function createHttpGateway(): AutomationsGateway {
  return {
    listAutomations: api.listAutomations,
    createAutomation: api.createAutomation,
    getAutomation: api.getAutomation,
    updateAutomation: api.updateAutomation,
    deleteAutomation: api.deleteAutomation,
    setEnabled: api.setAutomationEnabled,

    startRun: api.startAutomationRun,
    listRuns: api.listAutomationRuns,
    getRun: async (runId) => (await api.getAutomationRun(runId)).run,
    getRunTimeline: async (runId) => (await api.getAutomationRun(runId)).timeline,
    cancelRun: api.cancelAutomationRun,

    listInteractions: api.listAutomationInteractions,
    respondInteraction: api.respondAutomationInteraction,

    listActions: api.listAutomationActions,

    listCredentialLabels: async () => (await api.listAutomationCredentialLabels()).labels,
    putCredential: api.putAutomationCredential,
    deleteCredential: api.deleteAutomationCredential,

    onEvent(listener) {
      return daemonWs.onEvent((event: DaemonEvent) => {
        if (isAutomationEvent(event)) listener(event);
      });
    },
  };
}
