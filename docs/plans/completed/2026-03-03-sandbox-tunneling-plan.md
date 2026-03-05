# Sandbox Tunneling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the mobile sandbox WebView load dev servers through Cloudflare tunnels managed by the daemon.

**Architecture:** The daemon spawns `cloudflared` quick tunnels — one for itself (on startup, if configured) and one per `preview: true` launch process. Tunnel URLs are broadcast over WebSocket so the mobile app can load them in the WebView.

**Tech Stack:** Node.js child_process, cloudflared CLI, Zustand, React Native WebView

---

### Task 1: Add `launch.tunnel` event type

**Files:**
- Modify: `packages/types/src/events.ts`

**Step 1: Add the new event to the DaemonEvent union**

In `packages/types/src/events.ts`, add after the `launch.status` line (line 32):

```ts
| { type: 'launch.tunnel'; projectId: string; name: string; url: string }
```

**Step 2: Build types package**

Run: `pnpm --filter @mainframe/types build`
Expected: Clean build, no errors

**Step 3: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat(types): add launch.tunnel event type"
```

---

### Task 2: Add tunnel config to MainframeConfig

**Files:**
- Modify: `packages/core/src/config.ts`

**Step 1: Extend the MainframeConfig interface**

Add two optional fields:

```ts
export interface MainframeConfig {
  port: number;
  dataDir: string;
  tunnel?: boolean;
  tunnelUrl?: string;
}
```

**Step 2: Read env var overrides in getConfig()**

After the existing `PORT` and `MAINFRAME_DATA_DIR` overrides, add:

```ts
if (process.env['TUNNEL'] === 'true') {
  merged.tunnel = true;
}
if (process.env['TUNNEL_URL']) {
  merged.tunnelUrl = process.env['TUNNEL_URL'];
}
```

**Step 3: Build core**

Run: `pnpm --filter @mainframe/core build`
Expected: Clean build

**Step 4: Commit**

```bash
git add packages/core/src/config.ts
git commit -m "feat(core): add tunnel and tunnelUrl to config"
```

---

### Task 3: Create TunnelManager

**Files:**
- Create: `packages/core/src/tunnel/tunnel-manager.ts`
- Create: `packages/core/src/tunnel/index.ts`

**Step 1: Write the test**

Create `packages/core/src/__tests__/tunnel/tunnel-manager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TunnelManager } from '../../tunnel/tunnel-manager.js';

// We test the URL parsing logic and lifecycle, not actual cloudflared spawning.
// Integration tests with real cloudflared would be too slow/flaky for CI.

