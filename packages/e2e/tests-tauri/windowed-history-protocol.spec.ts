import { test, expect } from '@playwright/test';
import { rmSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import {
  HistoryPageResultSchema,
  HistorySearchResultSchema,
  ResumeSessionResponseSchema,
  SessionUpdateSchema,
  type SessionUpdate,
  type ReplayCursor,
  type RevisionCursor,
} from '@qlan-ro/mainframe-types';
import { startDaemon, stopDaemon, type DaemonHandle } from '../fixtures/daemon.js';
import { WINDOWED_RECORDING_KEY } from '../fixtures/windowed-history.js';
import { seedWindowedHistory } from '../helpers/tauri/windowed-history.js';
import { cleanupHeadlessProject } from '../helpers/tauri/headless-chat.js';
import {
  openSocket,
  collectFrames,
  closeSocket,
  sendJson,
  type FrameCollector,
} from '../helpers/tauri/raw-ws-client.js';

class HistoryConnection {
  private id = 0;
  private readonly frames: FrameCollector;
  readonly updates: SessionUpdate[] = [];

  constructor(
    readonly socket: WebSocket,
    private readonly sessionId: string,
  ) {
    this.frames = collectFrames(socket);
    socket.addEventListener('message', (event: MessageEvent) => {
      const frame = JSON.parse(event.data as string);
      if (frame.params?.sessionId !== sessionId) return;
      if (frame.method === 'session/update') this.updates.push(SessionUpdateSchema.parse(frame.params.update));
      if (frame.method === '_mainframe.dev/replay_batch') {
        const updates = JSON.parse(inflateSync(Buffer.from(frame.params.data, 'base64')).toString());
        this.updates.push(...SessionUpdateSchema.array().parse(updates));
      }
    });
  }

  async initialize(windowed = true, compressed = false) {
    return this.call('initialize', {
      protocolVersion: 2,
      info: { name: 'windowed-protocol', version: '1' },
      _meta: {
        '_mainframe.dev': {
          revisionCursors: true,
          windowedHistory: windowed,
          replayResultPreviews: windowed,
          compressedReplay: compressed,
        },
      },
    });
  }

  async call(method: string, params: unknown): Promise<unknown> {
    const id = ++this.id;
    sendJson(this.socket, { jsonrpc: '2.0', id, method, params });
    const response = await this.frames.next((frame) => frame.id === id);
    expect(response.error).toBeUndefined();
    return response.result;
  }

  async resume(
    cursor: ReplayCursor = { type: 'start' },
    window: { containers?: number; floorItemId?: string } = { containers: 40 },
  ) {
    const start = this.updates.length;
    const response = ResumeSessionResponseSchema.parse(
      await this.call('session/resume', {
        sessionId: this.sessionId,
        cwd: '/tmp',
        replayFrom: cursor,
        _meta: { '_mainframe.dev': { window } },
      }),
    );
    const complete = await this.frames.next(
      (frame) =>
        frame.method === '_mainframe.dev/replay_complete' &&
        (frame.params as { sessionId?: string })?.sessionId === this.sessionId,
    );
    expect((complete.params as { aborted?: boolean }).aborted).not.toBe(true);
    return {
      meta: response._meta?.['_mainframe.dev'] as {
        history?: { hasMore: boolean; floorItemId?: string };
        cursor?: RevisionCursor;
        fullReplay?: boolean;
      },
      updates: this.updates.slice(start),
    };
  }

  async page(before: string, untilItemId?: string) {
    return HistoryPageResultSchema.parse(
      await this.call('_mainframe.dev/history_page', {
        sessionId: this.sessionId,
        before,
        containers: 40,
        ...(untilItemId ? { untilItemId } : {}),
      }),
    );
  }

  async search(query: string) {
    return HistorySearchResultSchema.parse(
      await this.call('_mainframe.dev/history_search', { sessionId: this.sessionId, query }),
    );
  }
}

function userTexts(updates: SessionUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.sessionUpdate === 'user_message'
      ? [update.content?.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('') ?? '']
      : [],
  );
}

function pageUpdates(page: ReturnType<typeof HistoryPageResultSchema.parse>): SessionUpdate[] {
  return (
    page.updates ??
    page.batches?.flatMap((batch) =>
      SessionUpdateSchema.array().parse(JSON.parse(inflateSync(Buffer.from(batch.data, 'base64')).toString())),
    ) ??
    []
  );
}

