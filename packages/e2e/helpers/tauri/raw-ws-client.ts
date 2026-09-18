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

/**
 * A persistent, buffering reader for one socket. `nextJsonMessage` attaches a
 * listener per call, so a frame that arrives while the test is awaiting a
 * DIFFERENT socket (or between two calls) is silently lost — fatal for
 * dual-socket specs where both sides emit concurrently. This attaches one
 * listener at creation and buffers everything; `next` consumes from the
 * buffer in arrival order.
 */
export interface FrameCollector {
  /** Resolve with the earliest not-yet-consumed frame matching `matches`. */
  next(matches: (frame: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
}

export function collectFrames(ws: WebSocket): FrameCollector {
  const buffer: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  ws.addEventListener('message', (ev: MessageEvent) => {
    buffer.push(JSON.parse(ev.data as string) as Record<string, unknown>);
    waiters.splice(0).forEach((wake) => wake());
  });

  return {
    next(matches, timeoutMs = 30_000) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => scan(), timeoutMs);
        const deadline = Date.now() + timeoutMs;
        function scan(): void {
          if (settled) return;
          const index = buffer.findIndex(matches);
          if (index !== -1) {
            settled = true;
            clearTimeout(timer);
            resolve(buffer.splice(index, 1)[0]!);
            return;
          }
          if (Date.now() >= deadline) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`no matching frame arrived within ${timeoutMs}ms`));
            return;
          }
          waiters.push(scan);
        }
        scan();
      });
    },
  };
}

export async function closeSocket(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    ws.addEventListener('close', () => resolve(), { once: true });
    ws.close();
  });
}