describe('TunnelManager', () => {
  let manager: TunnelManager;

  beforeEach(() => {
    manager = new TunnelManager();
  });

  afterEach(() => {
    manager.stopAll();
  });

  it('getUrl returns null for unknown label', () => {
    expect(manager.getUrl('nonexistent')).toBeNull();
  });

  it('parseUrl extracts trycloudflare URL from cloudflared stderr', () => {
    // Test the static helper directly
    const line =
      '2026-03-03T12:00:00Z INF +--------------------------------------------------------------------------------------------+';
    expect(TunnelManager.parseUrl(line)).toBeNull();

    const urlLine =
      '2026-03-03T12:00:00Z INF |  https://foo-bar-baz.trycloudflare.com                                                  |';
    expect(TunnelManager.parseUrl(urlLine)).toBe('https://foo-bar-baz.trycloudflare.com');

    const directLine =
      '2026-03-03T12:00:00Z INF https://abc-def.trycloudflare.com';
    expect(TunnelManager.parseUrl(directLine)).toBe('https://abc-def.trycloudflare.com');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/core test -- src/__tests__/tunnel/tunnel-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Implement TunnelManager**

Create `packages/core/src/tunnel/tunnel-manager.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createChildLogger } from '../logger.js';

const logger = createChildLogger('tunnel');
const URL_REGEX = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const STARTUP_TIMEOUT_MS = 20_000;

interface ManagedTunnel {
  process: ChildProcess;
  url: string;
  label: string;
}

export class TunnelManager {
  private tunnels = new Map<string, ManagedTunnel>();

  static parseUrl(line: string): string | null {
    const match = URL_REGEX.exec(line);
    return match ? match[0] : null;
  }

  async start(port: number, label: string): Promise<string> {
    if (this.tunnels.has(label)) {
      return this.tunnels.get(label)!.url;
    }

    logger.info({ port, label }, 'Starting tunnel');

    const child = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Tunnel startup timed out after ${STARTUP_TIMEOUT_MS}ms for ${label}`));
      }, STARTUP_TIMEOUT_MS);

      let resolved = false;

      const handleLine = (line: string) => {
        if (resolved) return;
        const url = TunnelManager.parseUrl(line);
        if (url) {
          resolved = true;
          clearTimeout(timeout);
          this.tunnels.set(label, { process: child, url, label });
          logger.info({ label, url }, 'Tunnel ready');
          resolve(url);
        }
      };

      // cloudflared prints the URL to stderr
      if (child.stderr) {
        const rl = createInterface({ input: child.stderr });
        rl.on('line', handleLine);
      }
      // Some versions also print to stdout
      if (child.stdout) {
        const rl = createInterface({ input: child.stdout });
        rl.on('line', handleLine);
      }

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (!resolved) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(new Error('cloudflared not found in PATH. Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
          } else {
            reject(err);
          }
        }
        this.tunnels.delete(label);
      });

      child.on('exit', (code) => {
        if (!resolved) {
          clearTimeout(timeout);
          reject(new Error(`cloudflared exited with code ${code} before producing a URL`));
        }
        this.tunnels.delete(label);
        logger.info({ label, code }, 'Tunnel exited');
      });
    });
  }

  stop(label: string): void {
    const tunnel = this.tunnels.get(label);
    if (!tunnel) return;
    logger.info({ label }, 'Stopping tunnel');
    tunnel.process.kill('SIGTERM');
    this.tunnels.delete(label);
  }

  stopAll(): void {
    for (const [label] of this.tunnels) {
      this.stop(label);
    }
  }

  getUrl(label: string): string | null {
    return this.tunnels.get(label)?.url ?? null;
  }
}
```

Create `packages/core/src/tunnel/index.ts`:

```ts
export { TunnelManager } from './tunnel-manager.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core test -- src/__tests__/tunnel/tunnel-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/tunnel/ packages/core/src/__tests__/tunnel/
git commit -m "feat(core): add TunnelManager for cloudflared quick tunnels"
```

---

### Task 4: Integrate TunnelManager into daemon startup

**Files:**
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/server/http.ts` (health endpoint)

**Step 1: Create TunnelManager in daemon entry and start main tunnel**

In `packages/core/src/index.ts`, after the `LaunchRegistry` creation (around line 36):

```ts
import { TunnelManager } from './tunnel/index.js';

// After launchRegistry creation:
const tunnelManager = new TunnelManager();
```

After `server.start(config.port)` succeeds (around line 65), add:

```ts
// Start main tunnel if configured
let daemonTunnelUrl = config.tunnelUrl ?? null;
if (config.tunnelUrl) {
  logger.info({ url: config.tunnelUrl }, 'Using pre-configured tunnel URL');
} else if (config.tunnel) {
  try {
    daemonTunnelUrl = await tunnelManager.start(config.port, 'daemon');
    logger.warn('Quick tunnels are ephemeral and not recommended for production. Use TUNNEL_URL with a named Cloudflare tunnel for stable deployments.');
  } catch (err) {
    logger.error({ err }, 'Failed to start daemon tunnel');
  }
}
```

Pass `tunnelManager` and `daemonTunnelUrl` to `createServerManager` (requires updating its signature — see step 2).

In shutdown, before `server.stop()`:

```ts
tunnelManager.stopAll();
```

**Step 2: Expose tunnel URL in GET /health**

In `packages/core/src/server/http.ts`, the health endpoint (line 62-64):

The `createHttpServer` function needs access to the tunnel URL. Add it to the `RouteContext` or pass it as a parameter. Simplest approach: add a `tunnelUrl` field to the health response by making it configurable.

Change `createHttpServer` to accept an optional `tunnelUrl` parameter (or add it to `RouteContext`):

```ts
// In http.ts, modify the health endpoint:
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tunnelUrl: ctx.tunnelUrl ?? null,
  });
});
```

Add `tunnelUrl?: string | null` to `RouteContext` in `packages/core/src/server/routes/types.ts`.

**Step 3: Build and verify**

Run: `pnpm --filter @mainframe/core build`
Expected: Clean build