test.describe('windowed history over the real daemon facade', () => {
  let seed: Awaited<ReturnType<typeof seedWindowedHistory>>;
  let daemon: DaemonHandle;
  const sockets: WebSocket[] = [];
  test.beforeAll(async () => {
    seed = await seedWindowedHistory();
    daemon = await startDaemon({
      dataDir: seed.dataDir,
      recordingKey: WINDOWED_RECORDING_KEY,
      recordingsDir: seed.recordingsDir,
    });
  });
  test.afterEach(async () => {
    for (const socket of sockets.splice(0)) await closeSocket(socket);
  });
  test.afterAll(async () => {
    if (daemon) await stopDaemon(daemon);
    if (seed) {
      cleanupHeadlessProject(seed.project);
      rmSync(seed.dataDir, { recursive: true, force: true });
      rmSync(seed.recordingsDir, { recursive: true, force: true });
    }
  });

  async function connect(windowed = true, compressed = false) {
    const socket = await openSocket('/acp/mock-cli');
    sockets.push(socket);
    const connection = new HistoryConnection(socket, seed.chatId);
    await connection.initialize(windowed, compressed);
    return connection;
  }

  test('opens a bounded window and loads one contiguous gap to a whole-chat prose match', async () => {
    const connection = await connect();
    const resume = await connection.resume();
    expect(userTexts(resume.updates)).toHaveLength(20);
    expect(userTexts(resume.updates).at(-1)).toBe('Needle turn 249');
    expect(Buffer.byteLength(JSON.stringify(resume.updates))).toBeLessThan(3_000_000);
    expect(resume.meta.history?.hasMore).toBe(true);
    const search = await connection.search('ancient landmark');
    expect(search.total).toBe(1);
    const target = search.matches[0]!;
    expect(userTexts(resume.updates)).not.toContain('Needle turn 2 ancient landmark');
    const page = await connection.page(resume.meta.history!.floorItemId!, target.itemId);
    const earlier = userTexts(pageUpdates(page));
    expect(earlier).toContain('Needle turn 2 ancient landmark');
    const all = [...earlier, ...userTexts(resume.updates)].filter((text) => text.startsWith('Needle turn'));
    const start = Number(all[0]!.split(' ')[2]);
    expect(all).toEqual(
      Array.from(
        { length: 250 - start },
        (_, index) => `Needle turn ${index + start}${index + start === 2 ? ' ancient landmark' : ''}`,
      ),
    );
    expect((await connection.search('Needle turn')).total).toBe(250);
    expect((await connection.search('hidden-output-token')).total).toBe(0);
  });

  test('keeps each connection floor independent and retains a lowered floor on revision reconnect', async () => {
    const first = await connect(true, true);
    const second = await connect();
    const initial = await first.resume();
    const other = await second.resume();
    const page = await first.page(initial.meta.history!.floorItemId!);
    expect(page.updates).toBeUndefined();
    expect(page.batches?.length).toBeGreaterThan(0);
    expect(userTexts(pageUpdates(page))).toHaveLength(20);
    expect(page.floorItemId).not.toBe(initial.meta.history!.floorItemId);
    const stale = await first.page(initial.meta.history!.floorItemId!);
    expect(stale.stale).toBe(true);
    expect(stale.updates?.length ?? 0).toBe(0);
    expect(stale.batches?.length ?? 0).toBe(0);
    const otherPage = await second.page(other.meta.history!.floorItemId!);
    expect(otherPage.stale).not.toBe(true);
    expect(userTexts(pageUpdates(otherPage))).toHaveLength(20);
    expect(otherPage.floorItemId).toBe(page.floorItemId);
    expect(initial.meta.cursor?.epoch).toEqual(expect.any(String));
    expect(initial.meta.cursor?.revision).toEqual(expect.any(Number));
    await closeSocket(first.socket);
    const reconnected = await connect();
    const resumed = await reconnected.resume(
      { type: 'revision', ...initial.meta.cursor! },
      { floorItemId: page.floorItemId },
    );
    expect(resumed.meta.fullReplay).not.toBe(true);
    expect(resumed.meta.history).toEqual({ hasMore: true, floorItemId: page.floorItemId });
    expect(userTexts(resumed.updates)).toEqual([]);
  });

  test('preserves full replay for a client that does not opt into windows', async () => {
    const connection = await connect(false);
    const replay = await connection.resume();
    expect(replay.meta.history).toBeUndefined();
    expect(userTexts(replay.updates).filter((text) => text.startsWith('Needle turn'))).toHaveLength(250);
    expect(Buffer.byteLength(JSON.stringify(replay.updates))).toBeGreaterThan(20_000_000);
  });
});
