import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createServerManager, type ServerManagerDeps } from '../index.js';

function createMockDeps(): ServerManagerDeps {
  return {
    db: {
      projects: { get: vi.fn() },
      chats: { get: vi.fn() },
      settings: { get: vi.fn() },
      devices: {},
    } as unknown as ServerManagerDeps['db'],
    chats: { on: vi.fn(), setPushService: vi.fn() } as unknown as ServerManagerDeps['chats'],
    adapters: { get: vi.fn() } as unknown as ServerManagerDeps['adapters'],
  };
}

function listenEphemeral(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
    });
  });
}

describe('ServerManager.start error handling', () => {
  let blocker: Server | null = null;

  afterEach(async () => {
    if (blocker) {
      await new Promise<void>((resolve) => blocker!.close(() => resolve()));
      blocker = null;
    }
  });

  it('rejects with EADDRINUSE instead of crashing when the port is already bound', async () => {
    blocker = createServer();
    const port = await listenEphemeral(blocker);

    const manager = createServerManager(createMockDeps());

    await expect(manager.start(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
