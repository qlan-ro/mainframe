import { inflateSync } from 'node:zlib';
import { rmSync } from 'node:fs';
import type { Page, WebSocketRoute } from '@playwright/test';
import { startDaemon, stopDaemon } from '../../fixtures/daemon.js';
import { writeWindowedHistoryRecording, WINDOWED_RECORDING_KEY } from '../../fixtures/windowed-history.js';
import { createHeadlessProject, createHeadlessChat, cleanupHeadlessProject } from './headless-chat.js';
import { openSocket, sendJson, collectFrames, closeSocket } from './raw-ws-client.js';
import { initializeRequest, promptRequest } from './facade-protocol-support.js';

export async function seedWindowedHistory() {
  const recordingsDir = writeWindowedHistoryRecording();
  const daemon = await startDaemon({ recordingKey: WINDOWED_RECORDING_KEY, recordingsDir });
  let project: Awaited<ReturnType<typeof createHeadlessProject>> | undefined;
  try {
    project = await createHeadlessProject();
    const chatId = await createHeadlessChat(project.projectId, 'mock-cli', 'acceptEdits');
    const socket = await openSocket('/acp/mock-cli');
    try {
      const frames = collectFrames(socket);
      sendJson(socket, initializeRequest(1));
      await frames.next((frame) => frame.id === 1);
      sendJson(socket, promptRequest(2, chatId, 'Fixture setup'));
      await frames.next((frame) => frame.id === 2);
      await frames.next((frame) => JSON.stringify(frame).includes('"state":"idle"'));
    } finally {
      await closeSocket(socket);
    }
    await stopDaemon(daemon, true);
    return { chatId, project, dataDir: daemon.testDataDir, recordingsDir };
  } catch (error) {
    await stopDaemon(daemon);
    cleanupHeadlessProject(project);
    rmSync(recordingsDir, { recursive: true, force: true });
    throw error;
  }
}

export class HistoryWire {
  legacy = false;
  uncompressedLegacy = false;
  private readonly replayListeners = new Set<() => void>();
  readonly replaysCompleted = new Map<string, number>();
  pageRequests = 0;
  resumeBytes = 0;
  holdPage = false;
  private pageIds = new Set<unknown>();
  private held: Array<() => void> = [];
  private readonly clients = new Set<WebSocketRoute>();

  async disconnect(): Promise<void> {
    await Promise.all([...this.clients].map((client) => client.close({ code: 4000, reason: 'QA reconnect' })));
    this.clients.clear();
  }

  resync(chatId: string): void {
    for (const client of this.clients) {
      client.send(JSON.stringify({ jsonrpc: '2.0', method: '_mainframe.dev/resync', params: { sessionId: chatId } }));
    }
  }

  release(): void {
    this.holdPage = false;
    for (const send of this.held.splice(0)) send();
  }

  waitForReplay(chatId: string, after: number): Promise<void> {
    if ((this.replaysCompleted.get(chatId) ?? 0) > after) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const check = () => {
        if ((this.replaysCompleted.get(chatId) ?? 0) <= after) return;
        clearTimeout(timeout);
        this.replayListeners.delete(check);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.replayListeners.delete(check);
        reject(new Error('Measured resume did not complete'));
      }, 30_000);
      this.replayListeners.add(check);
    });
  }

  async install(page: Page): Promise<void> {
    await page.routeWebSocket('**/acp/**', (client) => this.connect(client));
  }

  private connect(client: WebSocketRoute): void {
    this.clients.add(client);
    const server = client.connectToServer();
    client.onClose((_code, reason) => {
      this.clients.delete(client);
      void server.close({ code: 1000, reason });
    });
    client.onMessage((message) => {
      const frame = JSON.parse(message.toString()) as {
        id?: unknown;
        method?: string;
        params?: { _meta?: Record<string, Record<string, unknown>> };
      };
      if (this.legacy && frame.method === 'initialize') {
        const meta = frame.params?._meta?.['_mainframe.dev'];
        if (meta) {
          delete meta.windowedHistory;
          if (this.uncompressedLegacy) {
            delete meta.compressedReplay;
            delete meta.replayResultPreviews;
          }
        }
      }
      if (frame.method === '_mainframe.dev/history_page') {
        this.pageRequests++;
        this.pageIds.add(frame.id);
      }
      server.send(this.legacy ? JSON.stringify(frame) : message);
    });
    server.onMessage((message) => this.receive(client, message));
  }

  private receive(client: WebSocketRoute, message: string | Buffer): void {
    const frame = JSON.parse(message.toString()) as { id?: unknown; method?: string };
    if (frame.method === '_mainframe.dev/replay_complete') {
      const params = (frame as { params?: { sessionId?: string; aborted?: boolean } }).params;
      if (params?.sessionId && !params.aborted) {
        this.replaysCompleted.set(params.sessionId, (this.replaysCompleted.get(params.sessionId) ?? 0) + 1);
        for (const listener of this.replayListeners) listener();
      }
    }
    const batch = frame as { params?: { data?: string; encoding?: string } };
    this.resumeBytes +=
      frame.method === '_mainframe.dev/replay_batch' && batch.params?.data
        ? inflateSync(Buffer.from(batch.params.data, 'base64')).byteLength
        : Buffer.byteLength(message);
    if (this.held.length || (this.holdPage && this.pageIds.has(frame.id))) {
      this.held.push(() => client.send(message));
    } else if (this.legacy && !frame.method) {
      const reply = frame as { result?: { _meta?: Record<string, Record<string, unknown>> } };
      const capabilities = reply.result?._meta?.['_mainframe.dev'];
      if (capabilities) {
        delete capabilities.windowedHistory;
        delete capabilities.historySearch;
      }
      client.send(JSON.stringify(frame));
    } else client.send(message);
  }
}
