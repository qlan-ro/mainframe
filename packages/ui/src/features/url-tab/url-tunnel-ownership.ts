/**
 * Pure reducers over the URL-tab tunnel-ownership registry (#281, D10, AC12).
 *
 * `started: true` means this tab's own POST started the tunnel; `started: false`
 * means it merely adopted one another tab already owns. Only an owner's release
 * should ever stop a tunnel, and only when no other consumer remains on the port.
 */

export interface ConsumerRecord {
  port: number;
  started: boolean;
  daemonHttpPort: number;
}

export interface ConsumerState {
  byTab: Record<string, ConsumerRecord>;
}

export const emptyConsumerState: ConsumerState = { byTab: {} };

export function addConsumer(
  state: ConsumerState,
  tabId: string,
  rec: ConsumerRecord,
): {
  next: ConsumerState;
  stop: Array<{ port: number; daemonHttpPort: number }>;
} {
  const existing = state.byTab[tabId];
  // A retarget to a different port abandons this tab's claim on the old one —
  // release it through the same owner-and-last-consumer rule a close uses, so
  // an owned tunnel never survives orphaned (AC12/D10).
  if (existing !== undefined && existing.port !== rec.port) {
    const released = releaseConsumers(state, [tabId]);
    return { next: writeConsumer(released.next, tabId, rec), stop: released.stop };
  }
  return { next: writeConsumer(state, tabId, rec), stop: [] };
}

function writeConsumer(state: ConsumerState, tabId: string, rec: ConsumerRecord): ConsumerState {
  const existing = state.byTab[tabId];
  // An owner (started: true) stays an owner across a same-port re-register (Retry).
  const started = existing && existing.port === rec.port ? existing.started || rec.started : rec.started;
  return { byTab: { ...state.byTab, [tabId]: { ...rec, started } } };
}

export function releaseConsumers(
  state: ConsumerState,
  tabIds: string[],
): {
  next: ConsumerState;
  stop: Array<{ port: number; daemonHttpPort: number }>;
} {
  const removed = tabIds.map((id) => state.byTab[id]).filter((rec): rec is ConsumerRecord => rec !== undefined);
  if (removed.length === 0) return { next: state, stop: [] };

  const byTab = { ...state.byTab };
  for (const id of tabIds) delete byTab[id];

  const remainingPorts = new Set(Object.values(byTab).map((rec) => rec.port));
  const stopPorts = new Set<number>();
  const stop: Array<{ port: number; daemonHttpPort: number }> = [];
  for (const rec of removed) {
    if (rec.started && !remainingPorts.has(rec.port) && !stopPorts.has(rec.port)) {
      stopPorts.add(rec.port);
      stop.push({ port: rec.port, daemonHttpPort: rec.daemonHttpPort });
    }
  }

  return { next: { byTab }, stop };
}

export function clearConsumers(state: ConsumerState): ConsumerState {
  if (Object.keys(state.byTab).length === 0) return state;
  return emptyConsumerState;
}
