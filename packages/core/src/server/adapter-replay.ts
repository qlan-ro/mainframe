import type { AdapterInfo, DaemonEvent } from '@qlan-ro/mainframe-types';

/**
 * Events to replay to a client the moment it connects, so a fresh connection's
 * catalog is authoritative (the renderer resets its store on connect, then applies
 * these). Only probed catalogs carry the live model list worth replaying.
 */
export function buildConnectReplayEvents(snapshots: AdapterInfo[]): DaemonEvent[] {
  const events: DaemonEvent[] = [];
  for (const s of snapshots) {
    if (s.catalogSource === 'probed' && typeof s.modelsRevision === 'number') {
      events.push({
        type: 'adapter.models.updated',
        adapterId: s.id,
        models: s.models,
        modelsRevision: s.modelsRevision,
      });
    }
  }
  return events;
}
