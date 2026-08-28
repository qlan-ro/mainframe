import { DAEMON_PORT } from '../../fixtures/daemon.js';

/**
 * Headless WS helpers for protocol-level specs (todo #350 group H) that assert on wire
 * frames directly rather than driving the Tauri app through Playwright's `page`. Node's
 * global `WebSocket` (stable since Node 22) is used verbatim — no browser context needed.
 */

/** Open a WS connection to the daemon and resolve once it is OPEN. */
export async function openSocket(path: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${DAEMON_PORT}${path}`);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (ev) => reject(new Error(`WS connect failed: ${JSON.stringify(ev)}`)), {
      once: true,
    });
  });
  return ws;
}

export function sendJson(ws: WebSocket, value: unknown): void {
  ws.send(JSON.stringify(value));
}

/** Resolve with the next parsed JSON frame, or reject if none arrives within `timeoutMs`. */
export function nextJsonMessage(ws: WebSocket, timeoutMs = 10_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error(`no WS frame arrived within ${timeoutMs}ms`));
    }, timeoutMs);
    function onMessage(ev: MessageEvent): void {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(JSON.parse(ev.data as string));
    }
    ws.addEventListener('message', onMessage);
  });
}

/**
 * Collect parsed JSON frames until `quietMs` passes with no new frame, or `hardTimeoutMs`
 * total elapses (whichever comes first). Used to capture one recorded mock-adapter replay's
 * full frame sequence without depending on knowing its exact terminal event.
 */
export function collectUntilQuiet(ws: WebSocket, quietMs: number, hardTimeoutMs: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const frames: unknown[] = [];
    let quietTimer: ReturnType<typeof setTimeout>;
    const hardTimer = setTimeout(finish, hardTimeoutMs);

    function finish(): void {
      clearTimeout(quietTimer);
      clearTimeout(hardTimer);
      ws.removeEventListener('message', onMessage);
      resolve(frames);
    }
    function onMessage(ev: MessageEvent): void {
      frames.push(JSON.parse(ev.data as string));
      clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, quietMs);
    }
    ws.addEventListener('message', onMessage);
    quietTimer = setTimeout(finish, quietMs);
  });
}

export async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
    ws.close();
  });
}
