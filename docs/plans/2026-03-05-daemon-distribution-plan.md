# Daemon Distribution & CLI Pairing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package the mainframe daemon for end users (Docker image + standalone binary with install script) and add CLI pairing/status subcommands for headless mobile onboarding.

**Architecture:** Extend the daemon entry point with subcommand dispatch. Add a `devices` SQLite table for persistence. Bundle with esbuild (existing pipeline), ship prebuilt `better-sqlite3` per platform, include Node 24 + cloudflared binaries. Docker image uses `node:24-slim` multi-stage build.

**Tech Stack:** TypeScript, Node 24, esbuild, better-sqlite3, Docker, GitHub Actions, cloudflared, qrcode-terminal

---

### Task 1: Add `authSecret` to Config

**Files:**
- Modify: `packages/core/src/config.ts`

**Step 1: Add `authSecret` to `MainframeConfig` interface**

In `packages/core/src/config.ts`, add `authSecret` to the interface:

```typescript
export interface MainframeConfig {
  port: number;
  dataDir: string;
  tunnel?: boolean;
  tunnelUrl?: string;
  authSecret?: string;
}
```

**Step 2: Add `getAuthSecret()` helper**

Below `saveConfig()` in `packages/core/src/config.ts`, add:

```typescript
export function getAuthSecret(): string | null {
  if (process.env['AUTH_TOKEN_SECRET']) {
    return process.env['AUTH_TOKEN_SECRET'];
  }
  const config = getConfig();
  return config.authSecret ?? null;
}

export function ensureAuthSecret(): string {
  const existing = getAuthSecret();
  if (existing) return existing;

  const secret = randomBytes(32).toString('hex');
  saveConfig({ authSecret: secret });
  return secret;
}
```

Add `import { randomBytes } from 'node:crypto';` at the top.

**Step 3: Wire `ensureAuthSecret` into daemon startup**

In `packages/core/src/index.ts`, after `const config = getConfig();` (line 23), add:

```typescript
const authSecret = ensureAuthSecret();
process.env['AUTH_TOKEN_SECRET'] = authSecret;
logger.info('Auth secret loaded');
```

Import `ensureAuthSecret` from `'./config.js'`.

**Step 4: Typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: compiles with no errors

**Step 5: Commit**

```
feat(core): auto-generate auth secret on first startup
```

---

### Task 2: Devices SQLite Table & Repository

**Files:**
- Create: `packages/core/src/db/devices.ts`
- Modify: `packages/core/src/db/schema.ts`
- Modify: `packages/core/src/db/index.ts`
- Create: `packages/core/src/db/__tests__/devices.test.ts`

**Step 1: Write the failing test**

