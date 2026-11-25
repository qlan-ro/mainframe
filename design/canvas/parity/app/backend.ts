/**
 * The daemon, in the page. `fetch` answers from `fixtures` and the sockets speak
 * just enough of the ACP facade for a transcript to load. Anything the fixtures
 * don't know is recorded in `__PARITY_MISSES__`, and the runner fails on it.
 */
import { respond, sessionState, scenario, FAKE_PORT, TODOS_EVENT } from './fixtures';

const misses: string[] = [];
const log: string[] = [];
Object.assign(window, { __PARITY_MISSES__: misses, __PARITY_LOG__: log });

const ORIGIN = `http://127.0.0.1:${FAKE_PORT}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const key = `${method} ${url.pathname}${url.search}`;
  if (url.origin !== ORIGIN) {
    misses.push(`fetch to ${url.origin}: ${key}`);
    throw new TypeError(`parity mount: no network (${url.href})`);
  }
  log.push(key);
  const body = await respond(method, url, init?.body ? JSON.parse(String(init.body)) : undefined);
  if (body === undefined) {
    misses.push(key);
    return json({ success: false, error: 'not in the parity fixtures' }, 404);
  }
  if (body instanceof Response) return body;
  return json(body);
};

type Frame = { jsonrpc: '2.0'; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown };

class FakeSocket extends EventTarget {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  binaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private acp: boolean;
  private beat: ReturnType<typeof setInterval> | undefined;
  constructor(readonly url: string) {
    super();
    const u = new URL(url);
    if (u.host !== `127.0.0.1:${FAKE_PORT}`) misses.push(`socket to ${u.host}`);
    this.acp = u.pathname.startsWith('/acp/');
    queueMicrotask(() => {
      this.readyState = 1;
      this.fire(new Event('open'));
    });
  }
  private fire(e: Event) {
    (this as unknown as Record<string, ((e: Event) => void) | null>)[`on${e.type}`]?.(e);
    this.dispatchEvent(e);
  }
  private push(frame: unknown) {
    queueMicrotask(() => this.fire(new MessageEvent('message', { data: JSON.stringify(frame) })));
  }
  send(data: string) {
    if (!this.acp) {
      // The daemon re-sends a chat's plan on every subscribe.
      const event = JSON.parse(data) as { type?: string; chatId?: string };
      if (event.type === 'subscribe' && event.chatId === 's1') this.push(TODOS_EVENT);
      return;
    }
    const frame = JSON.parse(data) as Frame;
    if (frame.method === undefined || frame.id === undefined) return;
    const reply = (result: unknown) => this.push({ jsonrpc: '2.0', id: frame.id, result });
    const note = (method: string, params: unknown) => this.push({ jsonrpc: '2.0', method, params });
    log.push(`ACP ${frame.method}`);
    if (frame.method === 'initialize') {
      reply({
        protocolVersion: 2,
        info: { name: 'parity', version: '0' },
        _meta: {
          '_mainframe.dev': {
            richPermissionAnswers: true,
            queuedPrompts: true,
            heartbeatIntervalMs: 600_000,
            itemCreationMarkers: true,
            replayComplete: true,
            windowedHistory: Boolean(scenario.windowTranscript),
          },
        },
      });
      let sequence = 0;
      this.beat = setInterval(() => note('_mainframe.dev/heartbeat', { sequence: ++sequence }), 60_000);
    } else if (frame.method === 'session/resume') {
      const sessionId = String(frame.params?.sessionId);
      const state = sessionState(sessionId);
      reply(
        sessionId === 's1' && scenario.windowTranscript
          ? { _meta: { '_mainframe.dev': { fullReplay: true, history: { hasMore: true, floorItemId: 'w1' } } } }
          : {},
      );
      const replay = () => {
        for (const update of state.updates) note('session/update', { sessionId, update });
        note('_mainframe.dev/replay_complete', { sessionId });
        if (state.queue.length > 0) note('_mainframe.dev/queue_state', { sessionId, refs: state.queue });
        state.permissions.forEach((params, i) =>
          this.push({
            jsonrpc: '2.0',
            id: `gate-${sessionId}-${i}`,
            method: 'session/request_permission',
            params: { sessionId, ...params },
          }),
        );
      };
      if (scenario.windowTranscript) setTimeout(replay, 0);
      else replay();
    } else if (frame.method === 'session/prompt') {
      reply({});
    } else {
      misses.push(`ACP ${frame.method}`);
      this.push({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'not in the parity fixtures' } });
    }
  }
  close() {
    if (this.readyState === 3) return;
    clearInterval(this.beat);
    this.readyState = 3;
    queueMicrotask(() => this.fire(new CloseEvent('close')));
  }
}
window.WebSocket = FakeSocket as unknown as typeof WebSocket;
window.EventSource = class {
  constructor(url: string) {
    misses.push(`EventSource ${url}`);
  }
} as unknown as typeof EventSource;
navigator.sendBeacon = (url) => {
  misses.push(`sendBeacon ${url}`);
  return false;
};
