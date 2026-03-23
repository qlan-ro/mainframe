import type { Writable, Readable } from 'node:stream';
import type { WebSocket } from 'ws';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('lsp-proxy');

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n');

/** Wrap a JSON string with LSP Content-Length header. */
export function encodeJsonRpc(json: string): string {
  const byteLength = Buffer.byteLength(json, 'utf-8');
  return `Content-Length: ${byteLength}\r\n\r\n${json}`;
}

/**
 * Bridge a WebSocket to an LSP server's stdin/stdout.
 * Uses Buffer throughout for byte-accurate Content-Length parsing.
 * Returns a cleanup function.
 */
export function bridgeWsToProcess(ws: WebSocket, stdin: Writable, stdout: Readable, stderr: Readable): () => void {
  let buffer = Buffer.alloc(0);

  const onWsMessage = (data: string | Buffer) => {
    const json = typeof data === 'string' ? data : data.toString('utf-8');
    try {
      stdin.write(encodeJsonRpc(json));
    } catch (err) {
      log.error({ err }, 'Failed to write to LSP stdin');
    }
  };
  ws.on('message', onWsMessage);

  const onStdoutData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const headerEnd = buffer.indexOf(HEADER_SEPARATOR);
      if (headerEnd === -1) break;

      const header = buffer.subarray(0, headerEnd).toString('ascii');
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        log.warn({ header }, 'Malformed LSP header, discarding');
        buffer = buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1]!, 10);
      const contentStart = headerEnd + 4;
      if (buffer.length < contentStart + contentLength) break;

      const json = buffer.subarray(contentStart, contentStart + contentLength).toString('utf-8');
      buffer = buffer.subarray(contentStart + contentLength);

      if (ws.readyState === 1) {
        ws.send(json);
      }
    }
  };
  stdout.on('data', onStdoutData);

  const onStderrData = (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (text) log.debug({ stderr: text }, 'LSP server stderr');
  };
  stderr.on('data', onStderrData);

  return () => {
    ws.removeListener('message', onWsMessage);
    stdout.removeListener('data', onStdoutData);
    stderr.removeListener('data', onStderrData);
  };
}
