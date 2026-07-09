import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { chatRoutes } from '../chats.js';

describe('GET /api/chats/:id/messages', () => {
  it('returns the typed { messages, transcriptMissing } envelope', async () => {
    const messages = [{ id: 'm1', type: 'assistant' }];
    const ctx = {
      chats: {
        getDisplayMessages: vi.fn().mockResolvedValue({ messages, transcriptMissing: true }),
      },
      db: {},
    } as any;
    const app = express();
    app.use(express.json());
    app.use(chatRoutes(ctx));

    const res = await request(app).get('/api/chats/c1/messages');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { messages, transcriptMissing: true },
    });
    expect(ctx.chats.getDisplayMessages).toHaveBeenCalledWith('c1');
  });
});
