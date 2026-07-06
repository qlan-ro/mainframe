/**
 * Integration tests for WebSocketManager file-subscribe relative-path resolution.
 *
 * The bug: subscribe:file with a repo-relative path (no leading '/') was silently
 * rejected because handleFileSubscribe only accepted absolute paths. These tests
 * verify the fix: a relative path + projectId resolves against the project base,
 * while absolute-path behavior stays unchanged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocketManager } from '../websocket.js';
import type { ChatManager } from '../../chat/index.js';
import type { FileWatcherService } from '../../files/file-watcher.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Connect to the WS server and wait until the `connection.ready` ack arrives.
 * Listeners are registered BEFORE the socket opens so no message is missed.
 */
function connectAndReady(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('error', reject);
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString()) as DaemonEvent;
      if (event.type === 'connection.ready') resolve(ws);
    });
  });
}

function waitForEvent(ws: WebSocket, type: string): Promise<DaemonEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 2000);
    const onMessage = (data: Buffer) => {
      const event = JSON.parse(data.toString()) as DaemonEvent;
      if (event.type === type) {
        clearTimeout(timer);
        ws.off('message', onMessage);
        resolve(event);
      }
    };
    ws.on('message', onMessage);
  });
}

function sendEvent(ws: WebSocket, event: object): void {
  ws.send(JSON.stringify(event));
}

// ---------------------------------------------------------------------------
// Fake FileWatcherService — captures subscribe/unsubscribe calls
// ---------------------------------------------------------------------------

class FakeFileWatcher implements Pick<FileWatcherService, 'subscribe' | 'unsubscribe'> {
  subscribed: string[] = [];
  unsubscribed: string[] = [];

  subscribe(absolutePath: string): void {
    this.subscribed.push(absolutePath);
  }

  unsubscribe(absolutePath: string): void {
    this.unsubscribed.push(absolutePath);
  }
}

// ---------------------------------------------------------------------------
// Fake ChatManager — minimal surface for getEffectivePath / getChatProjectId
// ---------------------------------------------------------------------------