Create `packages/core/src/db/__tests__/devices.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DevicesRepository } from '../devices.js';

describe('DevicesRepository', () => {
  let db: Database.Database;
  let devices: DevicesRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id   TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        last_seen   INTEGER
      )
    `);
    devices = new DevicesRepository(db);
  });

  it('adds and retrieves a device', () => {
    devices.add('mobile-1', 'My iPhone');
    const all = devices.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.deviceId).toBe('mobile-1');
    expect(all[0]!.deviceName).toBe('My iPhone');
  });

  it('removes a device', () => {
    devices.add('mobile-1', 'My iPhone');
    devices.remove('mobile-1');
    expect(devices.getAll()).toHaveLength(0);
  });

  it('updates last_seen', () => {
    devices.add('mobile-1', 'My iPhone');
    devices.updateLastSeen('mobile-1');
    const all = devices.getAll();
    expect(all[0]!.lastSeen).toBeGreaterThan(0);
  });

  it('returns empty array when no devices', () => {
    expect(devices.getAll()).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core vitest run src/db/__tests__/devices.test.ts`
Expected: FAIL — `DevicesRepository` does not exist

**Step 3: Write `DevicesRepository`**

Create `packages/core/src/db/devices.ts`:

```typescript
import type Database from 'better-sqlite3';

export interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  createdAt: number;
  lastSeen: number | null;
}

export class DevicesRepository {
  constructor(private db: Database.Database) {}

  add(deviceId: string, deviceName: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO devices (device_id, device_name, created_at) VALUES (?, ?, ?)')
      .run(deviceId, deviceName, Date.now());
  }

  remove(deviceId: string): void {
    this.db.prepare('DELETE FROM devices WHERE device_id = ?').run(deviceId);
  }

  getAll(): DeviceRecord[] {
    const rows = this.db.prepare('SELECT device_id, device_name, created_at, last_seen FROM devices ORDER BY created_at DESC').all() as {
      device_id: string;
      device_name: string;
      created_at: number;
      last_seen: number | null;
    }[];
    return rows.map((r) => ({
      deviceId: r.device_id,
      deviceName: r.device_name,
      createdAt: r.created_at,
      lastSeen: r.last_seen,
    }));
  }

  updateLastSeen(deviceId: string): void {
    this.db.prepare('UPDATE devices SET last_seen = ? WHERE device_id = ?').run(Date.now(), deviceId);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core vitest run src/db/__tests__/devices.test.ts`
Expected: PASS (4 tests)

**Step 5: Add table to schema**

In `packages/core/src/db/schema.ts`, inside `initializeSchema()`, add after the existing `CREATE TABLE` statements:

```sql
CREATE TABLE IF NOT EXISTS devices (
  device_id   TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER
);
```

**Step 6: Register in `DatabaseManager`**

In `packages/core/src/db/index.ts`:
- Import `DevicesRepository` from `'./devices.js'`
- Add `public devices: DevicesRepository;` property
- In constructor, after `this.settings = ...`: `this.devices = new DevicesRepository(this.db);`
- Add export: `export { DevicesRepository } from './devices.js';`

**Step 7: Typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: compiles with no errors

**Step 8: Commit**

```
feat(core): add devices SQLite table and repository
```

---

### Task 3: Auth Routes — Device Persistence & New Endpoints

**Files:**
- Modify: `packages/core/src/server/routes/auth.ts`
- Modify: `packages/core/src/server/routes/__tests__/auth.test.ts`

**Step 1: Write failing tests for new endpoints**

Append to `packages/core/src/server/routes/__tests__/auth.test.ts`:

```typescript
import Database from 'better-sqlite3';
import { DevicesRepository } from '../../../db/devices.js';

// Inside the existing describe block, add:

describe('device endpoints', () => {
  let db: Database.Database;
  let devicesRepo: DevicesRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY, device_name TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen INTEGER
    )`);
    devicesRepo = new DevicesRepository(db);
    app = express();
    app.use(express.json());
    app.use(authRoutes({ devicesRepo }));
  });

  it('POST /api/auth/confirm persists device to DB', async () => {
    process.env.AUTH_TOKEN_SECRET = 'test-secret-at-least-32-characters-long!!';
    const pairRes = await request(app).post('/api/auth/pair').send({ deviceName: 'My iPhone' });
    await request(app).post('/api/auth/confirm').send({ pairingCode: pairRes.body.data.pairingCode });
    const devices = devicesRepo.getAll();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.deviceName).toBe('My iPhone');
  });

  it('GET /api/auth/devices lists paired devices', async () => {
    devicesRepo.add('mobile-1', 'iPhone');
    devicesRepo.add('mobile-2', 'iPad');
    const res = await request(app).get('/api/auth/devices');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('DELETE /api/auth/devices/:deviceId removes a device', async () => {
    devicesRepo.add('mobile-1', 'iPhone');
    const res = await request(app).delete('/api/auth/devices/mobile-1');
    expect(res.status).toBe(200);
    expect(devicesRepo.getAll()).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core vitest run src/server/routes/__tests__/auth.test.ts`
Expected: FAIL — `devicesRepo` option not accepted, endpoints don't exist

**Step 3: Update auth routes**

In `packages/core/src/server/routes/auth.ts`:

1. Update `AuthRouteOptions` interface:

```typescript
import type { DevicesRepository } from '../../db/devices.js';

export interface AuthRouteOptions {
  pushService?: PushService;
  devicesRepo?: DevicesRepository;
}
```

2. In `POST /api/auth/confirm` handler, after `const token = generateToken(...)`, persist the device:

```typescript
options?.devicesRepo?.add(deviceId, pairing.deviceName);
```

3. Add two new endpoints at end of `authRoutes()` function, before `return router`:

```typescript
router.get('/api/auth/devices', (_req, res) => {
  const devices = options?.devicesRepo?.getAll() ?? [];
  res.json({ success: true, data: devices });
});

router.delete('/api/auth/devices/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  options?.devicesRepo?.remove(deviceId);
  res.json({ success: true });
});
```

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core vitest run src/server/routes/__tests__/auth.test.ts`
Expected: ALL PASS

**Step 5: Wire `devicesRepo` in `http.ts`**

In `packages/core/src/server/http.ts`, update the `authRoutes` call (line 69):

```typescript
app.use(authRoutes({ pushService, devicesRepo: db.devices }));
```

**Step 6: Typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: compiles with no errors

**Step 7: Commit**

```
feat(core): persist paired devices in SQLite, add list/revoke endpoints
```

---

### Task 4: CLI Subcommand Dispatch

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/cli/pair.ts`
- Create: `packages/core/src/cli/status.ts`

**Step 1: Install `qrcode-terminal`**

Run: `pnpm --filter @mainframe/core add qrcode-terminal`
Run: `pnpm --filter @mainframe/core add -D @types/qrcode-terminal` (if types exist; otherwise add a `declare module` in a `.d.ts`)

**Step 2: Create `cli/pair.ts`**

Create `packages/core/src/cli/pair.ts`:

```typescript
import { getConfig } from '../config.js';
import qrcode from 'qrcode-terminal';

export async function runPair(): Promise<void> {
  const config = getConfig();
  const baseUrl = `http://127.0.0.1:${config.port}`;

  // Check daemon is running
  let healthData: { tunnelUrl?: string | null };
  try {
    const res = await fetch(`${baseUrl}/health`);
    healthData = await res.json() as { tunnelUrl?: string | null };
  } catch {
    console.error('Cannot reach daemon at %s. Is it running?', baseUrl);
    process.exit(1);
  }

  // Request pairing code
  const pairRes = await fetch(`${baseUrl}/api/auth/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceName: 'CLI pairing' }),
  });

  if (!pairRes.ok) {
    const body = await pairRes.json() as { error?: string };
    console.error('Pairing failed: %s', body.error ?? pairRes.statusText);
    process.exit(1);
  }

  const { pairingCode } = (await pairRes.json() as { data: { pairingCode: string } }).data;
  const tunnelUrl = healthData.tunnelUrl ?? null;

  console.log('\n  Pairing code: %s', pairingCode);
  console.log('  Expires in 5 minutes\n');

  if (tunnelUrl) {
    const qrPayload = JSON.stringify({ url: tunnelUrl, code: pairingCode });
    console.log('  Enter this code in the Mainframe mobile app, or scan the QR code:\n');
    qrcode.generate(qrPayload, { small: true });
    console.log('\n  Tunnel URL: %s', tunnelUrl);
  } else {
    console.log('  Enter this code in the Mainframe mobile app.');
    console.log('  No tunnel active — start daemon with TUNNEL=true for remote pairing.\n');
  }

  // Poll for device confirmation
  console.log('  Waiting for device to pair...');
  const startDevices = await fetchDevices(baseUrl);
  const startCount = startDevices.length;

  const pollInterval = setInterval(async () => {
    const devices = await fetchDevices(baseUrl);
    if (devices.length > startCount) {
      clearInterval(pollInterval);
      const newest = devices[0]!;
      console.log('\n  Device paired: %s (%s)\n', newest.deviceName, newest.deviceId);
      process.exit(0);
    }
  }, 2000);

  // Timeout after 5 minutes (matches pairing code expiry)
  setTimeout(() => {
    clearInterval(pollInterval);
    console.log('\n  Pairing code expired. Run `mainframe-daemon pair` to try again.\n');
    process.exit(1);
  }, 5 * 60 * 1000);
}

async function fetchDevices(baseUrl: string): Promise<{ deviceId: string; deviceName: string }[]> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/devices`);
    const body = await res.json() as { data: { deviceId: string; deviceName: string }[] };
    return body.data;
  } catch {
    return [];
  }
}
```

**Step 3: Create `cli/status.ts`**

Create `packages/core/src/cli/status.ts`:

```typescript
import { getConfig } from '../config.js';

export async function runStatus(): Promise<void> {
  const config = getConfig();
  const baseUrl = `http://127.0.0.1:${config.port}`;

  // Fetch health
  let health: { status: string; timestamp: string; tunnelUrl?: string | null };
  try {
    const res = await fetch(`${baseUrl}/health`);
    health = await res.json() as typeof health;
  } catch {
    console.error('Cannot reach daemon at %s. Is it running?', baseUrl);
    process.exit(1);
  }

  console.log('\n  Mainframe Daemon');
  console.log('  Status:     %s', health.status);
  console.log('  Port:       %d', config.port);
  console.log('  Tunnel:     %s', health.tunnelUrl ?? 'not active');
  console.log('  Data dir:   %s', config.dataDir);

  // Fetch devices
  try {
    const res = await fetch(`${baseUrl}/api/auth/devices`);
    const body = await res.json() as { data: { deviceId: string; deviceName: string; lastSeen: number | null }[] };
    const devices = body.data;

    if (devices.length === 0) {
      console.log('\n  Paired devices: none');
    } else {
      console.log('\n  Paired devices:');
      for (const d of devices) {
        const seen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : 'never';
        console.log('    - %s (%s) — last seen: %s', d.deviceName, d.deviceId, seen);
      }
    }
  } catch {
    console.log('\n  Could not fetch device list.');
  }

  console.log('');
  process.exit(0);
}
```

**Step 4: Update entry point with subcommand dispatch**

In `packages/core/src/index.ts`, replace the bottom section (lines 114-117):

```typescript
// Before:
main().catch((error) => { ... });

// After:
const subcommand = process.argv[2];

if (subcommand === 'pair') {
  import('./cli/pair.js').then(({ runPair }) => runPair());
} else if (subcommand === 'status') {
  import('./cli/status.js').then(({ runStatus }) => runStatus());
} else {
  main().catch((error) => {
    logger.fatal({ err: error }, 'Fatal error');
    process.exit(1);
  });
}
```

**Step 5: Typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: compiles with no errors

**Step 6: Manual smoke test**

Run: `pnpm dev:core` in one terminal.
Run: `pnpm --filter @mainframe/core exec tsx src/index.ts status` in another terminal.
Expected: prints daemon status with port 31415.

**Step 7: Commit**

```
feat(core): add CLI subcommands — pair and status
```

---

### Task 5: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Step 1: Create `.dockerignore`**

Create `.dockerignore` at repo root:

```
.git
node_modules
dist
packages/desktop
packages/mobile
packages/e2e
*.md
.env*
.claude
.DS_Store
```

**Step 2: Create `Dockerfile`**

Create `Dockerfile` at repo root:

```dockerfile
# Stage 1: Build
FROM node:24-slim AS build
RUN corepack enable pnpm
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/types/package.json packages/types/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY packages/types/ packages/types/
COPY packages/core/ packages/core/
COPY packages/desktop/scripts/bundle-daemon.mjs packages/desktop/scripts/
RUN pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build
RUN node packages/desktop/scripts/bundle-daemon.mjs

# Stage 2: Runtime
FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && ARCH=$(dpkg --print-architecture) \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
       -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/packages/desktop/resources/daemon.cjs ./daemon.cjs
COPY --from=build /app/node_modules/better-sqlite3/prebuilds/ ./prebuilds/

RUN useradd -m mainframe
USER mainframe

ENV NODE_ENV=production
EXPOSE 31415
VOLUME /home/mainframe/.mainframe

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:31415/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "daemon.cjs"]
```

**Step 3: Test Docker build locally**

Run: `docker build -t mainframe-daemon .`
Expected: builds successfully

Run: `docker run --rm -p 31415:31415 mainframe-daemon`
Expected: daemon starts, `curl http://localhost:31415/health` returns `{"status":"ok",...}`

**Step 4: Commit**

```
feat: add Dockerfile for standalone daemon image
```

---

### Task 6: Install Script

**Files:**
- Create: `scripts/install.sh`

**Step 1: Create `scripts/install.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="qlan-ro/mainframe"
INSTALL_DIR="${MAINFRAME_INSTALL_DIR:-$HOME/.mainframe/bin}"

# Detect OS
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $(uname -s). Use Docker instead." >&2; exit 1 ;;
esac

# Detect architecture
case "$(uname -m)" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

ARTIFACT="mainframe-daemon-${OS}-${ARCH}.tar.gz"
echo "Detected platform: ${OS}-${ARCH}"

# Get latest release URL
RELEASE_URL="https://api.github.com/repos/${REPO}/releases/latest"
echo "Fetching latest release..."
DOWNLOAD_URL=$(curl -fsSL "$RELEASE_URL" | grep "browser_download_url.*${ARTIFACT}" | head -1 | cut -d '"' -f 4)

if [ -z "$DOWNLOAD_URL" ]; then
  echo "No release found for ${ARTIFACT}. Check https://github.com/${REPO}/releases" >&2
  exit 1
fi

# Download and extract
echo "Downloading ${ARTIFACT}..."
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fsSL "$DOWNLOAD_URL" -o "${TMP_DIR}/${ARTIFACT}"

echo "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
tar -xzf "${TMP_DIR}/${ARTIFACT}" -C "$INSTALL_DIR" --strip-components=1

chmod +x "${INSTALL_DIR}/bin/mainframe-daemon"

# PATH check
if ! echo "$PATH" | tr ':' '\n' | grep -q "${INSTALL_DIR}/bin"; then
  echo ""
  echo "Add to your PATH:"
  echo "  export PATH=\"${INSTALL_DIR}/bin:\$PATH\""
  echo ""
  echo "Or add that line to your ~/.zshrc or ~/.bashrc"
fi

echo ""
echo "Installed mainframe-daemon to ${INSTALL_DIR}/bin/mainframe-daemon"
echo "Run 'mainframe-daemon' to start the daemon"
echo ""
```

**Step 2: Make executable**

Run: `chmod +x scripts/install.sh`

**Step 3: Commit**

```
feat: add install script for standalone daemon binary
```

---

### Task 7: GitHub Actions — Docker Build & Push

**Files:**
- Create: `.github/workflows/docker.yml`

**Step 1: Create workflow**

Create `.github/workflows/docker.yml`:

```yaml
name: Docker

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/setup-qemu-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/metadata-action@v5
        id: meta
        with:
          images: ghcr.io/${{ github.repository_owner }}/mainframe-daemon
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest

      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

```

**Step 2: Commit**

```
ci: add Docker build and push workflow
```

---

### Task 8: GitHub Actions — Standalone Binary Release

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `scripts/build-standalone.sh`

**Step 1: Create the build script**

Create `scripts/build-standalone.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: ./scripts/build-standalone.sh <os> <arch>
# Example: ./scripts/build-standalone.sh darwin arm64

OS="${1:?Usage: build-standalone.sh <os> <arch>}"
ARCH="${2:?Usage: build-standalone.sh <os> <arch>}"
NODE_VERSION="24"

DIST_NAME="mainframe-daemon-${OS}-${ARCH}"
DIST_DIR="dist-standalone/${DIST_NAME}"

echo "Building ${DIST_NAME}..."

rm -rf "$DIST_DIR"
mkdir -p "${DIST_DIR}/bin" "${DIST_DIR}/lib"

# 1. Bundle daemon
pnpm --filter @mainframe/types build
pnpm --filter @mainframe/core build
node packages/desktop/scripts/bundle-daemon.mjs
cp packages/desktop/resources/daemon.cjs "${DIST_DIR}/lib/"

# 2. Copy better-sqlite3 prebuild for target platform
PREBUILD_DIR="node_modules/better-sqlite3/prebuilds/${OS}-${ARCH}"
if [ ! -d "$PREBUILD_DIR" ]; then
  echo "No prebuild found at ${PREBUILD_DIR}" >&2
  exit 1
fi
cp -r "$PREBUILD_DIR" "${DIST_DIR}/lib/prebuilds/${OS}-${ARCH}"

# 3. Download Node.js binary for target platform
NODE_OS="$OS"
NODE_ARCH="$ARCH"
if [ "$ARCH" = "x64" ]; then NODE_ARCH="x64"; fi

NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}.0/node-v${NODE_VERSION}.0-${NODE_OS}-${NODE_ARCH}.tar.gz"
echo "Downloading Node.js ${NODE_VERSION} for ${NODE_OS}-${NODE_ARCH}..."
curl -fsSL "$NODE_URL" | tar -xz --strip-components=1 -C "${DIST_DIR}" "*/bin/node"

# 4. Download cloudflared for target platform
CF_OS="$OS"
CF_ARCH="$ARCH"
if [ "$OS" = "darwin" ]; then
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_OS}-${CF_ARCH}.tgz"
  curl -fsSL "$CF_URL" | tar -xz -C "${DIST_DIR}/bin/"
else
  if [ "$ARCH" = "x64" ]; then CF_ARCH="amd64"; fi
  CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
  curl -fsSL "$CF_URL" -o "${DIST_DIR}/bin/cloudflared"
fi
chmod +x "${DIST_DIR}/bin/cloudflared"

# 5. Create wrapper script
cat > "${DIST_DIR}/bin/mainframe-daemon" << 'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
export PATH="${SCRIPT_DIR}:${PATH}"
exec "${SCRIPT_DIR}/node" "${BASE_DIR}/lib/daemon.cjs" "$@"
WRAPPER
chmod +x "${DIST_DIR}/bin/mainframe-daemon"

# 6. Package
tar -czf "dist-standalone/${DIST_NAME}.tar.gz" -C dist-standalone "$DIST_NAME"
echo "Built: dist-standalone/${DIST_NAME}.tar.gz"
```

**Step 2: Create release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14
            target_os: darwin
            target_arch: arm64
          - os: macos-13
            target_os: darwin
            target_arch: x64
          - os: ubuntu-latest
            target_os: linux
            target_arch: x64
          - os: ubuntu-24.04-arm
            target_os: linux
            target_arch: arm64

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: bash scripts/build-standalone.sh ${{ matrix.target_os }} ${{ matrix.target_arch }}

      - uses: actions/upload-artifact@v4
        with:
          name: mainframe-daemon-${{ matrix.target_os }}-${{ matrix.target_arch }}
          path: dist-standalone/*.tar.gz

  release:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*.tar.gz
          generate_release_notes: true

```

**Step 3: Make build script executable**

Run: `chmod +x scripts/build-standalone.sh`

**Step 4: Commit**

```
ci: add standalone binary build and release workflow
```

---

### Task 9: Unprivate `@mainframe/core` for npm publish (optional)

**Files:**
- Modify: `packages/core/package.json`

**Step 1: Remove `"private": true`**

In `packages/core/package.json`, remove line 11: `"private": true,`

**Step 2: Add `"files"` field for npm publish**

Add to `packages/core/package.json`:

```json
"files": [
  "dist/**",
  "!dist/**/__tests__/**"
],
```

**Step 3: Commit**

```
chore(core): prepare package for npm publishing
```

> Note: This task is optional — the standalone binary and Docker image are the primary distribution channels. npm publishing can be added later if there's demand from Node.js users.

---

### Task 10: Update bundle-daemon.mjs for standalone use

**Files:**
- Modify: `packages/desktop/scripts/bundle-daemon.mjs`

The existing bundler hardcodes paths relative to the desktop package. For the Docker and standalone builds, the output path needs to work from repo root.

**Step 1: Make output path configurable**

In `packages/desktop/scripts/bundle-daemon.mjs`, update to accept an optional output path argument:

```javascript
const outfile = process.argv[2] ?? join(__dirname, '../resources/daemon.cjs');
```

This keeps the existing behavior for the desktop build while allowing the standalone build to specify a different output path.

**Step 2: Typecheck desktop build still works**

Run: `pnpm --filter @mainframe/desktop run build`
Expected: daemon.cjs is created in `packages/desktop/resources/`

**Step 3: Commit**

```
chore: make bundle-daemon output path configurable
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md` (if it exists and is user-facing)
- Modify: `packages/core/package.json` (add `"start:pair"` script)

**Step 1: Add convenience scripts to core package.json**

```json
"scripts": {
  ...existing,
  "pair": "node dist/index.js pair",
  "status": "node dist/index.js status"
}
```

**Step 2: Commit**

```
docs: add daemon distribution usage instructions
```

---

Plan complete and saved to `docs/plans/2026-03-05-daemon-distribution-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints

Which approach?