**Step 4: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/server/http.ts packages/core/src/server/routes/types.ts
git commit -m "feat(core): start main tunnel on daemon startup when configured"
```

---

### Task 5: Integrate TunnelManager into LaunchManager

**Files:**
- Modify: `packages/core/src/launch/launch-manager.ts`
- Modify: `packages/core/src/launch/launch-registry.ts`

**Step 1: Write the test**

Create/extend `packages/core/src/__tests__/launch/launch-manager-tunnel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Test that LaunchManager calls tunnelManager.start for preview configs
// and tunnelManager.stop on process stop. Use a mock TunnelManager.

describe('LaunchManager tunnel integration', () => {
  it('starts a tunnel for preview configs with a port', async () => {
    // Mock TunnelManager, spawn, and verify tunnel is started
    // with label "preview:<name>" and the config port
  });

  it('stops the tunnel when the process is stopped', async () => {
    // Mock TunnelManager.stop and verify it is called with the right label
  });

  it('emits launch.tunnel event with the tunnel URL', async () => {
    // Verify onEvent is called with { type: 'launch.tunnel', ... }
  });
});
```

*Note: The exact mocking strategy depends on how spawn is mocked in existing launch tests. Check `packages/core/src/__tests__/routes/launch.test.ts` for patterns.*

**Step 2: Modify LaunchManager constructor to accept TunnelManager**

```ts
constructor(
  private projectId: string,
  private projectPath: string,
  private onEvent: (event: DaemonEvent) => void,
  private tunnelManager?: TunnelManager,
)
```

**Step 3: Start tunnel after process spawn succeeds**

In the `start()` method, after the process emits `running` status (the `spawn` event handler around line 75), add:

```ts
if (config.preview && config.port && this.tunnelManager) {
  this.tunnelManager
    .start(config.port, `preview:${config.name}`)
    .then((url) => {
      this.onEvent({ type: 'launch.tunnel', projectId: this.projectId, name: config.name, url });
    })
    .catch((err) => {
      logger.warn({ err, name: config.name }, 'Failed to start preview tunnel');
    });
}
```

**Step 4: Stop tunnel in stop()**

In the `stop()` method, add at the top:

```ts
this.tunnelManager?.stop(`preview:${name}`);
```

**Step 5: Pass TunnelManager through LaunchRegistry**

In `launch-registry.ts`, update constructor:

```ts
constructor(
  private onEvent: (event: DaemonEvent) => void,
  private tunnelManager?: TunnelManager,
)
```

And `getOrCreate`:

```ts
const manager = new LaunchManager(projectId, projectPath, this.onEvent, this.tunnelManager);
```

**Step 6: Wire in daemon entry**

In `packages/core/src/index.ts`, pass `tunnelManager` to `LaunchRegistry`:

```ts
const launchRegistry = new LaunchRegistry((event) => broadcastEvent(event), tunnelManager);
```

**Step 7: Run tests, build, commit**

Run: `pnpm --filter @mainframe/core test -- src/__tests__/launch/`
Run: `pnpm --filter @mainframe/core build`

```bash
git add packages/core/src/launch/ packages/core/src/index.ts packages/core/src/__tests__/launch/
git commit -m "feat(core): spawn preview tunnel on launch start, stop on launch stop"
```

---

### Task 6: Mobile — handle launch.tunnel events in store

**Files:**
- Modify: `packages/mobile/store/sandbox.ts`
- Modify: `packages/mobile/lib/event-router.ts`

**Step 1: Add tunnelUrls to sandbox store**

In `packages/mobile/store/sandbox.ts`, add to the state interface:

```ts
tunnelUrls: Map<string, string>;   // keyed by process name
setTunnelUrl: (processName: string, url: string) => void;
```

Implementation:

```ts
tunnelUrls: new Map(),
setTunnelUrl: (processName, url) =>
  set((state) => {
    const next = new Map(state.tunnelUrls);
    next.set(processName, url);
    return { tunnelUrls: next };
  }),
```

**Step 2: Route launch.tunnel events**

In `packages/mobile/lib/event-router.ts`, add a case in the switch:

```ts
case 'launch.tunnel':
  useSandboxStore.getState().setTunnelUrl(event.name, event.url);
  break;
