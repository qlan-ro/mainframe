import { describe, it, expect, afterEach } from 'vitest';
import { createServer as createHttpServer, get as httpGet, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer, createConnection, type Server as NetServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { replaceStaleDaemon } from '../stale-daemon.js';

type AnyServer = HttpServer | NetServer;

function listenEphemeral(server: AnyServer): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
    });
  });
}

function listenOn(server: AnyServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
}

function closeServer(server: AnyServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function fetchHealth(port: number): Promise<{ statusCode: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let body: unknown = data;
        try {
          body = JSON.parse(data);
        } catch {
          /* leave as raw text */
        }
        resolve({ statusCode: res.statusCode ?? 0, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('health check timed out')));
    req.on('error', reject);
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

const STALE_CHILD_SCRIPT = `
const http = require('node:http');
const port = Number(process.argv[1]);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', version: '9.9.9-stale', pid: process.pid }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(port, '127.0.0.1');
`;

describe('replaceStaleDaemon', () => {
  const cleanups: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanups.length) {
      const fn = cleanups.pop()!;
      await fn();
    }
  });

  it('resolves port-free when nothing is listening on the port', async () => {
    const probe = createHttpServer();
    const port = await listenEphemeral(probe);
    await closeServer(probe);

    const result = await replaceStaleDaemon(port);

    expect(result).toBe('port-free');
  });

  it('resolves same-version and leaves the daemon running when health reports the caller own version', async () => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: '1.2.3' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const port = await listenEphemeral(server);
    cleanups.push(() => closeServer(server));

    const result = await replaceStaleDaemon(port, { ownVersion: '1.2.3' });

    expect(result).toBe('same-version');

    const followUp = await fetchHealth(port);
    expect(followUp).toEqual({ statusCode: 200, body: { status: 'ok', version: '1.2.3' } });
  });

  it('resolves foreign and leaves the process running when health returns 404', async () => {
    const server = createHttpServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    const port = await listenEphemeral(server);
    cleanups.push(() => closeServer(server));

    const result = await replaceStaleDaemon(port, { ownVersion: '1.2.3' });

    expect(result).toBe('foreign');

    const followUp = await fetchHealth(port);
    expect(followUp.statusCode).toBe(404);
  });

  it('resolves foreign and leaves the process running when health returns 200 with a non-Mainframe shape', async () => {
    const server = createHttpServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hello: 'world' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const port = await listenEphemeral(server);
    cleanups.push(() => closeServer(server));

    const result = await replaceStaleDaemon(port, { ownVersion: '1.2.3' });

    expect(result).toBe('foreign');

    const followUp = await fetchHealth(port);
    expect(followUp).toEqual({ statusCode: 200, body: { hello: 'world' } });
  });

  it('resolves replaced, kills the stale child, and frees the port when health reports a foreign version', async () => {
    const reserveProbe = createNetServer();
    const port = await listenEphemeral(reserveProbe);
    await closeServer(reserveProbe);

    const child: ChildProcess = spawn(process.execPath, ['-e', STALE_CHILD_SCRIPT, '--', String(port)], {
      stdio: 'ignore',
    });
    cleanups.push(() => {
      if (child.pid && isPidAlive(child.pid)) {
        try {
          process.kill(child.pid, 'SIGKILL');
        } catch {
          /* already dead */
        }
      }
    });

    await waitFor(async () => {
      try {
        const { statusCode } = await fetchHealth(port);
        return statusCode === 200;
      } catch {
        return false;
      }
    });

    const childPid = child.pid;
    expect(typeof childPid).toBe('number');

    const result = await replaceStaleDaemon(port, { ownVersion: '2.0.0', killSignalTimeoutMs: 2000 });

    expect(result).toBe('replaced');

    await waitFor(() => !isPidAlive(childPid as number), 3000);

    const freshServer = createNetServer();
    await listenOn(freshServer, port);
    await closeServer(freshServer);
  }, 10000);

  it('resolves foreign without hanging when the port is bound by a non-HTTP listener', async () => {
    const server = createNetServer((socket) => {
      socket.on('data', () => {
        /* never replies — simulates a non-HTTP occupant */
      });
    });
    const port = await listenEphemeral(server);
    cleanups.push(() => closeServer(server));

    const start = Date.now();
    const result = await replaceStaleDaemon(port, { ownVersion: '1.2.3' });
    const elapsedMs = Date.now() - start;

    expect(result).toBe('foreign');
    expect(elapsedMs).toBeLessThan(2500);

    const stillAlive = await canConnect(port);
    expect(stillAlive).toBe(true);
  }, 8000);
});
