# Remote Daemon — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorm) — ready for implementation plan
**Branch:** feat/app-tauri-wt

## Goal

Let the desktop app (Tauri + `packages/ui`) connect to a Mainframe daemon running on a
remote server the user controls, instead of only the local sidecar. The driver is
**single-user compute offload**: agents and code live on the server; the laptop is a
control surface. The user has several personal servers and switches between them, **one
active daemon at a time**.

Transport reuses the **existing Cloudflare tunnel**, and onboarding reuses the **existing
device-pairing flow**. The desktop becomes a tunnel client exactly the way the mobile app
already is. **No daemon-contract changes are required** — every server-side route, the
tunnel manager, the pairing handshake, and the auth middleware already exist and already
serve the mobile client.

### Non-goals (V1)

- Server-side terminal / PTY. The terminal stays laptop-local.
- Preview-over-tunnel (reaching a dev-server port on the server).
- Multiple daemons connected simultaneously (aggregated view).
- Team / multi-user / per-user identity. Single-tenant only.
- De-globalizing the three connection singletons (kept, with explicit dispose).

## Background — what already exists

Server side (no changes needed):

- **Tunnel** — `packages/core/src/tunnel/tunnel-manager.ts` runs `cloudflared`, exposes the
  whole daemon HTTP+WS surface at a tunnel URL, broadcasts `tunnel:status`.
- **Pairing** — `packages/core/src/server/routes/auth.ts`: `POST /api/auth/pair` mints a
  6-char code (5-min TTL); `POST /api/auth/confirm { pairingCode, clientDeviceId, deviceName? }`
  returns `{ token, deviceId }`. Token is a per-device HMAC-SHA256 JWT
  (`packages/core/src/auth/token.ts`), revocable by bumping the device `authEpoch`.
- **Auth** — `packages/core/src/server/middleware/auth.ts`: loopback is trusted with no
  token; any non-localhost request requires `Authorization: Bearer <token>`. WS validates a
  `?token=` query param (`packages/core/src/server/websocket.ts`).
- **Remote-access pane** — `packages/ui/src/features/settings/panes/remote-access/` already
  drives tunnel start/stop, pairing-code generation, and the paired-devices list. This is
  the *server* side (exposing this daemon). The *client* side is new.

Client reference to mirror:

- **Mobile client** — `packages/mobile/lib/auth.ts` stores `{ url, token }`;
  `packages/mobile/lib/api.ts` injects `Authorization: Bearer`; `packages/mobile/lib/daemon-client.ts`
  injects `?token=` on the WS; `packages/mobile/app/welcome.tsx` is the pairing UI.

## Architecture

### DaemonTarget (the single connection seam)

Today the desktop client is hardcoded to `127.0.0.1:<port>` with no token, in three places —
`packages/ui/src/lib/api/http.ts`, `packages/ui/src/lib/daemon/ws-client.ts`,
`packages/ui/src/lib/lsp/lsp-client.ts` — fed by a single `DaemonPortProvider`.

Replace the bare port with a target:

```ts
type DaemonTarget = {
  id: string;            // 'local' | <registry uuid>
  label: string;
  kind: 'local' | 'remote';
  baseUrl: string;       // 'http://127.0.0.1:<port>' | tunnel URL
  token: string | null;  // null for local (loopback trust); JWT for remote
};
```

- **`ActiveDaemonContext`** replaces `DaemonPortProvider` and provides the active
  `DaemonTarget` plus `isLocal`. The three connection seams take `baseUrl` + `token` instead
  of a port. The local case keeps `token: null`, so **today's behavior is byte-for-byte
  unchanged**. The remote case injects `Authorization: Bearer <token>` on HTTP and `?token=`
  on the WS — the mobile pattern.
- Port-keyed hooks that already refetch on change (`useProjects`, `useTagRegistry`) keep
  working; they read the target's identity instead of a raw port.

### DaemonRegistry + secure storage

- **Registry** — a persisted list: `local` (always present) plus N remotes. Non-secret
  metadata (`id`, `label`, `baseUrl`, `kind`, `deviceId`, `pairedAt`) lives in app config.
- **Tokens** — stored in the **OS keyring** (Tauri keyring plugin), never plaintext on disk.
  `clientDeviceId` (a stable per-install UUID, generated once) is stored alongside.

### Onboarding — pairing client

Mirrors `packages/mobile/app/welcome.tsx`:

1. Enter the remote **tunnel URL** → `GET {url}/health` to verify reachability.
2. Enter the **6-char pairing code** (generated on the server via the existing
   `PairingSection`, or `curl POST /api/auth/pair` from the server's loopback on a headless
   box).
3. `POST {url}/api/auth/confirm { pairingCode, clientDeviceId, deviceName }` →
   `{ token, deviceId }`.
4. Persist registry metadata + write the token to the keyring. The daemon appears in the
   picker.

### Switch reset — keyed remount + disposeDaemonSession()

A daemon's chat/project/session ids are meaningless on the next daemon, so anything keyed by
them must reset on switch. Reset is the **default**, not a hand-maintained checklist:

- **Key the daemon-scoped React subtree by `activeDaemonId`.** On switch, React unmounts and
  remounts it, automatically disposing every in-React store, context, hook, runtime, and
  subscription, and reinitializing them against the new target. Future caches are covered for
  free. The boundary **excludes** chrome that is daemon-agnostic (native window, traffic
  lights, theme, `mf:ui-prefs`, tutorial) and the **laptop-local terminal**, so those survive
  a switch.
