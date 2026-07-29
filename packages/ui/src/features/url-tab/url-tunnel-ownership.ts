/**
 * Pure reducers over the URL-tab tunnel-ownership registry (#281, D10, AC12).
 *
 * `started: true` means this tab's own POST started the tunnel; `started: false`
 * means it merely adopted one another tab already owns. Only an owner's release
 * should ever stop a tunnel, and only when no other consumer remains on the port.
 *
 * A same-port re-register takes `started` verbatim, no OR-merge with the prior
 * value: the hook is the one source of truth for whether *this* tab currently
 * owns the port (`ownedPort`, cleared on retarget and on an observed stop), so
 * a stale `true` here would out-live the state that justified it — exactly the
 * bug this file exists to prevent (review-fix findings 1+2).
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
  const base =
    existing !== undefined && existing.port !== rec.port ? releaseConsumers(state, [tabId]) : { next: state, stop: [] };
  return { next: { byTab: { ...base.next.byTab, [tabId]: rec } }, stop: base.stop };
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
