import type { Page, WebSocketRoute } from '@playwright/test';
import { DAEMON_PORT } from '../../fixtures/daemon.js';

export interface WsControl {
  /** Sever the CURRENT daemon WebSocket. The app's ws-client sees onclose and auto-reconnects
   *  (500ms-base backoff) through this same route, incrementing connectionCount. */
  drop(): void;
  /** Number of WS connections the app has made through the proxy since install. */
  connectionCount(): number;
}

/**
 * Transparent WebSocket proxy for the daemon socket, with a deterministic drop lever.
 * MUST be installed before the socket is created — install, then page.reload().
 */
export async function installWsControl(page: Page): Promise<WsControl> {
  let current: WebSocketRoute | null = null;
  let count = 0;
  await page.routeWebSocket(new RegExp(`^ws://127\\.0\\.0\\.1:${DAEMON_PORT}`), (ws) => {
    count += 1;
    current = ws;
    // No onMessage/onClose handlers: connectToServer() alone keeps Playwright's NATIVE
    // bidirectional forwarding (internally buffered until the server socket is up) and
    // native close-forwarding. Manual `ws.onMessage(m => server.send(m))` relays replace
    // that with an unbuffered path that can drop frames sent while the server connection
    // is still being established (flaky lost subscribe/message.send).
    ws.connectToServer();
  });
  return {
    drop: () => current?.close(),
    connectionCount: () => count,
  };
}
