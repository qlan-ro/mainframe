import type { Page, WebSocketRoute } from '@playwright/test';
import { DAEMON_PORT } from '../../fixtures/daemon.js';

export interface WsControl {
  /** Sever every CURRENT daemon WebSocket (side-band `/` AND facade `/acp/*`). Each client
   *  sees onclose and auto-reconnects through this same route (ws-client: 500ms base;
   *  AcpFacadeClient: 1s base), incrementing the counts. */
  drop(): void;
  /** `drop()` plus a hold-down: new connections are refused (closed on arrival) until
   *  `release()` — a deterministic down window for asserting offline behavior, immune to
   *  the reconnect backoff racing the test. */
  holdDown(): void;
  release(): void;
  /** Number of WS connections the app has made through the proxy since install. */
  connectionCount(): number;
  /** Facade (`/acp/{profile}`) connections only — poll this to await a facade reconnect;
   *  the side-band reconnecting first must not satisfy the wait. */
  facadeConnectionCount(): number;
}

/**
 * Transparent WebSocket proxy for the daemon sockets, with a deterministic drop lever.
 * MUST be installed before the sockets are created — install, then page.reload().
 */
export async function installWsControl(page: Page): Promise<WsControl> {
  const routes: WebSocketRoute[] = [];
  let count = 0;
  let facadeCount = 0;
  let held = false;
  const closeAll = () => {
    // Stale (already-closed) routes tolerate a second close; no onClose bookkeeping —
    // registering onClose would disable Playwright's native close-forwarding.
    for (const route of routes.splice(0)) void route.close();
  };
  await page.routeWebSocket(new RegExp(`^ws://127\\.0\\.0\\.1:${DAEMON_PORT}`), (ws) => {
    if (held) {
      void ws.close();
      return;
    }
    count += 1;
    if (new URL(ws.url()).pathname.startsWith('/acp/')) facadeCount += 1;
    routes.push(ws);
    // No onMessage/onClose handlers: connectToServer() alone keeps Playwright's NATIVE
    // bidirectional forwarding (internally buffered until the server socket is up) and
    // native close-forwarding. Manual `ws.onMessage(m => server.send(m))` relays replace
    // that with an unbuffered path that can drop frames sent while the server connection
    // is still being established (flaky lost subscribe/prompt frames).
    ws.connectToServer();
  });
  return {
    drop: closeAll,
    holdDown: () => {
      held = true;
      closeAll();
    },
    release: () => {
      held = false;
    },
    connectionCount: () => count,
    facadeConnectionCount: () => facadeCount,
  };
}
