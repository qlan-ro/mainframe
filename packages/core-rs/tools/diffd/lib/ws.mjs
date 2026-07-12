// A thin WebSocket client for the soak harness. Speaks the daemon's client→server
// envelopes (subscribe / message.send / permission.respond) and records every
// inbound DaemonEvent in arrival order so a scenario can assert on the ordered
// event-type sequence + payload fields. Uses Node's global WebSocket (Node 21+).
import { sleep } from './util.mjs';

export class WsSession {
  constructor(baseUrl) {
    this.url = baseUrl.replace(/^http/, 'ws') + '/';
    this.events = []; // raw inbound events, in arrival order
    this.ws = null;
    this.clientId = null;
    this._waiters = []; // { predicate, resolve, timer }
  }

  /** Open the socket and resolve once `connection.ready` (the first frame) lands. */
  connect(timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error('ws connect timeout')), timeoutMs);
      ws.onmessage = (m) => {
        let ev;
        try {
          ev = JSON.parse(m.data);
        } catch {
          return;
        }
        this.events.push(ev);
        if (ev.type === 'connection.ready') {
          this.clientId = ev.clientId;
          clearTimeout(to);
          resolve(this);
        }
        this._pump(ev);
      };
      ws.onerror = (e) => {
        clearTimeout(to);
        reject(new Error(`ws error: ${e.message || e.type || 'unknown'}`));
      };
      ws.onclose = () => this._pump({ type: '__closed__' });
    });
  }

  _pump(ev) {
    for (const w of this._waiters.slice()) {
      if (w.predicate(ev, this.events)) {
        clearTimeout(w.timer);
        this._waiters = this._waiters.filter((x) => x !== w);
        w.resolve(ev);
      }
    }
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  /** Resolve on the first inbound event matching `predicate` (or reject on timeout). */
  waitFor(predicate, timeoutMs = 60000, label = 'event') {
    // Fast-path: already seen.
    for (const ev of this.events) if (predicate(ev, this.events)) return Promise.resolve(ev);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters = this._waiters.filter((x) => x !== w);
        reject(new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const w = { predicate, resolve, timer };
      this._waiters.push(w);
    });
  }

  /** Subscribe to a chat; resolve after `subscribe:ack` for that chat. */
  async subscribe(chatId) {
    this.send({ type: 'subscribe', chatId });
    await this.waitFor((ev) => ev.type === 'subscribe:ack' && ev.chatId === chatId, 10000, 'subscribe:ack');
    await sleep(100);
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* best effort */
    }
  }
}
