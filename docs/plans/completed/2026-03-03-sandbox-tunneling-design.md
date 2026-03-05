# Sandbox Tunneling Design

## Problem

The mobile sandbox WebView loads `http://localhost:3000`, which is unreachable from a phone. The dev server runs on the host machine and binds to localhost. The phone needs a public URL to preview it.

## Solution

The daemon manages Cloudflare tunnels via `cloudflared`:

1. **Main daemon tunnel** — exposes the daemon's HTTP/WS port so the mobile app can pair and communicate.
2. **Dev server tunnel** — spawned per launch config with `preview: true`, lifetime tied to the launch process.

```
Host Machine
├── Daemon (:31415) ──cloudflared──► main-abc.trycloudflare.com
│                                    (mobile pairs & talks here)
└── Dev Server (:3000) ──cloudflared──► dev-xyz.trycloudflare.com
                                        (sandbox WebView loads this)
```

## Configuration

Tunnel settings are startup-level (like `port`), stored in `config.json` with env var overrides.

| Env Var | config.json key | Effect |
|---------|----------------|--------|
| `TUNNEL=true` | `tunnel: true` | Spawn a quick tunnel for the daemon port on startup |
| `TUNNEL_URL=https://...` | `tunnelUrl: "https://..."` | Use a pre-configured named tunnel (no spawn) |

- `TUNNEL_URL` takes precedence over `TUNNEL=true`.
- Neither set → no tunnel (localhost-only mode).
- Quick tunnels log a warning about ephemeral URLs not being suitable for production.

### MainframeConfig changes

```ts
interface MainframeConfig {
  port: number;
  dataDir: string;
  tunnel?: boolean;    // NEW: spawn quick tunnel on startup
  tunnelUrl?: string;  // NEW: pre-configured named tunnel URL
}
```

## New Module: TunnelManager

```
packages/core/src/tunnel/
├── tunnel-manager.ts
└── index.ts
```

### API

```ts
class TunnelManager {
  start(port: number, label: string): Promise<string>  // returns public URL
  stop(label: string): void
  stopAll(): void
  getUrl(label: string): string | null
}
```

### Behavior

- `start()` spawns `cloudflared tunnel --url http://localhost:<port>`.
- Parses the `https://...trycloudflare.com` URL from stderr output.
- Resolves the promise once URL is found. Rejects after ~15s timeout.
- Each tunnel tracked by `label` (e.g. `"daemon"`, `"preview:Dev Server"`).
- On process exit, logs warning and cleans up.
- Requires `cloudflared` in PATH. Logs a clear error if missing.

## Integration Points

### 1. Daemon startup (`server/index.ts`)

After `httpServer.listen()`:
- If `tunnelUrl` is set → store it, no spawn.
- If `tunnel === true` → `tunnelManager.start(port, 'daemon')`, log URL + production warning.
- Expose the tunnel URL via `GET /health` response (`tunnelUrl` field).

### 2. LaunchManager (`launch-manager.ts`)

On `start(config)` where `config.preview && config.port`:
- `tunnelManager.start(config.port, 'preview:' + config.name)`
- On success → emit `launch.tunnel { projectId, name, url }`
- On failure → log warning, continue without tunnel

On `stop(name)`:
- `tunnelManager.stop('preview:' + name)` alongside killing the dev process.

### 3. New event type

```ts
{ type: 'launch.tunnel'; projectId: string; name: string; url: string }
```

### 4. Mobile app

- `event-router.ts` — handle `launch.tunnel`, store URL in sandbox store.
- `store/sandbox.ts` — add `tunnelUrls: Map<string, string>`.
- `sandbox/index.tsx` — load tunnel URL instead of `localhost:3000`. Show "waiting for tunnel..." until URL arrives.
- Wire up `LaunchConfigSheet` (already built, just not connected).

## Security

- JWT auth protects all daemon endpoints regardless of tunnel type.
- Quick tunnels are ephemeral, no Cloudflare Access policies. Fine for dev, not production.
- Named tunnels (`TUNNEL_URL`) support Cloudflare Access for production.
- Dev server tunnels expose only the dev server port, not the daemon.
- `cloudflared` quick tunnels are public URLs — the dev server itself has no auth. This is acceptable because dev servers are inherently development tools.
