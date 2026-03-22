import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';

// Mock fs/promises so stat doesn't hit the filesystem
vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
}));

// Mock child_process.spawn while keeping execFile intact (used by lsp-registry)
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => makeMockProcess()),
  };
});

function makeMockProcess() {
  const proc = new EventEmitter() as NodeJS.EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 12345;
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    process.nextTick(() => proc.emit('exit', 0, null));
  });
  return proc;
}

import { parseLspUpgradePath } from '../../lsp/lsp-connection.js';

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
    const written: string[] = [];
    const socket = new PassThrough() as any;
    const origWrite = socket.write.bind(socket);
    socket.write = (chunk: any) => {
      written.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return origWrite(chunk);
    };
    socket.destroy = vi.fn();
    return { socket, written };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('rejects upgrade for unknown projectId with 404', async () => {
    const { LspConnectionHandler } = await import('../../lsp/lsp-connection.js');
    const { LspRegistry } = await import('../../lsp/lsp-registry.js');
    const { LspManager } = await import('../../lsp/lsp-manager.js');

    const registry = new LspRegistry();
    const manager = new LspManager(registry);
    const mockDb = { projects: { get: vi.fn().mockReturnValue(undefined) } } as any;
    const handler = new LspConnectionHandler(manager, mockDb);

    const { socket, written } = createMockSocket();
    await handler.handleUpgrade('unknown-id', 'typescript', {} as any, socket, Buffer.alloc(0));

    expect(written.some((w) => w.includes('404'))).toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects upgrade for unsupported language with 404', async () => {
    const { LspConnectionHandler } = await import('../../lsp/lsp-connection.js');
    const { LspRegistry } = await import('../../lsp/lsp-registry.js');
    const { LspManager } = await import('../../lsp/lsp-manager.js');

    const registry = new LspRegistry();
    const manager = new LspManager(registry);
    const mockDb = {
      projects: { get: vi.fn().mockReturnValue({ id: 'p1', path: '/tmp/test' }) },
    } as any;
    const handler = new LspConnectionHandler(manager, mockDb);

    const { socket, written } = createMockSocket();
    await handler.handleUpgrade('p1', 'rust', {} as any, socket, Buffer.alloc(0));

    expect(written.some((w) => w.includes('404'))).toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('rejects upgrade with 409 when client already connected', async () => {
    const { LspConnectionHandler } = await import('../../lsp/lsp-connection.js');
    const { LspRegistry } = await import('../../lsp/lsp-registry.js');
    const { LspManager } = await import('../../lsp/lsp-manager.js');

    const registry = new LspRegistry();
    vi.spyOn(registry, 'resolveCommand').mockResolvedValue({ command: 'node', args: ['--stdio'] });
    const manager = new LspManager(registry);
    const mockDb = {
      projects: { get: vi.fn().mockReturnValue({ id: 'p1', path: '/tmp/test' }) },
    } as any;

    // Spawn a handle and simulate a connected client
    const handle = await manager.getOrSpawn('p1', 'typescript', '/tmp/test');
    handle.client = { readyState: 1 } as any; // WebSocket.OPEN

    const handler = new LspConnectionHandler(manager, mockDb);
    const { socket, written } = createMockSocket();
    await handler.handleUpgrade('p1', 'typescript', {} as any, socket, Buffer.alloc(0));

    expect(written.some((w) => w.includes('409'))).toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });
});