function makeFakeChatManager(
  projectPath: string,
  chatId?: string,
  worktreePath?: string,
  /** projectId the chat belongs to (defaults to 'proj-1' when a chatId is provided) */
  chatProjectId = 'proj-1',
): ChatManager {
  return {
    getEffectivePath: (id: string) => {
      if (chatId && id === chatId) return worktreePath ?? projectPath;
      return null;
    },
    getProjectPath: (_id: string) => projectPath,
    getChatProjectId: (id: string) => {
      if (chatId && id === chatId) return chatProjectId;
      return null;
    },
  } as unknown as ChatManager;
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('WS subscribe:file — relative path resolution', () => {
  let server: Server;
  let manager: WebSocketManager;
  let port: number;
  let tmpDir: string;
  let fakeWatcher: FakeFileWatcher;
  let client: WebSocket;

  beforeEach(async () => {
    // Create a real temp directory with a real file so realpath + stat succeed.
    tmpDir = await mkdtemp(path.join(tmpdir(), 'mf-ws-test-'));
    await writeFile(path.join(tmpDir, 'hello.ts'), '// hello');

    fakeWatcher = new FakeFileWatcher();

    server = createServer();
    // No devices repo → localhost always allowed (no auth required).
    manager = new WebSocketManager(
      server,
      makeFakeChatManager(tmpDir),
      undefined,
      fakeWatcher as unknown as FileWatcherService,
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    client = await connectAndReady(port);
  });

  afterEach(async () => {
    client.close();
    manager.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Absolute path — behavior unchanged
  // -------------------------------------------------------------------------

  it('absolute path without projectId acks with resolved path', async () => {
    const absolutePath = path.join(tmpDir, 'hello.ts');
    const ackPromise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: absolutePath });
    const ack = await ackPromise;
    expect((ack as { requestedPath: string }).requestedPath).toBe(absolutePath);
    expect(fakeWatcher.subscribed.length).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Relative path + projectId — the core fix
  // -------------------------------------------------------------------------

  it('relative path + projectId resolves and acks with absolute path', async () => {
    const relativePath = 'hello.ts';
    const ackPromise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: relativePath, projectId: 'proj-1' });
    const ack = await ackPromise;
    const ackEvent = ack as { requestedPath: string; resolvedPath: string };
    expect(ackEvent.requestedPath).toBe(relativePath);
    // resolvedPath must be absolute. Use realpath for comparison because macOS
    // symlinks /tmp → /private/tmp, so resolvedPath will have the resolved form.
    const expectedResolved = await realpath(path.join(tmpDir, 'hello.ts'));
    expect(path.isAbsolute(ackEvent.resolvedPath)).toBe(true);
    expect(ackEvent.resolvedPath).toBe(expectedResolved);
    expect(fakeWatcher.subscribed[0]).toBe(ackEvent.resolvedPath);
  });

  // -------------------------------------------------------------------------
  // Relative path without projectId — still rejected (no resolution context)
  // -------------------------------------------------------------------------

  it('relative path without projectId is rejected — no ack arrives', async () => {
    let gotAck = false;
    client.on('message', (data) => {
      const event = JSON.parse(data.toString()) as DaemonEvent;
      if (event.type === 'subscribe:file:ack') gotAck = true;
    });
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts' });
    // Give the daemon time to process the message.
    await new Promise((r) => setTimeout(r, 300));
    expect(gotAck).toBe(false);
    expect(fakeWatcher.subscribed.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Path containment — relative path escaping the project base is rejected
  // -------------------------------------------------------------------------

  it('relative path that escapes the project base (../../etc/passwd) is rejected', async () => {
    let gotAck = false;
    client.on('message', (data) => {
      const event = JSON.parse(data.toString()) as DaemonEvent;
      if (event.type === 'subscribe:file:ack') gotAck = true;
    });
    sendEvent(client, { type: 'subscribe:file', path: '../../etc/passwd', projectId: 'proj-1' });
    await new Promise((r) => setTimeout(r, 300));
    expect(gotAck).toBe(false);
    expect(fakeWatcher.subscribed.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Unsubscribe symmetry — relative path removes the watch correctly
  // -------------------------------------------------------------------------

  it('unsubscribe with relative path removes the correct watch', async () => {
    const relativePath = 'hello.ts';
    // Subscribe first.
    const ackPromise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: relativePath, projectId: 'proj-1' });
    const ack = await ackPromise;
    const resolvedPath = (ack as { resolvedPath: string }).resolvedPath;
    expect(fakeWatcher.subscribed).toContain(resolvedPath);

    // Unsubscribe using the original relative path.
    sendEvent(client, { type: 'unsubscribe:file', path: relativePath, projectId: 'proj-1' });
    await new Promise((r) => setTimeout(r, 200));
    expect(fakeWatcher.unsubscribed).toContain(resolvedPath);
  });
});

// ---------------------------------------------------------------------------
// Fix 1: chat→project ownership validation
// ---------------------------------------------------------------------------

describe('WS subscribe:file — chat→project ownership check', () => {
  let server: Server;
  let manager: WebSocketManager;
  let port: number;
  let tmpDir: string;
  let fakeWatcher: FakeFileWatcher;
  let client: WebSocket;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'mf-ws-owner-'));
    await writeFile(path.join(tmpDir, 'hello.ts'), '// hello');

    fakeWatcher = new FakeFileWatcher();
    server = createServer();
    // chat 'chat-A' belongs to 'proj-1'; passing projectId 'proj-2' must be rejected.
    manager = new WebSocketManager(
      server,
      makeFakeChatManager(tmpDir, 'chat-A', undefined, 'proj-1'),
      undefined,
      fakeWatcher as unknown as FileWatcherService,
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    client = await connectAndReady(port);
  });

  afterEach(async () => {
    client.close();
    manager.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('rejects subscribe when chatId belongs to a different projectId than supplied', async () => {
    let gotAck = false;
    client.on('message', (data) => {
      const event = JSON.parse(data.toString()) as DaemonEvent;
      if (event.type === 'subscribe:file:ack') gotAck = true;
    });
    // chatId 'chat-A' belongs to 'proj-1', but the client claims 'proj-2'
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts', projectId: 'proj-2', chatId: 'chat-A' });
    await new Promise((r) => setTimeout(r, 300));
    expect(gotAck).toBe(false);
    expect(fakeWatcher.subscribed.length).toBe(0);
  });

  it('accepts subscribe when chatId belongs to the correct projectId', async () => {
    const ackPromise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts', projectId: 'proj-1', chatId: 'chat-A' });
    await ackPromise;
    expect(fakeWatcher.subscribed.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fix 2: composite key — same relative path under two different projects
// ---------------------------------------------------------------------------

describe('WS subscribe:file — composite key prevents collision', () => {
  let server: Server;
  let manager: WebSocketManager;
  let port: number;
  let tmpDir: string;
  let fakeWatcher: FakeFileWatcher;
  let client: WebSocket;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'mf-ws-composite-'));
    // Create hello.ts inside two project sub-dirs
    const proj1Dir = path.join(tmpDir, 'proj1');
    const proj2Dir = path.join(tmpDir, 'proj2');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(proj1Dir);
    await mkdir(proj2Dir);
    await writeFile(path.join(proj1Dir, 'hello.ts'), '// proj1');
    await writeFile(path.join(proj2Dir, 'hello.ts'), '// proj2');

    fakeWatcher = new FakeFileWatcher();
    server = createServer();

    // ChatManager that returns different projectPaths per projectId
    const fakeChats = {
      getEffectivePath: (_id: string) => null,
      getProjectPath: (id: string) => {
        if (id === 'proj-1') return proj1Dir;
        if (id === 'proj-2') return proj2Dir;
        return null;
      },
      getChatProjectId: (_id: string) => null,
    } as unknown as ChatManager;

    manager = new WebSocketManager(server, fakeChats, undefined, fakeWatcher as unknown as FileWatcherService);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as { port: number }).port;
    client = await connectAndReady(port);
  });

  afterEach(async () => {
    client.close();
    manager.close();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('second subscribe under a different project does not overwrite the first mapping', async () => {
    // Subscribe hello.ts under proj-1
    const ack1Promise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts', projectId: 'proj-1' });
    const ack1 = await ack1Promise;
    const resolved1 = (ack1 as { resolvedPath: string }).resolvedPath;

    // Subscribe hello.ts under proj-2 (same relative path, different project)
    const ack2Promise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts', projectId: 'proj-2' });
    const ack2 = await ack2Promise;
    const resolved2 = (ack2 as { resolvedPath: string }).resolvedPath;

    // Both absolute paths should differ
    expect(resolved1).not.toBe(resolved2);
    expect(fakeWatcher.subscribed.length).toBe(2);
  });

  it('unsubscribe under proj-1 does not remove the proj-2 watcher', async () => {
    const ack1Promise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts', projectId: 'proj-1' });
    const ack1 = await ack1Promise;
    const resolved1 = (ack1 as { resolvedPath: string }).resolvedPath;

    const ack2Promise = waitForEvent(client, 'subscribe:file:ack');
    sendEvent(client, { type: 'subscribe:file', path: 'hello.ts', projectId: 'proj-2' });
    const ack2 = await ack2Promise;
    const resolved2 = (ack2 as { resolvedPath: string }).resolvedPath;

    // Unsubscribe proj-1 only
    sendEvent(client, { type: 'unsubscribe:file', path: 'hello.ts', projectId: 'proj-1' });
    await new Promise((r) => setTimeout(r, 200));

    expect(fakeWatcher.unsubscribed).toContain(resolved1);
    // proj-2 must NOT be unsubscribed
    expect(fakeWatcher.unsubscribed).not.toContain(resolved2);
  });
});
