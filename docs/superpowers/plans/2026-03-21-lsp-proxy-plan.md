# LSP Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daemon-hosted LSP proxy that spawns language servers (TypeScript, Python, Java) as child processes and forwards JSON-RPC over WebSocket to Monaco in the desktop app.

**Architecture:** The daemon spawns LSP servers lazily per (project, language), proxies JSON-RPC between WebSocket and stdio. The desktop connects via `monaco-languageclient`. Single-client model per LSP server, 10-minute idle timeout, graceful shutdown.

**Tech Stack:** `vscode-jsonrpc` (Content-Length framing), `monaco-languageclient` + `vscode-ws-jsonrpc` (desktop LSP client), `typescript-language-server` + `pyright` (bundled), `jdtls` (external).

**Spec:** `docs/superpowers/specs/2026-03-21-lsp-proxy-design.md`

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/desktop/package.json`

- [ ] **Step 1: Install core dependencies**

```bash
pnpm --filter @qlan-ro/mainframe-core add vscode-jsonrpc typescript-language-server typescript pyright
```

- [ ] **Step 2: Install desktop dependencies**

```bash
pnpm --filter @qlan-ro/mainframe-desktop add monaco-languageclient vscode-ws-jsonrpc
```

- [ ] **Step 3: Verify install succeeded**

```bash
pnpm install && pnpm --filter @qlan-ro/mainframe-core build
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/desktop/package.json pnpm-lock.yaml
git commit -m "chore: add LSP proxy dependencies"
```

---

### Task 2: Add LSP types to `@qlan-ro/mainframe-types`

**Files:**
- Create: `packages/types/src/lsp.ts`
- Modify: `packages/types/src/index.ts` (add `export * from './lsp.js'` after line 10)

- [ ] **Step 1: Create the types file**

Create `packages/types/src/lsp.ts`:

```ts
/** Configuration for an LSP server binary. */
export interface LspServerConfig {
  /** Language identifier: 'typescript', 'python', 'java' */
  id: string;
  /** File extensions this server handles: ['.ts', '.tsx', '.js', '.jsx'] */
  languages: string[];
  /** Server binary command or resolved path */
  command: string;
  /** CLI arguments: ['--stdio'] */
  args: string[];
  /** Whether the server is bundled with mainframe-core */
  bundled: boolean;
}

/** Per-language LSP availability status for a project. */
export interface LspLanguageStatus {
  id: string;
  installed: boolean;
  active: boolean;
}
```

- [ ] **Step 2: Export from types index**

In `packages/types/src/index.ts`, add after line 10 (`export * from './launch.js'`):

```ts
export * from './lsp.js';
```

- [ ] **Step 3: Build types and verify**

```bash
pnpm --filter @qlan-ro/mainframe-types build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/lsp.ts packages/types/src/index.ts
git commit -m "feat(types): add LspServerConfig and LspLanguageStatus"
```

---

### Task 3: Implement `lsp-registry.ts` — language → server config

**Files:**
- Create: `packages/core/src/lsp/lsp-registry.ts`
- Test: `packages/core/src/__tests__/lsp/lsp-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/lsp/lsp-registry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LspRegistry } from '../../lsp/lsp-registry.js';

