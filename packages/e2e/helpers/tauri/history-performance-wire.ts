import { expect, type Page } from '@playwright/test';
import { inflateSync } from 'node:zlib';

export class HistoryPerformanceWire {
  readonly replaysCompleted = new Map<string, number>();
  resumeBytes = 0;

  constructor(readonly legacy: false | 'full' | 'uncompressed') {}

  async install(page: Page): Promise<void> {
    await page.addInitScript((legacy) => {
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        send(data: Parameters<WebSocket['send']>[0]): void {
          if (!legacy || typeof data !== 'string') return super.send(data);
          const frame = JSON.parse(data) as {
            method?: string;
            params?: { _meta?: Record<string, Record<string, unknown>> };
          };
          const meta = frame.params?._meta?.['_mainframe.dev'];
          if (frame.method === 'initialize' && meta) {
            delete meta.windowedHistory;
            if (legacy === 'uncompressed') {
              delete meta.compressedReplay;
              delete meta.replayResultPreviews;
            }
          }
          super.send(JSON.stringify(frame));
        }
      };
    }, this.legacy);
    const cdp = await page.context().newCDPSession(page);
    cdp.on('Network.webSocketFrameReceived', ({ response }) => {
      if (response.opcode === 1) this.receive(response.payloadData);
    });
    await cdp.send('Network.enable');
  }

  private receive(message: string): void {
    const frame = JSON.parse(message) as {
      method?: string;
      params?: { sessionId?: string; aborted?: boolean; data?: string };
    };
    const params = frame.params;
    if (frame.method === '_mainframe.dev/replay_complete' && params?.sessionId && !params.aborted) {
      const id = params.sessionId;
      this.replaysCompleted.set(id, (this.replaysCompleted.get(id) ?? 0) + 1);
    }
    this.resumeBytes +=
      frame.method === '_mainframe.dev/replay_batch' && params?.data
        ? inflateSync(Buffer.from(params.data, 'base64')).byteLength
        : Buffer.byteLength(message);
  }

  async waitForReplay(chatId: string, after: number): Promise<void> {
    await expect
      .poll(() => this.replaysCompleted.get(chatId) ?? 0, { timeout: this.legacy ? 120_000 : 30_000 })
      .toBeGreaterThan(after);
  }
}
