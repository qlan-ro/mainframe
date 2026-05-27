import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { backgroundTaskRoutes } from '../background-tasks.js';
import { BackgroundTaskTracker } from '../../../background-tasks/tracker.js';

function makeApp(opts: {
  tracker: BackgroundTaskTracker;
  sessionForChat?: (c: string) => any;
  validator?: (p: string, t: string) => Promise<boolean>;
  killImpl?: any;
}) {
  const app = express();
  app.use(express.json());
  app.use(
    backgroundTaskRoutes({
      tracker: opts.tracker,
      sessionForChat: opts.sessionForChat ?? (() => null),
      validator: opts.validator ?? (async () => true),
      killImpl: opts.killImpl,
    }),
  );
  return app;
}

const DUMMY_PATH = '/tmp/claude-0/-proj/sess/tasks/t1.output';

describe('background-tasks routes', () => {
  it('GET /background-tasks returns tracked tasks', async () => {
    const tracker = new BackgroundTaskTracker();
    tracker.start(
      'c1',
      { id: 't1', toolName: 'Bash', toolUseId: 'tu', command: 'sleep 5', description: '' },
      DUMMY_PATH,
    );
    const res = await request(makeApp({ tracker })).get('/api/chats/c1/background-tasks');
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].id).toBe('t1');
  });

  it('GET /output → 409 no_output when outputPath is null (adopted task without path)', async () => {
    const tracker = new BackgroundTaskTracker();
    // adopt() lets us place a task with outputPath: null (e.g. a recovered entry with no spool file).
    tracker.adopt('c1', {
      id: 't1',
      toolName: 'Bash',
      toolUseId: 'tu',
      command: 'x',
      description: '',
      outputPath: null,
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      lastOutputLine: null,
      summary: null,
      usage: null,
    });
    const res = await request(makeApp({ tracker })).get('/api/chats/c1/background-tasks/t1/output');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: 'no_output' });
  });

  it('GET /output → 404 when task missing', async () => {
    const tracker = new BackgroundTaskTracker();
    const res = await request(makeApp({ tracker })).get('/api/chats/c1/background-tasks/missing/output');
    expect(res.status).toBe(404);
  });

  it('GET /output → 409 invalid_path when validator rejects', async () => {
    const tracker = new BackgroundTaskTracker();
    tracker.start('c1', { id: 't1', toolName: 'Bash', toolUseId: 'tu', command: 'x', description: '' }, DUMMY_PATH);
    tracker.end('c1', 't1', { status: 'completed', outputPath: '/etc/passwd', summary: '', usage: null });
    const res = await request(makeApp({ tracker, validator: async () => false })).get(
      '/api/chats/c1/background-tasks/t1/output',
    );
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ reason: 'invalid_path' });
  });

  it('GET /output → 200 + bounded tail when validator accepts', async () => {
    const { writeFile, mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const dir = await mkdtemp(path.join(tmpdir(), 'bg-test-'));
    const outPath = path.join(dir, 't1.output');
    await writeFile(outPath, 'a\nb\nc\nlast line\n');

    const tracker = new BackgroundTaskTracker();
    tracker.start('c1', { id: 't1', toolName: 'Bash', toolUseId: 'tu', command: 'x', description: '' }, outPath);
    tracker.end('c1', 't1', { status: 'completed', outputPath: outPath, summary: '', usage: null });
    const res = await request(makeApp({ tracker })).get('/api/chats/c1/background-tasks/t1/output?bytes=64');
    expect(res.status).toBe(200);
    expect(res.text).toContain('last line');
  });

  it('POST /kill → 404 when task missing', async () => {
    const tracker = new BackgroundTaskTracker();
    const res = await request(makeApp({ tracker })).post('/api/chats/c1/background-tasks/missing/kill');
    expect(res.status).toBe(404);
  });

  it('POST /kill → 204 on success', async () => {
    const tracker = new BackgroundTaskTracker();
    tracker.start('c1', { id: 't1', toolName: 'Bash', toolUseId: 'tu', command: 'x', description: '' }, DUMMY_PATH);
    const session = { stopBackgroundTask: vi.fn().mockResolvedValue({ ok: true }) };
    const killImpl = vi.fn().mockResolvedValue({ ok: true, via: 'stop_task' });
    const res = await request(makeApp({ tracker, sessionForChat: () => session, killImpl })).post(
      '/api/chats/c1/background-tasks/t1/kill',
    );
    expect(res.status).toBe(204);
  });

  it('POST /kill → 502 + error body when kill fails', async () => {
    const tracker = new BackgroundTaskTracker();
    tracker.start('c1', { id: 't1', toolName: 'Bash', toolUseId: 'tu', command: 'x', description: '' }, DUMMY_PATH);
    const session = { stopBackgroundTask: vi.fn() };
    const killImpl = vi.fn().mockResolvedValue({ ok: false, error: 'timeout', via: 'none' });
    const res = await request(makeApp({ tracker, sessionForChat: () => session, killImpl })).post(
      '/api/chats/c1/background-tasks/t1/kill',
    );
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('timeout');
  });

  it('kill route falls back to OS path when no session is active', async () => {
    const tracker = new BackgroundTaskTracker();
    tracker.adopt('chat-a', {
      id: 'rec-1',
      toolName: 'Bash',
      toolUseId: '',
      command: '<recovered>',
      description: '',
      outputPath: '/tmp/claude-501/-x/sess/tasks/rec-1.output',
      startedAt: 100,
      endedAt: null,
      status: 'running',
      lastOutputLine: null,
      summary: null,
      usage: null,
      recovered: true,
    });
    const killImpl = vi.fn().mockResolvedValue({ ok: true, via: 'tree_kill' });
    const app = express()
      .use(express.json())
      .use(
        backgroundTaskRoutes({
          tracker,
          sessionForChat: () => null,
          killImpl,
        }),
      );
    const res = await request(app).post('/api/chats/chat-a/background-tasks/rec-1/kill');
    expect(res.status).toBe(204);
    expect(killImpl).toHaveBeenCalledWith(expect.objectContaining({ session: null }));
  });
});