describe('LspRegistry', () => {
  let registry: LspRegistry;

  beforeEach(() => {
    registry = new LspRegistry();
  });

  it('returns config for typescript', () => {
    const config = registry.getConfig('typescript');
    expect(config).toBeDefined();
    expect(config!.id).toBe('typescript');
    expect(config!.languages).toContain('.ts');
    expect(config!.languages).toContain('.tsx');
    expect(config!.languages).toContain('.js');
    expect(config!.languages).toContain('.jsx');
    expect(config!.bundled).toBe(true);
  });

  it('returns config for python', () => {
    const config = registry.getConfig('python');
    expect(config).toBeDefined();
    expect(config!.id).toBe('python');
    expect(config!.languages).toContain('.py');
    expect(config!.bundled).toBe(true);
  });

  it('returns config for java', () => {
    const config = registry.getConfig('java');
    expect(config).toBeDefined();
    expect(config!.id).toBe('java');
    expect(config!.languages).toContain('.java');
    expect(config!.bundled).toBe(false);
  });

  it('returns undefined for unknown language', () => {
    expect(registry.getConfig('rust')).toBeUndefined();
  });

  it('resolves language from file extension', () => {
    expect(registry.getLanguageForExtension('.ts')).toBe('typescript');
    expect(registry.getLanguageForExtension('.tsx')).toBe('typescript');
    expect(registry.getLanguageForExtension('.py')).toBe('python');
    expect(registry.getLanguageForExtension('.java')).toBe('java');
    expect(registry.getLanguageForExtension('.rs')).toBeNull();
  });

  it('lists all registered language IDs', () => {
    const ids = registry.getAllLanguageIds();
    expect(ids).toEqual(['typescript', 'python', 'java']);
  });

  describe('resolveCommand', () => {
    it('resolves bundled typescript server via createRequire', async () => {
      const result = await registry.resolveCommand('typescript');
      // Should resolve to node + path since typescript-language-server is installed
      expect(result).not.toBeNull();
      expect(result!.command).toBe(process.execPath);
      expect(result!.args[0]).toContain('typescript-language-server');
    });

    it('resolves bundled pyright server', async () => {
      const result = await registry.resolveCommand('python');
      expect(result).not.toBeNull();
      expect(result!.command).toBe(process.execPath);
      expect(result!.args[0]).toContain('pyright');
    });

    it('returns null for external server not on PATH', async () => {
      // jdtls is unlikely to be installed in CI/test environments
      const result = await registry.resolveCommand('java');
      // This may be null or non-null depending on environment; just check it doesn't throw
      expect(result === null || result !== null).toBe(true);
    });

    it('returns null for unknown language', async () => {
      const result = await registry.resolveCommand('rust');
      expect(result).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-registry.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

Create `packages/core/src/lsp/lsp-registry.ts`:

```ts
import type { LspServerConfig } from '@qlan-ro/mainframe-types';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createChildLogger } from '../logger.js';

const execFileAsync = promisify(execFile);
const log = createChildLogger('lsp-registry');

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveBundledBin(pkg: string): string {
  const resolved = require.resolve(`${pkg}/package.json`);
  const pkgDir = resolved.replace(/\/package\.json$/, '');
  return pkgDir;
}

const CONFIGS: LspServerConfig[] = [
  {
    id: 'typescript',
    languages: ['.ts', '.tsx', '.js', '.jsx'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    bundled: true,
  },
  {
    id: 'python',
    languages: ['.py', '.pyi'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    bundled: true,
  },
  {
    id: 'java',
    languages: ['.java'],
    command: 'jdtls',
    args: [],
    bundled: false,
  },
];

export class LspRegistry {
  private configs = new Map<string, LspServerConfig>();
  private extensionMap = new Map<string, string>();

  constructor() {
    for (const config of CONFIGS) {
      this.configs.set(config.id, config);
      for (const ext of config.languages) {
        this.extensionMap.set(ext, config.id);
      }
    }
  }

  getConfig(languageId: string): LspServerConfig | undefined {
    return this.configs.get(languageId);
  }

  getLanguageForExtension(ext: string): string | null {
    return this.extensionMap.get(ext) ?? null;
  }

  getAllLanguageIds(): string[] {
    return [...this.configs.keys()];
  }

  /** Resolve the command to spawn for a given language. Returns null if not installed. */
  async resolveCommand(languageId: string): Promise<{ command: string; args: string[] } | null> {
    const config = this.configs.get(languageId);
    if (!config) return null;

    if (config.bundled) {
      try {
        const pkgDir = resolveBundledBin(config.command === 'typescript-language-server'
          ? 'typescript-language-server'
          : 'pyright');
        // For bundled servers, run via node with the bin entry
        const binPath = config.command === 'typescript-language-server'
          ? `${pkgDir}/lib/cli.mjs`
          : `${pkgDir}/dist/pyright-langserver.js`;
        return { command: process.execPath, args: [binPath, ...config.args] };
      } catch {
        log.warn({ languageId }, 'Bundled LSP server package not found');
        return null;
      }
    }

    // External: check PATH
    try {
      await execFileAsync('/bin/sh', ['-c', `command -v ${config.command}`]);
      return { command: config.command, args: config.args };
    } catch {
      log.debug({ languageId, cmd: config.command }, 'External LSP server not found on PATH');
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-registry.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/lsp-registry.ts packages/core/src/__tests__/lsp/lsp-registry.test.ts
git commit -m "feat(core): add LSP registry with language configs"
```

---

### Task 4: Implement `lsp-proxy.ts` — stdio ↔ WebSocket forwarding

**Files:**
- Create: `packages/core/src/lsp/lsp-proxy.ts`
- Test: `packages/core/src/__tests__/lsp/lsp-proxy.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/lsp/lsp-proxy.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { bridgeWsToProcess, encodeJsonRpc } from '../../lsp/lsp-proxy.js';

function createMockWs() {
  const sent: string[] = [];
  return {
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    on: vi.fn(),
    readyState: 1, // OPEN
    sent,
  };
}

describe('encodeJsonRpc', () => {
  it('wraps JSON string with Content-Length header', () => {
    const json = '{"jsonrpc":"2.0","id":1}';
    const encoded = encodeJsonRpc(json);
    const expected = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    expect(encoded).toBe(expected);
  });
});

describe('bridgeWsToProcess', () => {
  let stdin: PassThrough;
  let stdout: PassThrough;
  let stderr: PassThrough;

  beforeEach(() => {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
  });

  it('forwards WS message to stdin with Content-Length framing', () => {
    const ws = createMockWs();
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk) => chunks.push(chunk));

    const onMessage = vi.fn();
    ws.on.mockImplementation((event: string, cb: Function) => {
      if (event === 'message') onMessage.mockImplementation(cb);
    });

    bridgeWsToProcess(ws as any, stdin, stdout, stderr);

    const json = '{"jsonrpc":"2.0","id":1,"method":"initialize"}';
    onMessage(json);

    const written = Buffer.concat(chunks).toString();
    expect(written).toContain('Content-Length:');
    expect(written).toContain(json);
  });

  it('forwards stdout Content-Length messages to WS', async () => {
    const ws = createMockWs();
    ws.on.mockImplementation(() => {});

    bridgeWsToProcess(ws as any, stdin, stdout, stderr);

    const json = '{"jsonrpc":"2.0","id":1,"result":{}}';
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    stdout.write(frame);

    // Give the stream reader time to process
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.send).toHaveBeenCalledWith(json);
  });

  it('returns a cleanup function that removes listeners', () => {
    const ws = createMockWs();
    ws.on.mockImplementation(() => {});

    const cleanup = bridgeWsToProcess(ws as any, stdin, stdout, stderr);
    cleanup();

    // After cleanup, stdout data should not be forwarded
    const json = '{"jsonrpc":"2.0","id":2}';
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    stdout.write(frame);

    expect(ws.send).not.toHaveBeenCalled();
  });

  it('does not send to WS when WS is not open', async () => {
    const ws = createMockWs();
    ws.readyState = 3; // WebSocket.CLOSED
    ws.on.mockImplementation(() => {});

    bridgeWsToProcess(ws as any, stdin, stdout, stderr);

    const json = '{"jsonrpc":"2.0","id":1}';
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    stdout.write(frame);

    await new Promise((r) => setTimeout(r, 50));
    expect(ws.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-proxy.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the proxy**

Create `packages/core/src/lsp/lsp-proxy.ts`:

```ts
import type { Writable, Readable } from 'node:stream';
import type { WebSocket } from 'ws';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('lsp-proxy');

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');

/** Wrap a JSON string with LSP Content-Length header. */
export function encodeJsonRpc(json: string): string {
  const byteLength = Buffer.byteLength(json, 'utf-8');
  return `Content-Length: ${byteLength}\r\n\r\n${json}`;
}

/**
 * Bridge a WebSocket to an LSP server's stdin/stdout.
 *
 * Uses Buffer throughout the stdout parser to correctly handle
 * Content-Length (which is byte length, not character length) with
 * multi-byte UTF-8 content.
 *
 * Returns a cleanup function.
 */
export function bridgeWsToProcess(
  ws: WebSocket,
  stdin: Writable,
  stdout: Readable,
  stderr: Readable,
): () => void {
  let buffer = Buffer.alloc(0);

  // WS → stdin
  const onWsMessage = (data: string | Buffer) => {
    const json = typeof data === 'string' ? data : data.toString('utf-8');
    try {
      stdin.write(encodeJsonRpc(json));
    } catch (err) {
      log.error({ err }, 'Failed to write to LSP stdin');
    }
  };
  ws.on('message', onWsMessage);

  // stdout → WS (Content-Length framing parser using Buffer for byte-accurate parsing)
  const onStdoutData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) break;

      const header = buffer.subarray(0, headerEnd).toString('ascii');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        log.warn({ header }, 'Malformed LSP header, discarding');
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const contentStart = headerEnd + 4;
      if (buffer.length < contentStart + contentLength) break; // wait for more data

      const json = buffer.subarray(contentStart, contentStart + contentLength).toString('utf-8');
      buffer = buffer.subarray(contentStart + contentLength);

      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(json);
      }
    }
  };
  stdout.on('data', onStdoutData);

  // stderr → log
  const onStderrData = (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (text) log.debug({ stderr: text }, 'LSP server stderr');
  };
  stderr.on('data', onStderrData);

  return () => {
    ws.removeListener('message', onWsMessage);
    stdout.removeListener('data', onStdoutData);
    stderr.removeListener('data', onStderrData);
  };
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-proxy.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/lsp-proxy.ts packages/core/src/__tests__/lsp/lsp-proxy.test.ts
git commit -m "feat(core): add LSP stdio-to-WebSocket proxy bridge"
```

---

### Task 5: Implement `lsp-manager.ts` — lifecycle management

**Files:**
- Create: `packages/core/src/lsp/lsp-manager.ts`
- Test: `packages/core/src/__tests__/lsp/lsp-manager.test.ts`

This is the core lifecycle manager. It owns spawning, caching, idle timeout, and graceful shutdown of LSP server processes.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/lsp/lsp-manager.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LspManager } from '../../lsp/lsp-manager.js';
import { LspRegistry } from '../../lsp/lsp-registry.js';

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const { PassThrough } = require('node:stream');
    const { EventEmitter } = require('node:events');
    const proc = new EventEmitter();
    proc.stdin = new PassThrough();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.pid = 12345;
    proc.kill = vi.fn();
    return proc;
  }),
}));

// Mock fs/promises stat
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
}));

describe('LspManager', () => {
  let manager: LspManager;
  let registry: LspRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new LspRegistry();
    // Mock resolveCommand to always succeed for typescript
    vi.spyOn(registry, 'resolveCommand').mockResolvedValue({
      command: '/usr/bin/node',
      args: ['/path/to/server.js', '--stdio'],
    });
    manager = new LspManager(registry);
  });

  afterEach(async () => {
    await manager.shutdownAll();
    vi.useRealTimers();
  });

  it('spawns a new server for unknown key', async () => {
    const handle = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle).toBeDefined();
    expect(handle.language).toBe('typescript');
    expect(handle.projectPath).toBe('/path/to/project');
  });

  it('returns existing handle for same key', async () => {
    const h1 = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    const h2 = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(h1).toBe(h2);
  });

  it('deduplicates concurrent spawn calls', async () => {
    const [h1, h2] = await Promise.all([
      manager.getOrSpawn('proj1', 'typescript', '/path/to/project'),
      manager.getOrSpawn('proj1', 'typescript', '/path/to/project'),
    ]);
    expect(h1).toBe(h2);
    // spawn should only have been called once
    const { spawn } = await import('node:child_process');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('reports active languages for a project', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    const active = manager.getActiveLanguages('proj1');
    expect(active).toContain('typescript');
    expect(active).not.toContain('python');
  });

  it('shutdown removes handle', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    await manager.shutdown('proj1', 'typescript');
    const active = manager.getActiveLanguages('proj1');
    expect(active).not.toContain('typescript');
  });

  it('shutdownAll clears all handles', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    await manager.getOrSpawn('proj2', 'typescript', '/path/to/project2');
    await manager.shutdownAll();
    expect(manager.getActiveLanguages('proj1')).toHaveLength(0);
    expect(manager.getActiveLanguages('proj2')).toHaveLength(0);
  });

  it('starts idle timer on spawn (no client connected)', async () => {
    const handle = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle.idleTimer).not.toBeNull();
  });

  it('cancels idle timer when getOrSpawn returns existing handle', async () => {
    const handle = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle.idleTimer).not.toBeNull();
    // Access again — timer should be reset (cancelled and restarted internally)
    const handle2 = await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(handle2).toBe(handle);
  });

  it('idle timer fires and shuts down server after timeout', async () => {
    await manager.getOrSpawn('proj1', 'typescript', '/path/to/project');
    expect(manager.getActiveLanguages('proj1')).toContain('typescript');

    // Advance past 10-minute idle timeout
    vi.advanceTimersByTime(10 * 60 * 1000 + 100);
    // Allow async shutdown to complete
    await vi.runAllTimersAsync();

    expect(manager.getActiveLanguages('proj1')).not.toContain('typescript');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-manager.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the manager**

Create `packages/core/src/lsp/lsp-manager.ts`:

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';
import type { LspRegistry } from './lsp-registry.js';
import { encodeJsonRpc } from './lsp-proxy.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('lsp-manager');

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SHUTDOWN_REQUEST_TIMEOUT_MS = 3_000;
const SHUTDOWN_EXIT_TIMEOUT_MS = 2_000;

export interface LspServerHandle {
  process: ChildProcess;
  language: string;
  projectPath: string;
  client: WebSocket | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  cleanup: (() => void) | null;
}

export class LspManager {
  private handles = new Map<string, LspServerHandle>();
  private spawning = new Map<string, Promise<LspServerHandle>>();

  constructor(private _registry: LspRegistry) {}

  get registry(): LspRegistry {
    return this._registry;
  }

  private key(projectId: string, language: string): string {
    return `${projectId}:${language}`;
  }

  async getOrSpawn(projectId: string, language: string, projectPath: string): Promise<LspServerHandle> {
    const k = this.key(projectId, language);

    const existing = this.handles.get(k);
    if (existing) {
      this.cancelIdleTimer(existing);
      return existing;
    }

    // Deduplicate concurrent spawns
    const inflight = this.spawning.get(k);
    if (inflight) return inflight;

    const promise = this.doSpawn(k, language, projectPath);
    this.spawning.set(k, promise);
    try {
      const handle = await promise;
      return handle;
    } finally {
      this.spawning.delete(k);
    }
  }

  private async doSpawn(key: string, language: string, projectPath: string): Promise<LspServerHandle> {
    const resolved = await this._registry.resolveCommand(language);
    if (!resolved) {
      throw new Error(`LSP server for '${language}' is not installed`);
    }

    log.info({ language, projectPath, command: resolved.command }, 'Spawning LSP server');

    const child = spawn(resolved.command, resolved.args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const handle: LspServerHandle = {
      process: child,
      language,
      projectPath,
      client: null,
      idleTimer: null,
      cleanup: null,
    };

    child.on('exit', (code, signal) => {
      log.info({ language, projectPath, code, signal }, 'LSP server exited');
      this.removeHandle(key, handle);
    });

    child.on('error', (err) => {
      log.error({ err, language, projectPath }, 'LSP server process error');
      this.removeHandle(key, handle);
    });

    this.handles.set(key, handle);

    // Start idle timer immediately (no client connected yet)
    this.startIdleTimer(key, handle);

    return handle;
  }

  private removeHandle(key: string, handle: LspServerHandle): void {
    this.cancelIdleTimer(handle);
    handle.cleanup?.();
    if (handle.client && handle.client.readyState === 1) {
      handle.client.close(1001, 'LSP server exited');
    }
    handle.client = null;
    this.handles.delete(key);
  }

  startIdleTimer(key: string, handle: LspServerHandle): void {
    this.cancelIdleTimer(handle);
    handle.idleTimer = setTimeout(() => {
      log.info({ key }, 'LSP server idle timeout, shutting down');
      this.shutdown(
        key.split(':')[0]!,
        key.split(':')[1]!,
      ).catch((err) => log.error({ err, key }, 'Error during idle shutdown'));
    }, IDLE_TIMEOUT_MS);
  }

  cancelIdleTimer(handle: LspServerHandle): void {
    if (handle.idleTimer) {
      clearTimeout(handle.idleTimer);
      handle.idleTimer = null;
    }
  }

  async shutdown(projectId: string, language: string): Promise<void> {
    const k = this.key(projectId, language);
    const handle = this.handles.get(k);
    if (!handle) return;

    this.cancelIdleTimer(handle);
    handle.cleanup?.();

    // Graceful LSP shutdown sequence
    const proc = handle.process;
    if (proc.stdin?.writable) {
      try {
        // Step 1: send shutdown request
        const shutdownReq = JSON.stringify({ jsonrpc: '2.0', id: 'shutdown', method: 'shutdown', params: null });
        proc.stdin.write(encodeJsonRpc(shutdownReq));

        // Step 2: wait for response (up to 3s)
        await Promise.race([
          new Promise<void>((resolve) => {
            proc.stdout?.once('data', () => resolve());
          }),
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_REQUEST_TIMEOUT_MS)),
        ]);

        // Step 3: send exit notification
        const exitNotif = JSON.stringify({ jsonrpc: '2.0', method: 'exit' });
        proc.stdin.write(encodeJsonRpc(exitNotif));

        // Step 4: wait for process to exit (up to 2s)
        await Promise.race([
          new Promise<void>((resolve) => proc.once('exit', () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_EXIT_TIMEOUT_MS)),
        ]);
      } catch (err) {
        log.warn({ err, language: handle.language }, 'Graceful shutdown sequence failed, force-killing');
      }
    }

    // Step 5: force kill if still alive
    if (!proc.killed) {
      proc.kill('SIGTERM');
    }

    if (handle.client && handle.client.readyState === 1) {
      handle.client.close(1000, 'LSP server shut down');
    }
    handle.client = null;
    this.handles.delete(k);
  }

  async shutdownAll(): Promise<void> {
    const keys = [...this.handles.keys()];
    await Promise.all(keys.map((k) => {
      const [projectId, language] = k.split(':');
      return this.shutdown(projectId!, language!);
    }));
  }

  getActiveLanguages(projectId: string): string[] {
    const result: string[] = [];
    for (const [key, handle] of this.handles) {
      if (key.startsWith(`${projectId}:`)) {
        result.push(handle.language);
      }
    }
    return result;
  }

  getHandle(projectId: string, language: string): LspServerHandle | undefined {
    return this.handles.get(this.key(projectId, language));
  }

}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-manager.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/lsp-manager.ts packages/core/src/__tests__/lsp/lsp-manager.test.ts
git commit -m "feat(core): add LSP server lifecycle manager"
```

---

### Task 6: Implement `lsp-connection.ts` — WebSocket upgrade + client tracking

**Files:**
- Create: `packages/core/src/lsp/lsp-connection.ts`
- Test: `packages/core/src/__tests__/lsp/lsp-connection.test.ts`

This module handles the HTTP upgrade for LSP WebSocket connections, wires the proxy bridge, and manages client tracking (single-client model).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/src/__tests__/lsp/lsp-connection.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { parseLspUpgradePath, LspConnectionHandler } from '../../lsp/lsp-connection.js';
import { LspManager } from '../../lsp/lsp-manager.js';
import { LspRegistry } from '../../lsp/lsp-registry.js';

describe('parseLspUpgradePath', () => {
  it('parses valid /lsp/:projectId/:language path', () => {
    const result = parseLspUpgradePath('/lsp/abc-123/typescript');
    expect(result).toEqual({ projectId: 'abc-123', language: 'typescript' });
  });

  it('parses path with query params', () => {
    const result = parseLspUpgradePath('/lsp/abc-123/python?token=xyz');
    expect(result).toEqual({ projectId: 'abc-123', language: 'python' });
  });

  it('returns null for non-LSP paths', () => {
    expect(parseLspUpgradePath('/')).toBeNull();
    expect(parseLspUpgradePath('/api/chats')).toBeNull();
    expect(parseLspUpgradePath('/lsp')).toBeNull();
    expect(parseLspUpgradePath('/lsp/abc')).toBeNull();
  });
});

describe('LspConnectionHandler.handleUpgrade', () => {
  function createMockSocket() {
    const socket = new PassThrough();
    const written: string[] = [];
    const origWrite = socket.write.bind(socket);
    socket.write = (chunk: any) => {
      written.push(chunk.toString());
      return origWrite(chunk);
    };
    return { socket, written, destroy: vi.fn() };
  }

  it('rejects upgrade for unknown projectId with 404', async () => {
    const registry = new LspRegistry();
    const manager = new LspManager(registry);
    const mockDb = { projects: { get: vi.fn().mockReturnValue(null) } } as any;
    const handler = new LspConnectionHandler(manager, mockDb);

    const { socket, written } = createMockSocket();
    await handler.handleUpgrade('unknown-id', 'typescript', {} as any, socket as any, Buffer.alloc(0));

    expect(written.some((w) => w.includes('404'))).toBe(true);
  });

  it('rejects upgrade for unsupported language with 404', async () => {
    const registry = new LspRegistry();
    const manager = new LspManager(registry);
    const mockDb = { projects: { get: vi.fn().mockReturnValue({ path: '/tmp/test' }) } } as any;
    const handler = new LspConnectionHandler(manager, mockDb);

    const { socket, written } = createMockSocket();
    await handler.handleUpgrade('proj-1', 'rust', {} as any, socket as any, Buffer.alloc(0));

    expect(written.some((w) => w.includes('404'))).toBe(true);
  });

  it('rejects upgrade with 409 when client already connected', async () => {
    const registry = new LspRegistry();
    vi.spyOn(registry, 'resolveCommand').mockResolvedValue({ command: 'node', args: ['--stdio'] });
    const manager = new LspManager(registry);
    const mockDb = { projects: { get: vi.fn().mockReturnValue({ path: '/tmp/test' }) } } as any;

    // Simulate an existing handle with a connected client
    const existingHandle = await manager.getOrSpawn('proj-1', 'typescript', '/tmp/test');
    existingHandle.client = { readyState: 1 } as any; // WebSocket.OPEN

    const handler = new LspConnectionHandler(manager, mockDb);
    const { socket, written } = createMockSocket();
    await handler.handleUpgrade('proj-1', 'typescript', {} as any, socket as any, Buffer.alloc(0));

    expect(written.some((w) => w.includes('409'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-connection.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the connection handler**

Create `packages/core/src/lsp/lsp-connection.ts`:

```ts
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { stat } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { LspManager, LspServerHandle } from './lsp-manager.js';
import type { DatabaseManager } from '../db/index.js';
import { bridgeWsToProcess } from './lsp-proxy.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('lsp-connection');

/** Parse /lsp/:projectId/:language from a URL path. Returns null if not an LSP path. */
export function parseLspUpgradePath(url: string): { projectId: string; language: string } | null {
  const pathname = url.split('?')[0] ?? '';
  const match = pathname.match(/^\/lsp\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { projectId: match[1]!, language: match[2]! };
}

export class LspConnectionHandler {
  private wss = new WebSocketServer({ noServer: true });

  constructor(
    private manager: LspManager,
    private db: DatabaseManager,
  ) {}

  /** Handle an HTTP upgrade for an LSP WebSocket connection. */
  async handleUpgrade(
    projectId: string,
    language: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // Validate project exists
    const project = this.db.projects.get(projectId);
    if (!project) {
      log.warn({ projectId, language }, 'LSP upgrade rejected: unknown project');
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Validate project path exists on disk
    try {
      await stat(project.path);
    } catch {
      log.warn({ projectId, path: project.path }, 'LSP upgrade rejected: project path not found');
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Check if language server is available
    const config = this.manager.registry.getConfig(language);
    if (!config) {
      log.warn({ language }, 'LSP upgrade rejected: unsupported language');
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Single-client check: reject if a client is already connected
    const existingHandle = this.manager.getHandle(projectId, language);
    if (existingHandle?.client && existingHandle.client.readyState === WebSocket.OPEN) {
      log.warn({ projectId, language }, 'LSP upgrade rejected: client already connected');
      socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
      socket.destroy();
      return;
    }

    // Spawn or get existing LSP server
    let handle: LspServerHandle;
    try {
      handle = await this.manager.getOrSpawn(projectId, language, project.path);
    } catch (err) {
      log.error({ err, projectId, language }, 'Failed to spawn LSP server');
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Complete the WebSocket upgrade
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.onConnection(ws, handle, projectId, language);
    });
  }

  private onConnection(ws: WebSocket, handle: LspServerHandle, projectId: string, language: string): void {
    log.info({ projectId, language }, 'LSP WebSocket client connected');

    // Cancel idle timer — a client is now connected
    this.manager.cancelIdleTimer(handle);
    handle.client = ws;

    // Bridge WS ↔ stdio
    const proc = handle.process;
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      log.error({ projectId, language }, 'LSP process missing stdio streams');
      ws.close(1011, 'LSP process error');
      return;
    }

    const cleanup = bridgeWsToProcess(ws, proc.stdin, proc.stdout, proc.stderr);
    handle.cleanup = cleanup;

    ws.on('close', () => {
      log.info({ projectId, language }, 'LSP WebSocket client disconnected');
      cleanup();
      handle.client = null;
      handle.cleanup = null;
      // Start idle timer
      const key = `${projectId}:${language}`;
      this.manager.startIdleTimer(key, handle);
    });

    ws.on('error', (err) => {
      log.error({ err, projectId, language }, 'LSP WebSocket error');
    });
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-connection.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/lsp/lsp-connection.ts packages/core/src/__tests__/lsp/lsp-connection.test.ts
git commit -m "feat(core): add LSP WebSocket upgrade and connection handler"
```

---

### Task 7: Create LSP module index + REST route

**Files:**
- Create: `packages/core/src/lsp/index.ts`
- Create: `packages/core/src/server/routes/lsp-routes.ts`
- Test: `packages/core/src/__tests__/lsp/lsp-routes.test.ts`

- [ ] **Step 1: Create LSP module index**

Create `packages/core/src/lsp/index.ts`:

```ts
export { LspRegistry } from './lsp-registry.js';
export { LspManager } from './lsp-manager.js';
export type { LspServerHandle } from './lsp-manager.js';
export { LspConnectionHandler, parseLspUpgradePath } from './lsp-connection.js';
export { bridgeWsToProcess, encodeJsonRpc } from './lsp-proxy.js';
```

- [ ] **Step 2: Write the failing route test**

Create `packages/core/src/__tests__/lsp/lsp-routes.test.ts`. Look at existing route tests like `packages/core/src/__tests__/routes/chats.test.ts` for the pattern. The LSP route takes its own context (not `RouteContext`) — just the `LspManager`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { lspRoutes } from '../../server/routes/lsp-routes.js';
import { LspRegistry } from '../../lsp/lsp-registry.js';
import { LspManager } from '../../lsp/lsp-manager.js';

describe('GET /api/lsp/languages', () => {
  let app: express.Express;
  let manager: LspManager;

  beforeEach(() => {
    const registry = new LspRegistry();
    vi.spyOn(registry, 'resolveCommand').mockImplementation(async (id) => {
      if (id === 'typescript') return { command: 'node', args: ['--stdio'] };
      if (id === 'python') return { command: 'node', args: ['--stdio'] };
      return null; // java not installed
    });
    manager = new LspManager(registry);

    app = express();
    app.use(lspRoutes(manager));
  });

  it('returns language status with valid projectId', async () => {
    const res = await request(app)
      .get('/api/lsp/languages')
      .query({ projectId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(res.status).toBe(200);
    expect(res.body.languages).toHaveLength(3);

    const ts = res.body.languages.find((l: any) => l.id === 'typescript');
    expect(ts).toEqual({ id: 'typescript', installed: true, active: false });

    const java = res.body.languages.find((l: any) => l.id === 'java');
    expect(java).toEqual({ id: 'java', installed: false, active: false });
  });

  it('rejects missing projectId', async () => {
    const res = await request(app).get('/api/lsp/languages');
    expect(res.status).toBe(400);
  });

  it('rejects invalid projectId format', async () => {
    const res = await request(app)
      .get('/api/lsp/languages')
      .query({ projectId: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-routes.test.ts
```

- [ ] **Step 4: Implement the route**

Create `packages/core/src/server/routes/lsp-routes.ts`:

```ts
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { LspManager } from '../../lsp/lsp-manager.js';
import type { LspLanguageStatus } from '@qlan-ro/mainframe-types';
import { asyncHandler } from './async-handler.js';

const LspLanguagesQuerySchema = z.object({
  projectId: z.string().uuid(),
});

export function lspRoutes(manager: LspManager): Router {
  const router = Router();

  router.get('/api/lsp/languages', asyncHandler(async (req: Request, res: Response) => {
    const parsed = LspLanguagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues });
      return;
    }

    const { projectId } = parsed.data;
    const activeLanguages = manager.getActiveLanguages(projectId);
    const allIds = manager.registry.getAllLanguageIds();

    const languages: LspLanguageStatus[] = await Promise.all(
      allIds.map(async (id) => {
        const resolved = await manager.registry.resolveCommand(id);
        return {
          id,
          installed: resolved !== null,
          active: activeLanguages.includes(id),
        };
      }),
    );

    res.json({ languages });
  }));

  return router;
}
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
pnpm --filter @qlan-ro/mainframe-core test -- src/__tests__/lsp/lsp-routes.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/lsp/index.ts packages/core/src/server/routes/lsp-routes.ts packages/core/src/__tests__/lsp/lsp-routes.test.ts
git commit -m "feat(core): add LSP module index and REST languages endpoint"
```

---

### Task 8: Wire LSP into daemon server

**Files:**
- Modify: `packages/core/src/server/websocket.ts`
- Modify: `packages/core/src/server/index.ts`
- Modify: `packages/core/src/server/http.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/server/routes/index.ts`

This task wires the `LspManager`, `LspConnectionHandler`, and LSP routes into the existing daemon infrastructure.

- [ ] **Step 1: Add LspManager and LspConnectionHandler to RouteContext is NOT needed**

The LSP route takes its own context (`LspManager`) directly, matching how `authRoutes` takes `{ pushService, devicesRepo }`. No changes to `RouteContext`.

- [ ] **Step 2: Update `websocket.ts` to route LSP upgrades**

In `packages/core/src/server/websocket.ts`:

1. Add import for `LspConnectionHandler` and `parseLspUpgradePath`
2. Update constructor to accept optional `LspConnectionHandler`
3. In `setupUpgradeAuth`, after auth validation, check if the URL is an LSP path and hand off to the connection handler

Key changes to the upgrade handler (after auth check at line 59):

```ts
// Before existing: this.wss.handleUpgrade(...)
const lspParsed = parseLspUpgradePath(request.url ?? '');
if (lspParsed && this.lspHandler) {
  this.lspHandler.handleUpgrade(
    lspParsed.projectId,
    lspParsed.language,
    request,
    socket,
    head,
  ).catch((err) => {
    log.error({ err }, 'LSP upgrade error');
    socket.destroy();
  });
  return;
}
// Existing chat WS upgrade
this.wss.handleUpgrade(request, socket, head, (ws) => { ... });
```

- [ ] **Step 3: Update `server/index.ts` — create LspManager and wire it**

In `packages/core/src/server/index.ts`:

1. Import `LspRegistry`, `LspManager`, `LspConnectionHandler` from `../lsp/index.js`
2. Add `db: DatabaseManager` and `lspManager?: LspManager` as optional params or create them inside
3. In `start()`, create `LspRegistry` → `LspManager` → `LspConnectionHandler(manager, db)`, pass handler to `WebSocketManager`
4. In `stop()`, call `lspManager.shutdownAll()` before closing the server

The `LspManager` is created inside `start()` (not passed in) to keep the external API simple. The route needs it too, so `createHttpServer` should accept an optional `LspManager`.

- [ ] **Step 4: Update `server/http.ts` — mount LSP route**

In `packages/core/src/server/http.ts`:

1. Import `lspRoutes` from `./routes/lsp-routes.js` (or from `./routes/index.js` after adding the export)
2. Accept optional `lspManager` parameter
3. Add `app.use(lspRoutes(lspManager))` when present, near the other route mounts

- [ ] **Step 5: Export lsp-routes from routes/index.ts**

Add to `packages/core/src/server/routes/index.ts`:

```ts
export { lspRoutes } from './lsp-routes.js';
```

- [ ] **Step 6: Build and typecheck**

```bash
pnpm --filter @qlan-ro/mainframe-core build
```
Expected: no type errors.

- [ ] **Step 7: Run all core tests to verify nothing is broken**

```bash
pnpm --filter @qlan-ro/mainframe-core test
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/server/websocket.ts packages/core/src/server/index.ts packages/core/src/server/http.ts packages/core/src/server/routes/index.ts packages/core/src/index.ts
git commit -m "feat(core): wire LSP manager into daemon server infrastructure"
```

---

### Task 9: Desktop — language detection module

**Files:**
- Create: `packages/desktop/src/renderer/lib/lsp/language-detection.ts`
- Create: `packages/desktop/src/renderer/lib/lsp/index.ts`

- [ ] **Step 1: Create language detection**

Create `packages/desktop/src/renderer/lib/lsp/language-detection.ts`:

```ts
const EXTENSION_TO_LSP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'typescript',
  '.jsx': 'typescript',
  '.py': 'python',
  '.pyi': 'python',
  '.java': 'java',
};

/** Get the LSP language server ID for a file path, or null if not supported. */
export function getLspLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf('.'));
  return EXTENSION_TO_LSP[ext] ?? null;
}

/** Check if a file extension has LSP support. */
export function hasLspSupport(filePath: string): boolean {
  return getLspLanguage(filePath) !== null;
}
```

- [ ] **Step 2: Write tests**

Create `packages/desktop/src/renderer/lib/lsp/__tests__/language-detection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getLspLanguage, hasLspSupport } from '../language-detection.js';

describe('getLspLanguage', () => {
  it('maps TypeScript extensions to typescript', () => {
    expect(getLspLanguage('foo.ts')).toBe('typescript');
    expect(getLspLanguage('bar.tsx')).toBe('typescript');
    expect(getLspLanguage('baz.js')).toBe('typescript');
    expect(getLspLanguage('qux.jsx')).toBe('typescript');
  });

  it('maps Python extensions to python', () => {
    expect(getLspLanguage('foo.py')).toBe('python');
    expect(getLspLanguage('bar.pyi')).toBe('python');
  });

  it('maps Java extension to java', () => {
    expect(getLspLanguage('Foo.java')).toBe('java');
  });

  it('returns null for unsupported extensions', () => {
    expect(getLspLanguage('foo.rs')).toBeNull();
    expect(getLspLanguage('bar.go')).toBeNull();
    expect(getLspLanguage('baz.md')).toBeNull();
  });
});

describe('hasLspSupport', () => {
  it('returns true for supported files', () => {
    expect(hasLspSupport('foo.ts')).toBe(true);
    expect(hasLspSupport('bar.py')).toBe(true);
  });

  it('returns false for unsupported files', () => {
    expect(hasLspSupport('foo.rs')).toBe(false);
  });
});
```

- [ ] **Step 3: Create module index**

Create `packages/desktop/src/renderer/lib/lsp/index.ts`:

```ts
export { getLspLanguage, hasLspSupport } from './language-detection.js';
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/lib/lsp/
git commit -m "feat(desktop): add LSP language detection module"
```

---

### Task 10: Desktop — LSP client manager

**Files:**
- Create: `packages/desktop/src/renderer/lib/lsp/lsp-client.ts`
- Modify: `packages/desktop/src/renderer/lib/lsp/index.ts`

This is the desktop-side class that manages `monaco-languageclient` connections to the daemon's LSP proxy WebSocket endpoints. It's the most complex desktop piece.

**Important:** Before implementing, check the actual API surface of `monaco-languageclient` and `vscode-ws-jsonrpc` by reading their installed `node_modules` type definitions or package READMEs. The API may differ from what the spec describes. Use `@context7` to look up current docs if needed.

- [ ] **Step 1: Research `monaco-languageclient` API**

Read:
- `node_modules/monaco-languageclient/package.json` — find entry point and exports
- `node_modules/vscode-ws-jsonrpc/package.json` — find `toSocket`, `WebSocketMessageReader`, `WebSocketMessageWriter`

Understand the exact import paths and class names before writing code.

- [ ] **Step 2: Implement `lsp-client.ts`**

Create `packages/desktop/src/renderer/lib/lsp/lsp-client.ts`:

The implementation should:
1. Export a singleton `LspClientManager` (or a factory function)
2. `ensureClient(projectId, language, projectPath)`:
   - Check map for existing client, return if connected
   - Create WebSocket to `ws://localhost:${port}/lsp/${projectId}/${language}`
   - Use `vscode-ws-jsonrpc` to wrap the socket for JSON-RPC
   - Create a `MonacoLanguageClient` with the wrapped connection
   - Start the client (which sends `initialize` with `workspaceFolders`)
   - Store in map
3. `disposeClient(projectId, language)`: stop and remove
4. `disposeAll()`: clean up everything
5. `getClient(projectId, language)`: get existing client or null
6. Handle WS close: remove from map, log

Use the daemon port from environment or default `31415`.

- [ ] **Step 3: Update index exports**

Add to `packages/desktop/src/renderer/lib/lsp/index.ts`:

```ts
export { LspClientManager } from './lsp-client.js';
```

- [ ] **Step 4: Build desktop to verify types**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/lsp/
git commit -m "feat(desktop): add LSP client manager for monaco-languageclient"
```

---

### Task 11: Desktop — integrate LSP with Monaco editor

**Files:**
- Modify: `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx`
- Modify: `packages/desktop/src/renderer/components/editor/navigation.ts`

- [ ] **Step 1: Update MonacoEditor to connect LSP on mount**

In `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx`:

1. Import `getLspLanguage` from `../../lib/lsp/language-detection.js`
2. Import the `LspClientManager` singleton
3. In the `handleMount` callback (around line 48), after the existing `registerDefinitionProvider` call:
   - Check if `filePath` has LSP support via `getLspLanguage(filePath)`
   - If yes, call `lspClientManager.ensureClient(projectId, lspLanguage, projectPath)` — this is async, fire-and-forget with `.catch(console.warn)`
   - The `monaco-languageclient` registers providers automatically once connected

The `projectId` and `projectPath` need to be passed as props or accessed from a store. Check how `EditorTab.tsx` accesses the active project — likely via `useProjectStore` or similar.

- [ ] **Step 2: Update navigation.ts — make it a fallback**

In `packages/desktop/src/renderer/components/editor/navigation.ts`:

Add a check at the top of `registerDefinitionProvider`: if the language has LSP support (via `hasLspSupport`), skip registration — the LSP client provides a better definition provider.

```ts
import { hasLspSupport } from '../../lib/lsp/index.js';

// Inside registerDefinitionProvider, before the for loop:
// Skip languages that have LSP support — monaco-languageclient provides richer providers
```

Filter out language IDs that map to LSP-supported extensions from the `config.languageIds` loop.

- [ ] **Step 3: Build desktop to verify**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/MonacoEditor.tsx packages/desktop/src/renderer/components/editor/navigation.ts
git commit -m "feat(desktop): integrate LSP client with Monaco editor"
```

---

### Task 12: Final verification and cleanup

**Files:** All modified files

- [ ] **Step 1: Build entire monorepo**

```bash
pnpm build
```
Expected: no errors.

- [ ] **Step 2: Run all core tests**

```bash
pnpm --filter @qlan-ro/mainframe-core test
```
Expected: all tests pass.

- [ ] **Step 3: Run desktop build**

```bash
pnpm --filter @qlan-ro/mainframe-desktop build
```
Expected: no type errors.

- [ ] **Step 4: Verify file sizes**

Check that no new file exceeds 300 lines:

```bash
wc -l packages/core/src/lsp/*.ts packages/desktop/src/renderer/lib/lsp/*.ts
```

- [ ] **Step 5: Final commit if any cleanup was needed**

Stage only the specific files that were cleaned up, then commit:

```bash
git add <specific-files> && git commit -m "chore: final cleanup for LSP proxy feature"
```

---

## Deferred: Symbol search (workspace/symbol)

The `workspace/symbol` integration for Cmd+P project-wide symbol search is intentionally deferred to a follow-up PR. This PR focuses on the core LSP proxy infrastructure and Monaco editor integration. Symbol search requires additional UI work (command palette component) that is out of scope here.