- **`disposeDaemonSession()`** handles the bounded set React cannot reach — three
  module-level singletons and live OS handles:
  - `daemonWs` (`packages/ui/src/lib/daemon/ws-client.ts`) — reconnect to the new
    `baseUrl` + `token`.
  - `lspClientManager` (`packages/ui/src/lib/lsp/index.ts`) — rebind to the new endpoint.
  - `chatControllerRegistry`
    (`packages/ui/src/features/sessions/runtime/chat-controller-registry.ts`) — `disposeAll()`.
  - Live Run PTYs / preview webviews — kill via the existing
    `killAndDisposeCachedTerminals` path in `packages/ui/src/store/layout.ts`.
- **Namespaced persistence** — `mf:last-session`, `mf:filterProjectId`, and
  `mf:session-layout` are keyed under the daemon id via a small storage wrapper, so daemon A's
  ids never bleed into daemon B. Daemon-agnostic keys (`mf:ui-prefs`, `mf:tutorial`,
  `mf:theme`, task drawer height) stay global.
- **Boot** picks the last-active daemon, defaulting to `local`.

#### Daemon-scoped state inventory (what reset must cover)

| State | Location | Handling |
|---|---|---|
| `daemonWs` singleton | `lib/daemon/ws-client.ts` | dispose: reconnect |
| `lspClientManager` singleton | `lib/lsp/index.ts` | dispose: rebind |
| `chatControllerRegistry` singleton | `features/sessions/runtime/chat-controller-registry.ts` | dispose: `disposeAll()` |
| Run PTYs / preview webviews | `store/layout.ts`, `store/sandbox.ts` | dispose: kill handles |
| `session-todos`, `unread`, `active-bases`, `sandbox`, `settings`, overlays | `store/*` | remount (in-subtree) |
| `useProjects`, `useTagRegistry` | `features/sessions/*` | already target-keyed, refetch |
| `mf:last-session`, `mf:filterProjectId`, `mf:session-layout` | localStorage | namespace by daemon id |
| `mf:ui-prefs`, `mf:tutorial`, `mf:theme`, tabs, editor view-state | stores/localStorage | keep (daemon-agnostic / path-portable) |

### Local-affordance gating

The `useDaemonIsLocal()` hook (already landed at
`packages/ui/src/lib/daemon/use-daemon-is-local.ts`, currently a constant `true`) now derives
from `ActiveDaemonContext.isLocal`.

- **Disabled when remote**: Reveal-in-Finder (already gated), Open-externally `file://`
  (`packages/ui/src/features/viewers/UnsupportedViewer.tsx`), and the **preview tab** (the
  dev-server port lives on the server and is not reachable via `localhost` over the tunnel).
- **Kept**: Copy Path (a path string is harmless to copy), file viewers (daemon-only reads,
  already landed), and the terminal (laptop-local; its cwd falls back to home when the
  worktree path does not exist locally — a graceful-fallback change to
  `packages/ui/src/features/terminal/terminal-cwd.ts`).
- **Run** works unchanged: the process runs server-side and console output streams over WS.

## Error handling

- **Unreachable remote** (tunnel down, laptop offline) → the existing `ConnectionOverlay`,
  plus a "switch to local" affordance in the picker.
- **401** (token revoked via epoch bump, or expired) → prompt to re-pair that daemon.
- **Tunnel-URL stability** — Cloudflare *quick* tunnels rotate their URL on each restart;
  remote daemons must use a **named** tunnel for a stable URL. Documented in onboarding; if a
  URL changes, the user re-pairs.

## UI build handoff (Claude design)

The new user-facing surfaces this feature introduces are to be designed and built by **Claude
design**, consistent with the warm-chrome prototype artboards and the theme/token contract
(per the design-conformance flow), with stable scoped `data-testid`s on every interactive
element. The surfaces:

- **Daemon picker** — switch the active daemon (local + remotes), show connection state per
  entry, and the "switch to local" affordance.
- **Add-remote / pairing dialog** — the two-step URL-verify → pairing-code flow, with
  reachability and error states.
- **Remote daemon management** — rename / remove a registered daemon; re-pair on 401.
- **Connection / error states** — unreachable-remote overlay and the re-pair prompt.

The spec defines behavior, data flow, and the gating contract; Claude design owns the visual
and interaction design of these surfaces against the prototype.

## Testing

- **Unit**: `DaemonTarget` resolution; HTTP/WS auth injection (Bearer header + `?token=`);
  registry CRUD; keyring read/write; `useDaemonIsLocal` derivation from the active target;
  gating (Reveal/Open-externally/preview disabled when remote);
  namespaced persistence (no id bleed across daemons); `disposeDaemonSession()` ordering;
  pairing confirm → store.
- **Integration**: a daemon switch disposes all controllers, reconnects the WS to the new
  endpoint, and clears daemon-scoped stores via the keyed remount; laptop-local terminal
  survives the switch.

## Scope (V1)

**In**: registry + picker; pairing client; the `DaemonTarget` connection-layer refactor;
keyring token storage; switch-reset (keyed remount + `disposeDaemonSession()` + namespaced
persistence); `useDaemonIsLocal` wired to the active target; affordance gating; and full use
of chat / agents / files / changes / git / settings against a remote daemon.

**Out / fast-follow**: server-side terminal & preview-over-tunnel; multiple simultaneous
daemons; team / multi-user; de-globalizing the three singletons.

## Implementation note

This ships as a **single implementation plan** (not decomposed into separate specs), built in
dependency order within that plan: (1) the `DaemonTarget` connection-layer refactor +
switch-reset plumbing (local-only but target-shaped, independently testable); (2) registry +
pairing client + picker + keyring; (3) gating + affordances. UI surfaces from step 2–3 are
handed to Claude design per the section above.
