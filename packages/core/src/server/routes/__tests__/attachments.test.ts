import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { attachmentRoutes } from '../attachments.js';
import { AttachmentStore } from '../../../attachment/index.js';
import type { RouteContext } from '../types.js';

let baseDir: string;
let attachmentStore: AttachmentStore;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'mf-attachments-'));
  attachmentStore = new AttachmentStore(baseDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

function makeApp(useStore = true) {
  const ctx = { attachmentStore: useStore ? attachmentStore : undefined } as unknown as RouteContext;
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use(attachmentRoutes(ctx));
  return app;
}

const smallImage = { name: 'a.png', mediaType: 'image/png', data: Buffer.from('hello').toString('base64') };

describe('POST /api/chats/:id/attachments', () => {
  it('returns 500 when the attachment store is not configured', async () => {
    const app = makeApp(false);
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [smallImage] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Attachment store not configured' });
  });

  it('returns 400 when attachments array is empty', async () => {
    const app = makeApp();
    const res = await request(app).post('/api/chats/c1/attachments').send({ attachments: [] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when more than 10 attachments are provided', async () => {
    const app = makeApp();
    const attachments = Array.from({ length: 11 }, (_, i) => ({ ...smallImage, name: `a${i}.png` }));
    const res = await request(app).post('/api/chats/c1/attachments').send({ attachments });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when mediaType is an empty string', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [{ ...smallImage, mediaType: '' }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when mediaType is missing', async () => {
    const app = makeApp();
    const { mediaType: _omit, ...rest } = smallImage;
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [rest] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when declared sizeBytes exceeds the 5MB limit', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [{ ...smallImage, sizeBytes: 6 * 1024 * 1024 }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Attachment exceeds 5MB limit' });
  });

  it('returns 400 when the base64 payload itself exceeds the 5MB limit', async () => {
    const app = makeApp();
    const oversized = Buffer.alloc(6 * 1024 * 1024, 'a').toString('base64');
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [{ name: 'big.bin', mediaType: 'application/octet-stream', data: oversized }] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Attachment exceeds 5MB limit' });
  });

  it('saves a valid attachment and returns its metadata in the envelope', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [smallImage] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0]).toMatchObject({ name: 'a.png', mediaType: 'image/png', kind: 'image' });
    expect(typeof res.body.data.attachments[0].id).toBe('string');
  });

  it('defaults kind to file for a non-image mediaType', async () => {
    const app = makeApp();
    const res = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [{ name: 'doc.txt', mediaType: 'text/plain', data: 'aGVsbG8=' }] });

    expect(res.status).toBe(200);
    expect(res.body.data.attachments[0].kind).toBe('file');
  });
});

describe('GET /api/chats/:chatId/attachments/:attachmentId', () => {
  it('returns 500 when the attachment store is not configured', async () => {
    const app = makeApp(false);
    const res = await request(app).get('/api/chats/c1/attachments/missing');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Attachment store not configured' });
  });

  it('returns 404 when the attachment does not exist', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/chats/c1/attachments/missing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Attachment not found' });
  });

  it('returns the stored attachment wrapped in the success envelope', async () => {
    const app = makeApp();
    const upload = await request(app)
      .post('/api/chats/c1/attachments')
      .send({ attachments: [smallImage] });
    const id = upload.body.data.attachments[0].id as string;

    const res = await request(app).get(`/api/chats/c1/attachments/${id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ name: 'a.png', mediaType: 'image/png' });
  });
});
