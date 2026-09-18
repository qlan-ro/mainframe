/**
 * A second facade connection, for driving a chat the app is NOT showing.
 *
 * The app can only send from its active chat, so a test that needs a BACKGROUND
 * chat to produce a response used to send from it and then race the reply to a
 * row click. That race is unwinnable under load — the mock adapter caps every
 * inter-event delay at 120ms, so a reply can land in well under a second — and it
 * is what made the attention-badge test fail in rc.20 and rc.22.
 *
 * A second connection removes the race outright: the chat under test is never the
 * active one, which is also the scenario the product code is about. The legacy
 * `message.send` frame died with the chat dialect (spec decision 24); the send now
 * rides the ACP facade as `session/prompt` on `/acp/mock-cli` — the daemon runs
 * the chat and fans the side-band notifications out to every client, exactly as a
 * facade prompt from any other surface would. The daemon trusts loopback callers,
 * so no token is involved.
 */
import { openSocket, sendJson, nextJsonMessage, closeSocket } from './raw-ws-client.js';

export interface BackgroundClient {
  /** Fire-and-forget: the daemon runs the chat and broadcasts to every client. */
  send(chatId: string, content: string): void;
  close(): void;
}

export async function openBackgroundClient(): Promise<BackgroundClient> {
  const ws = await openSocket('/acp/mock-cli');
  sendJson(ws, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: 2, info: { name: 'mainframe-e2e-background', version: '0.0.0' } },
  });
  await nextJsonMessage(ws);
  let nextId = 2;
  return {
    send: (chatId, content) =>
      sendJson(ws, {
        jsonrpc: '2.0',
        id: nextId++,
        method: 'session/prompt',
        params: { sessionId: chatId, prompt: [{ type: 'text', text: content }] },
      }),
    close: () => void closeSocket(ws),
  };
}
