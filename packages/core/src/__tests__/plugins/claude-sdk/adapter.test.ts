import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  listSessions: vi.fn(async () => []),
  getSessionMessages: vi.fn(async () => []),
}));

import { ClaudeSdkAdapter } from '../../../plugins/builtin/claude-sdk/adapter.js';
import { createMockSink } from './test-utils.js';

describe('ClaudeSdkAdapter', () => {
  it('has correct id and name', () => {
    const adapter = new ClaudeSdkAdapter();
    expect(adapter.id).toBe('claude-sdk');
    expect(adapter.name).toBe('Claude Agent SDK');
  });

  it('creates a session with correct projectPath', () => {
    const adapter = new ClaudeSdkAdapter();
    const session = adapter.createSession({ projectPath: '/tmp/test' });
    expect(session.adapterId).toBe('claude-sdk');
    expect(session.projectPath).toBe('/tmp/test');
  });

  it('lists models', async () => {
    const adapter = new ClaudeSdkAdapter();
    const models = await adapter.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]!.id).toContain('claude');
  });

  it('getToolCategories returns expected sets', () => {
    const adapter = new ClaudeSdkAdapter();
    const categories = adapter.getToolCategories!();
    expect(categories.hidden).toContain('AskUserQuestion');
    expect(categories.subagent).toContain('Agent');
  });

  it('killAll kills all active sessions', async () => {
    const adapter = new ClaudeSdkAdapter();
    const session = adapter.createSession({ projectPath: '/tmp/test' });
    const sink = createMockSink();
    await session.spawn({}, sink);
    adapter.killAll();
    expect(session.isSpawned).toBe(false);
  });

  it('listCommands returns empty array', () => {
    const adapter = new ClaudeSdkAdapter();
    expect(adapter.listCommands!()).toEqual([]);
  });
});
