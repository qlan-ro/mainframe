import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { bridgeWsToProcess, encodeJsonRpc } from '../../lsp/lsp-proxy.js';

function createMockWs() {
  const sent: string[] = [];
  return {
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    readyState: 1, // OPEN
    sent,
  };
}

describe('encodeJsonRpc', () => {
  it('wraps JSON string with Content-Length header', () => {
    const json = '{"jsonrpc":"2.0","id":1}';
    const encoded = encodeJsonRpc(json);
    const expected = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    expect(encoded).toBe(expected);
  });
});

describe('bridgeWsToProcess', () => {
  let stdin: PassThrough;
  let stdout: PassThrough;
  let stderr: PassThrough;

  beforeEach(() => {
    stdin = new PassThrough();
    stdout = new PassThrough();
    stderr = new PassThrough();
  });

  it('forwards WS message to stdin with Content-Length framing', () => {
    const ws = createMockWs();
    const chunks: Buffer[] = [];
    stdin.on('data', (chunk) => chunks.push(chunk));

    let onMessage: (data: string) => void = () => {};
    ws.on.mockImplementation((event: string, cb: (data: string) => void) => {
      if (event === 'message') onMessage = cb;
    });

    bridgeWsToProcess(ws as any, stdin, stdout, stderr);

    const json = '{"jsonrpc":"2.0","id":1,"method":"initialize"}';
    onMessage(json);

    const written = Buffer.concat(chunks).toString();
    expect(written).toContain('Content-Length:');
    expect(written).toContain(json);
  });

  it('forwards stdout Content-Length messages to WS', async () => {
    const ws = createMockWs();
    ws.on.mockImplementation(() => {});

    bridgeWsToProcess(ws as any, stdin, stdout, stderr);

    const json = '{"jsonrpc":"2.0","id":1,"result":{}}';
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    stdout.write(frame);

    await new Promise((r) => setTimeout(r, 50));
    expect(ws.send).toHaveBeenCalledWith(json);
  });

  it('returns a cleanup function that removes listeners', () => {
    const ws = createMockWs();
    ws.on.mockImplementation(() => {});

    const cleanup = bridgeWsToProcess(ws as any, stdin, stdout, stderr);
    cleanup();

    // After cleanup, verify removeListener was called
    expect(ws.removeListener).toHaveBeenCalled();
  });

  it('does not send to WS when WS is not open', async () => {
    const ws = createMockWs();
    ws.readyState = 3; // WebSocket.CLOSED
    ws.on.mockImplementation(() => {});

    bridgeWsToProcess(ws as any, stdin, stdout, stderr);

    const json = '{"jsonrpc":"2.0","id":1}';
    const frame = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
    stdout.write(frame);

    await new Promise((r) => setTimeout(r, 50));
    expect(ws.send).not.toHaveBeenCalled();
  });
});