```

**Step 3: Commit**

```bash
git add packages/mobile/store/sandbox.ts packages/mobile/lib/event-router.ts
git commit -m "feat(mobile): handle launch.tunnel events in sandbox store"
```

---

### Task 7: Mobile — wire sandbox screen to use tunnel URLs

**Files:**
- Modify: `packages/mobile/app/(tabs)/sandbox/index.tsx`

**Step 1: Replace hardcoded localhost URL with tunnel URL from store**

Remove `const DEFAULT_URL = 'http://localhost:3000'`.

Read the tunnel URL from the store:

```ts
const tunnelUrl = useSandboxStore((s) => {
  // Find the first tunnel URL (from any preview process)
  for (const [, url] of s.tunnelUrls) return url;
  return null;
});
```

Use `tunnelUrl` as the WebView source. When `null`, show a waiting/empty state instead of loading localhost:

```tsx
{tunnelUrl ? (
  <WebView source={{ uri: tunnelUrl }} ... />
) : (
  <View className="flex-1 items-center justify-center">
    <Text className="text-mf-text-secondary text-sm">
      Start a dev server to preview it here
    </Text>
  </View>
)}
```

**Step 2: Wire up LaunchConfigSheet**

The sandbox screen needs project context to call the launch API. Read the active project from the projects store:

```ts
const activeProjectId = useProjectsStore((s) => s.activeProjectId);
```

Fetch launch configs on mount:

```ts
const [configs, setConfigs] = useState<LaunchConfiguration[]>([]);

useEffect(() => {
  if (!activeProjectId) return;
  // Read launch status to populate the sheet
  getLaunchStatus(activeProjectId).then(/* map to configs */).catch(() => {});
}, [activeProjectId]);
```

Wire `onOpenLaunchConfig` to open the `LaunchConfigSheet` ref:

```ts
const launchSheetRef = useRef<BottomSheet>(null);
// ...
onOpenLaunchConfig={() => launchSheetRef.current?.snapToIndex(0)}
```

Wire the sheet callbacks to call `startLaunch`/`stopLaunch` from `lib/api.ts`.

**Step 3: Commit**

```bash
git add packages/mobile/app/(tabs)/sandbox/index.tsx
git commit -m "feat(mobile): sandbox loads tunnel URL, wire launch config sheet"
```

---

### Task 8: Add launch configs API for mobile

**Files:**
- Modify: `packages/core/src/server/routes/launch.ts`
- Modify: `packages/mobile/lib/api.ts`

The mobile app needs to know what launch configs exist (not just running statuses). Add an endpoint that reads and returns the parsed `launch.json`.

**Step 1: Add GET /api/projects/:id/launch/configs endpoint**

In `packages/core/src/server/routes/launch.ts`:

```ts
router.get('/api/projects/:id/launch/configs', async (req, res) => {
  const project = ctx.db.projects.getById(req.params.id);
  if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

  const configPath = join(project.path, '.mainframe', 'launch.json');
  try {
    const raw = await readFile(configPath, 'utf-8');
    const result = parseLaunchConfig(JSON.parse(raw));
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    res.json({ success: true, data: result.data.configurations });
  } catch {
    res.json({ success: true, data: [] });
  }
});
```

**Step 2: Add mobile API helper**

In `packages/mobile/lib/api.ts`:

```ts
export async function getLaunchConfigs(projectId: string): Promise<LaunchConfiguration[]> {
  const res = await fetchJson(`/api/projects/${projectId}/launch/configs`);
  return res.data ?? [];
}
```

**Step 3: Commit**

```bash
git add packages/core/src/server/routes/launch.ts packages/mobile/lib/api.ts
git commit -m "feat: add launch configs endpoint for mobile sandbox"
```

---

### Task 9: Export TunnelManager from core package

**Files:**
- Modify: `packages/core/src/launch/index.ts` (or create a top-level re-export)

**Step 1: Add export**

In `packages/core/src/launch/index.ts`, add:

```ts
export { TunnelManager } from '../tunnel/tunnel-manager.js';
```

Or if preferred, add to a separate barrel in `packages/core/src/tunnel/index.ts` and re-export from `packages/core/src/index.ts`. Follow existing export patterns.

**Step 2: Final build and typecheck**

Run: `pnpm build`
Run: `pnpm --filter @mainframe/core test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/core/
git commit -m "feat(core): export TunnelManager"
```
