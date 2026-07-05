/**
 * use-launch-configs — fetch and refresh launch configs + statuses.
 *
 * Takes the active {port, projectId, chatId} explicitly so it works both inside
 * the Run surface (context-derived) and in the shell MainToolbar (prop-derived).
 * Fetches both configs and the current process statuses in a single effect, and
 * exposes a `refetch` callback for manual refresh (e.g. on popover open).
 */
import { useEffect, useCallback, useState } from 'react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import {
  fetchLaunchConfigs,
  fetchLaunchStatuses,
  type LaunchOutputEntry,
  type LaunchStatusData,
} from '@/lib/api/launch';
import { useSandboxStore } from '@/store/sandbox';
import { useLayoutStore } from '@/store/layout';
import { buildLaunchScope } from '@/lib/launch-scope';
import { runTabForConfig } from './run-tab-for-config';

export interface UseLaunchConfigsResult {
  configs: LaunchConfiguration[];
  statusData: LaunchStatusData | null;
  refetch: () => void;
}

/**
 * Apply one fetched config's status to the shared store, and reconcile a
 * missing run tab for a live process.
 *
 * A WS `launch.status` event can update the store while the REST fetch that
 * produced `status` was still in flight (e.g. Stop clicked right after the
 * toolbar's popover reopens and calls `refetch()`, or a fresh mount of this
 * hook racing a launch failing) — that live update is strictly more current
 * than this REST snapshot. `preScopeStatuses` is what the store held for this
 * scope right before the fetch started; if the live value has since diverged
 * from it, a WS event won the race and this stale `status` must not clobber
 * it — the live value is used for the tab-reconcile decision too.
 */
function reconcileFetchedStatus(
  name: string,
  status: LaunchProcessStatus,
  scope: string,
  preScopeStatuses: Record<string, LaunchProcessStatus>,
  cfgs: LaunchConfiguration[],
  tabbed: Set<string>,
): void {
  const sandbox = useSandboxStore.getState();
  const liveStatus = sandbox.processStatuses[scope]?.[name];
  const supersededByWs = liveStatus !== undefined && liveStatus !== preScopeStatuses[name];
  const effectiveStatus = supersededByWs ? liveStatus : status;

  if (!supersededByWs) {
    sandbox.setProcessStatus(scope, name, status);
  }
  // A running/starting config must always have a tab in the Run surface —
  // reconcile one if missing (e.g. after an app restart, where the run panes
  // are empty but the process is still alive).
  if ((effectiveStatus === 'running' || effectiveStatus === 'starting') && !tabbed.has(name)) {
    const cfg = cfgs.find((c) => c.name === name);
    if (cfg) {
      useLayoutStore.getState().addRunTab(runTabForConfig(cfg, scope));
      tabbed.add(name);
    }
  }
}

/**
 * Seed a config's console output from the daemon's buffered replay
 * (`LaunchManager.getOutputBuffer`, returned as `outputBuffer` on the status
 * fetch) — but only when nothing has appeared yet for this scope+name. This
 * closes the gap where a fast subprocess's entire lifecycle (spawn → stdout →
 * exit) finishes before a console pane's live WS delivery is observed, without
 * ever duplicating output a live `launch.output` event already delivered.
 */
function seedOutputBuffer(scope: string, name: string, entries: LaunchOutputEntry[] | undefined): void {
  if (!entries || entries.length === 0) return;
  const sandbox = useSandboxStore.getState();
  const hasLiveEntries = sandbox.logsOutput.some((l) => l.scopeKey === scope && l.name === name);
  if (hasLiveEntries) return;
  for (const entry of entries) {
    sandbox.appendLog(scope, name, entry.data, entry.stream);
  }
}

export function useLaunchConfigs(
  port: number,
  projectId: string | undefined,
  chatId: string | undefined,
): UseLaunchConfigsResult {
  const [configs, setConfigs] = useState<LaunchConfiguration[]>([]);
  const [statusData, setStatusData] = useState<LaunchStatusData | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    // Snapshot every scope's statuses before starting the fetch — see
    // `reconcileFetchedStatus`'s docstring for why this is needed. Guarded:
    // a harness that stubs the sandbox store as a bare selector hook (no
    // `getState`) shouldn't crash the effect over a snapshot that only
    // matters for the staleness comparison below.
    let preFetchStatuses: Record<string, Record<string, LaunchProcessStatus>> = {};
    try {
      preFetchStatuses = useSandboxStore.getState().processStatuses;
    } catch {
      /* expected: sandbox store may be mocked without getState in tests */
    }

    Promise.all([
      fetchLaunchConfigs(port, projectId, chatId ?? undefined),
      fetchLaunchStatuses(port, projectId, chatId ?? undefined),
    ])
      .then(([cfgs, statuses]) => {
        if (cancelled) return;
        setConfigs(cfgs);
        setStatusData(statuses);

        const sandbox = useSandboxStore.getState();
        const scope = buildLaunchScope(projectId, statuses.effectivePath);
        // Seed tunnel URLs (remote-daemon preview): the WS launch.tunnel event
        // only fires once on tunnel creation, so a client that subscribes later
        // (reload, reconnect, tab opened after the tunnel came up) relies on this
        // status-fetch seed to learn the URL.
        sandbox.seedTunnelUrls(scope, statuses.tunnelUrls);

        // Run tabs already open FOR THIS SCOPE, keyed by config name (don't
        // re-add/re-focus). Scope-scoped so a same-named config running in
        // another project/worktree still gets reconciled into its own tab.
        const layout = useLayoutStore.getState();
        const tabbed = new Set(
          (layout.run?.panes ?? []).flatMap((p) =>
            p.tabs
              .filter((t) => t.scopeKey === scope)
              .map((t) => t.config)
              .filter((c): c is string => Boolean(c)),
          ),
        );

        const preScopeStatuses = preFetchStatuses[scope] ?? {};
        for (const [name, status] of Object.entries(statuses.statuses)) {
          reconcileFetchedStatus(name, status as LaunchProcessStatus, scope, preScopeStatuses, cfgs, tabbed);
          seedOutputBuffer(scope, name, statuses.outputBuffer?.[name]);
        }
      })
      .catch((err) => console.warn('[launch] configs/statuses fetch failed', err));

    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, tick]);

  return { configs, statusData, refetch };
}
