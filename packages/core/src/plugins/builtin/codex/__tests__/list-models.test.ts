import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => {
    const process = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const written: string[] = [];
    process.written = written;
    process.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        written.push(chunk.toString());
        callback();
      },
    });
    process.stdout = new Readable({ read() {} });
    process.stderr = new Readable({ read() {} });
    process.kill = vi.fn(() => {
      process.emit('close', 0);
      return true;
    });
    return process;
  }),
}));

import { spawn } from 'node:child_process';
import { CodexAdapter, mapCodexModel } from '../adapter.js';

describe('mapCodexModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps efforts, default, fast tier, personality, isDefault', () => {
    const m = mapCodexModel({
      id: 'gpt-5.5',
      displayName: 'GPT-5.5',
      description: 'Frontier',
      hidden: false,
      isDefault: false,
      supportsPersonality: true,
      additionalSpeedTiers: ['fast'],
      defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: '' },
        { reasoningEffort: 'medium', description: '' },
        { reasoningEffort: 'high', description: '' },
        { reasoningEffort: 'xhigh', description: '' },
      ],
    });
    expect(m.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(m.defaultEffort).toBe('medium');
    expect(m.supportsFast).toBe(true);
    expect(m.supportsPersonality).toBe(true);
  });

  it('probes models with the configured executable path', async () => {
    const adapter = new CodexAdapter();
    const probe = (adapter as unknown as { probeModels(executablePath?: string): Promise<unknown[]> }).probeModels(
      '/configured/bin/codex',
    );
    const process = (spawn as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;

    process.stdout.push(
      JSON.stringify({ id: 1, result: { userAgent: 'codex/0.144.1', codexHome: '/tmp/.codex' } }) + '\n',
    );
    await vi.waitFor(() =>
      expect((process.written as string[]).some((line) => JSON.parse(line).method === 'model/list')).toBe(true),
    );
    process.stdout.push(
      JSON.stringify({
        id: 2,
        result: {
          data: [
            { id: 'gpt-5.6-sol', displayName: 'GPT-5.6-Sol', hidden: false, isDefault: true },
            { id: 'hidden-model', displayName: 'Hidden', hidden: true, isDefault: false },
          ],
          nextCursor: null,
        },
      }) + '\n',
    );

    await expect(probe).resolves.toEqual([
      expect.objectContaining({ id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', isDefault: true }),
    ]);
    expect(spawn).toHaveBeenCalledWith(
      '/configured/bin/codex',
      ['app-server'],
      expect.objectContaining({ detached: false }),
    );
  });
});
