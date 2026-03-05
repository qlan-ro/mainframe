# Daemon Distribution & CLI Pairing Design

Standalone daemon packaging for end users who run the backend without the Electron desktop app, plus a CLI pairing command for mobile device onboarding.

## Goals

- End users can install and run `mainframe-daemon` without cloning the repo or having Node.js installed
- Mobile app pairing works from the terminal via code + QR
- Paired devices persist across daemon restarts
- Docker image available as the most portable option

## Components

### 1. CLI Entry Point

Extend `packages/core/src/index.ts` with `process.argv[2]` subcommand dispatch:

| Command | Behavior |
|---------|----------|
| _(none)_ | Start daemon (existing `main()`) |
| `pair` | Request pairing code from running daemon, print code + QR |
| `status` | Show daemon info + paired devices |

No arg-parsing library — simple switch on `process.argv[2]`.

New files:
- `packages/core/src/cli/pair.ts` — pairing subcommand
- `packages/core/src/cli/status.ts` — status subcommand

New dependency: `qrcode-terminal` for terminal QR rendering.

### 2. Device Persistence

New SQLite table in `DatabaseManager`:

```sql
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);
```

Methods: `addDevice()`, `removeDevice()`, `getDevices()`, `updateLastSeen()`.

Integration points:
- `POST /api/auth/confirm` writes device record after token generation
- WebSocket auth middleware updates `last_seen` on connection
- New `GET /api/auth/devices` endpoint lists paired devices
- New `DELETE /api/auth/devices/:deviceId` endpoint revokes a device

Pairing codes remain in-memory (short-lived, 5 min expiry). Token validation stays HMAC-based (stateless). The `devices` table is informational — tokens are valid as long as `AUTH_TOKEN_SECRET` / `authSecret` is unchanged.

### 3. Auth Secret Auto-Generation

On first daemon startup, if no `AUTH_TOKEN_SECRET` env var and no `authSecret` in `~/.mainframe/config.json`:

1. Generate random 32-byte hex string
2. Save to `config.json` as `authSecret`
3. Log: `"Auth secret generated and saved to config.json"`

Precedence: `AUTH_TOKEN_SECRET` env var > `config.json` `authSecret` > auto-generate.

Config interface gains `authSecret?: string`.

### 4. CLI Pairing Subcommand

`mainframe-daemon pair` flow:

1. Read daemon port from `~/.mainframe/config.json`
2. `GET http://127.0.0.1:{port}/health` — verify daemon is running
3. `POST http://127.0.0.1:{port}/api/auth/pair` with `{ deviceName: "CLI pairing" }`
4. Read tunnel URL from health response (if active)
5. Print pairing code + QR code + tunnel URL
6. Poll for new device registration, print confirmation and exit

QR payload: `{"url":"https://...","code":"ABCD1Z"}` — mobile app scans and auto-fills both fields.

No tunnel active: print code + note about starting with `TUNNEL=true`.

`mainframe-daemon status` flow:
1. `GET /health` — daemon version, port, tunnel URL
2. `GET /api/auth/devices` — list paired devices with last_seen

### 5. Docker Image

Multi-stage Dockerfile at repo root. Publish to `ghcr.io/qlan-ro/mainframe-daemon`.

```dockerfile
# Stage 1: Build
FROM node:24-slim AS build
RUN corepack enable pnpm
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN node packages/desktop/scripts/bundle-daemon.mjs

# Stage 2: Runtime
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(dpkg --print-architecture) \
       -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && apt-get purge -y curl && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/packages/desktop/resources/daemon.cjs ./daemon.cjs
COPY --from=build /app/node_modules/better-sqlite3/prebuilds/ ./prebuilds/

RUN useradd -m mainframe
USER mainframe

EXPOSE 31415
VOLUME /home/mainframe/.mainframe

HEALTHCHECK --interval=30s --timeout=5s \
  CMD node -e "fetch('http://127.0.0.1:31415/health').then(r=>{if(!r.ok)throw r})"

ENTRYPOINT ["node", "daemon.cjs"]
```

Cloudflared bundled — needed for both mobile tunnel and sandbox preview tunnels.

Usage:
```bash
# Localhost only
docker run -p 31415:31415 -v ~/.mainframe:/home/mainframe/.mainframe ghcr.io/qlan-ro/mainframe-daemon

# With tunnel
docker run -p 31415:31415 -e TUNNEL=true -v ~/.mainframe:/home/mainframe/.mainframe ghcr.io/qlan-ro/mainframe-daemon

# User-provided tunnel (no cloudflared spawned)
docker run -p 31415:31415 -e TUNNEL_URL=https://mainframe.mysite.com -v ~/.mainframe:/home/mainframe/.mainframe ghcr.io/qlan-ro/mainframe-daemon

# Pairing
docker exec <container> node daemon.cjs pair
```

### 6. Standalone Binary

GitHub Actions matrix builds for 4 targets: `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`.

Each build produces a tarball `mainframe-daemon-{os}-{arch}.tar.gz`:

```
mainframe-daemon-darwin-arm64/
  bin/
    mainframe-daemon    # shell wrapper: exec node daemon.cjs "$@"
    node                # platform Node.js binary
    cloudflared         # platform cloudflared binary
  lib/
    daemon.cjs
    better-sqlite3.node
```

Bundles Node 24 binary so users don't need Node installed. ~50MB per platform.

### 7. Install Script

`scripts/install.sh` — hosted at repo root, invoked via:

```bash
curl -fsSL https://raw.githubusercontent.com/qlan-ro/mainframe/main/scripts/install.sh | sh
```

The script:
1. Detects OS + arch (`uname -s`, `uname -m`)
2. Downloads matching tarball from latest GitHub release
3. Extracts to `~/.mainframe/bin/`
4. Prints PATH instruction if not already in PATH
5. Prints: `Run 'mainframe-daemon' to start`

Re-running the script updates the installation (overwrites existing files).

## Decisions

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Native deps | Prebuilt binaries per platform | Proven pattern, same as desktop app |
| Base image | `node:24-slim` | Latest LTS, compatible, no musl issues |
| Arg parsing | `process.argv[2]` switch | Zero deps, only 3 commands |
| Token persistence | Informational `devices` table | Tokens are HMAC-stateless; table is for UX (list/revoke) |
| Token revocation | Delete device row (soft) | Per-device denylist is overkill for v1 |
| QR library | `qrcode-terminal` | ~15KB, no native deps |
| Tunnel in Docker | Bundled cloudflared | Needed for sandbox previews anyway |
| Install targets | macOS + Linux (arm64 + x64) | Covers primary user base; Windows uses Docker |
| Auth secret | Auto-generate on first run | Zero-config for end users |
