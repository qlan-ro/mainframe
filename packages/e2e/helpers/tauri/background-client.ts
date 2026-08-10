/**
 * A second daemon WebSocket connection, for driving a chat the app is NOT showing.
 *
 * The app can only send from its active chat, so a test that needs a BACKGROUND
 * chat to produce a response used to send from it and then race the reply to a
 * row click. That race is unwinnable under load — the mock adapter caps every
 * inter-event delay at 120ms, so a reply can land in well under a second — and it
 * is what made the attention-badge test fail in rc.20 and rc.22.
 *
 * A second connection removes the race outright: the chat under test is never the
 * active one, which is also the scenario the product code is about. `message.send`
 * needs only `chatId` and `content` (mainframe-server/src/ws_schemas.rs), and the
 * daemon trusts loopback callers, so no token is involved.
 */
import { DAEMON_BASE } from '../../fixtures/daemon.js';

export interface BackgroundClient {
  /** Fire-and-forget: the daemon runs the chat and broadcasts to every client. */
  send(chatId: string, content: string): void;
  close(): void;
}

export async function openBackgroundClient(): Promise<BackgroundClient> {
  const ws = new WebSocket(DAEMON_BASE.replace(/^http/, 'ws'));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('background client could not reach the daemon')), {
      once: true,
    });
  });
  return {
    send: (chatId, content) => ws.send(JSON.stringify({ type: 'message.send', chatId, content })),
    close: () => ws.close(),
  };
}
