# Remote preview via quick tunnel — design

**Date:** 2026-07-02 · **Status:** approved (brainstorm) · **Scope:** `packages/ui` only

## Problem

Running a `preview: true` launch config against a **remote** daemon does nothing visible: `runTabForConfig` returns `null` for preview+remote (`packages/ui/src/features/run/run-tab-for-config.ts:25`, the remote-daemon C2 gate), and since `addRunTab` is the only thing that lights the Run surface, the click is a silent no-op — while the daemon-side process still starts. The gate exists because the preview webview would load `http://localhost:${port}`, which points at the wrong machine.

## Insight that shapes the design

The daemon already solves the reachability problem — for mobile. When a preview config with a port reaches `running`, `LaunchManager` starts a cloudflared quick tunnel labeled `preview:${name}` (`packages/core/src/launch/launch-manager.ts:248-270`) and:

- emits `launch.tunnel { name, url }` on success and `launch.tunnel.failed { name, error }` on failure over WS;
- returns `tunnelUrls: Record<configName, url>` from the launch status route (`packages/core/src/server/routes/launch.ts:56-66`).

The desktop UI currently treats those WS events as log-only (`packages/ui/src/features/run/use-sandbox-ws-router.ts:49-56`). **This feature is therefore UI-only; the daemon contract is untouched.**

## Decisions (from brainstorm)

- Connectivity model: remote daemons are reached **through Cloudflare tunnels only** — arbitrary daemon-host ports are not reachable, so host-substitution is out; the per-preview quick tunnel is the mechanism.
- Exposure: an unguessable, unauthenticated `trycloudflare.com` URL for a dev server is **accepted** (URL lives only while the config runs, never persisted; session-layout already strips preview tabs).
- Local behavior is byte-for-byte unchanged (`http://localhost:${port}`); the tunnel URL is used **only** when the active daemon is remote.

## Changes

### 1. Tunnel-URL state (sandbox store)

`useSandboxStore` gains a `tunnelUrls: Record<string, string>` slice keyed by config name, plus a `tunnelErrors: Record<string, string>` companion, with setters and a per-scope reset consistent with how the store scopes launch state today.

Writers:
- `use-sandbox-ws-router.ts`: `launch.tunnel` → keep the existing `appendLog` AND write `tunnelUrls[name] = url`; `launch.tunnel.failed` → keep log AND write `tunnelErrors[name] = error`. A `launch.status` transition away from `running`/`starting` for a config clears its entries (tunnel dies with the process).
- Launch-status seeding: wherever the UI fetches launch statuses (`getLaunchStatuses`, `packages/ui/src/lib/api/launch.ts` — response already carries `tunnelUrls`), merge the returned map into the slice. This covers tabs opened after the tunnel came up, reloads, and WS reconnects.

### 2. Un-gate the preview tab

`run-tab-for-config.ts`: delete the `if (config.preview && !isLocal) return null` branch (and its comment block). Preview configs always produce a `preview`-kind tab; the Run surface always lights via the existing `addRunTab` → `placeInLayout` path. `isLocal` remains a parameter only if still needed elsewhere — if nothing else consumes it, drop it and update both callers (`use-launch-actions.ts`, `use-launch-configs.ts`).

### 3. URL seam in the preview lifecycle

`use-preview-lifecycle.ts:58` currently hardcodes `` const url = `http://localhost:${port}` ``. Resolve instead:

- **local daemon** (`useDaemonIsLocal()` true): `http://localhost:${port}` — unchanged.
- **remote daemon**: `tunnelUrls[configName]` from the store, keyed by the tab's `config` field (`RunTab.config` already carries the launch-config name — `run-tab-for-config.ts:33`; no threading needed).

While remote and no URL yet: do **not** mount the webview; render a pending state ("Starting tunnel…", spinner) via the existing `PreviewBodyState` component, with a stable `data-testid` (`preview-tunnel-pending`). When the URL appears (WS event or seed), mount/navigate as today.

### 4. Failure and timeout path

If `tunnelErrors[configName]` is set, or no URL arrives within **20s** of the config reaching `running`: the tab body falls back to the embedded `ConsolePane` (the drawer variant `PreviewInstance` already mounts, promoted to the body) so logs are visible and the process stays stoppable from the tab, plus one `mfToast.error` ("Preview tunnel unavailable — showing process logs. <reason>"). Testid `preview-tunnel-failed`. The Run/stop CTA behavior (chatId contract) is unchanged.

## Explicit non-goals

- No daemon/core changes; no mobile-contract changes.
- No authenticated preview proxying (rejected: fragile for arbitrary dev servers; exposure accepted instead).
- No tunnel start/stop controls in the UI beyond the existing config Run/Stop (the daemon owns tunnel lifecycle).

## Error handling summary

| Condition | Behavior |
|---|---|
| Remote, tunnel pending | Pending body state, no webview mount |
| `launch.tunnel` arrives | Mount/navigate webview to tunnel URL |
| `launch.tunnel.failed` or 20s timeout | Console fallback body + one error toast |
| Config stops | Tunnel entries cleared; tab teardown as today |
| Local daemon | Entirely unchanged |

## Testing

- Store slice: set/clear semantics, seeding merge, clear-on-stop.
- WS router: `launch.tunnel`/`launch.tunnel.failed` write state and still append logs.
- `runTabForConfig`: preview+remote now yields a preview tab; local unchanged.
- Lifecycle: URL resolution per locality; pending → ready mounts once with the tunnel URL; failure/timeout → console fallback rendered; testids present.
- Live verification against a real remote daemon per `docs/guides/testing-remote-daemon.md` (checklist: preview tab lights, pending state, webview loads trycloudflare URL, stop tears down, cloudflared-missing shows fallback).
