import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import type { RunTab } from '@/store/run-pane';

/**
 * Build the Run tab for a launch config: a `preview` webview tab or a `console`
 * process tab, carrying the resolved dev-server port (for the preview webview).
 *
 * The tab id doubles as the Tauri child-webview LABEL, which only allows
 * `[A-Za-z0-9_-]` — so the config name is sanitized (a space breaks `add_child`
 * and the preview webview never mounts).
 *
 * Shared by `use-launch-actions` (manual launch) and `use-launch-configs`
 * (reconciling already-running configs on boot) so both produce identical tabs.
 *
 * `scopeKey` (`buildLaunchScope(projectId, effectivePath)`) is captured here so
 * the tab can filter its own console/status independently of the active chat —
 * run tabs are global, so the active chat may not resolve to this tab's scope.
 */
/**
 * Returns `null` when a `preview: true` config is launched under a remote
 * daemon — the dev-server port is on the server and is not reachable from
 * `localhost` over the tunnel. Pass `isLocal=false` (from `useDaemonIsLocal()`)
 * at the React call sites. Defaults to `true` for backwards-compat.
 */
export function runTabForConfig(config: LaunchConfiguration, scopeKey?: string | null, isLocal = true): RunTab | null {
  if (config.preview && !isLocal) return null;
  const kind = config.preview ? 'preview' : 'console';
  const safeName = config.name.replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    id: `${kind}-${safeName}-${crypto.randomUUID().slice(0, 8)}`,
    kind,
    title: config.name,
    config: config.name,
    port: config.port ?? undefined,
    scopeKey: scopeKey ?? undefined,
  };
}
