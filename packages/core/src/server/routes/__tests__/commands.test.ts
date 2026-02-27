import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { commandRoutes } from '../commands.js';

function makeCtx(commands = [{ name: 'clear', description: 'Clear history' }]) {
  const adapter = { id: 'claude', listCommands: vi.fn(() => commands.map((c) => ({ ...c, source: 'claude' }))) };
  return {
    adapters: {
      getAll: vi.fn(() => [adapter]),
    },
  } as any;
}

describe('GET /api/commands', () => {
  it('returns commands from all adapters plus mainframe', async () => {
    const app = express();
    app.use(commandRoutes(makeCtx()));
    const res = await request(app).get('/api/commands');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'clear', source: 'claude' })]),
    );
  });
});
