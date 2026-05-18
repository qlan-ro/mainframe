import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter, Readable, Writable } from 'node:stream';

// Mock child_process before importing the module under test
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

vi.mock('../../../logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Import after mocking
const { probeModels } = await import('../plugins/builtin/claude/probe-models.js');

function createMockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  const written: string[] = [];
  child.stdin = new Writable({
    write(chunk, _enc, cb) {
      written.push(chunk.toString());
      cb();
    },
  }) as any;
  child.stdout = new Readable({ read() {} }) as any;
  child.stderr = new Readable({ read() {} }) as any;
  child.kill = vi.fn().mockReturnValue(true);
  Object.defineProperty(child, 'pid', { value: 12345 });
  (child as any)._written = written;
  return child;
}

function emitInitializeResponse(child: ChildProcess, models: unknown[]): void {
  const response = JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: 'test',
      response: {
        commands: [],
        agents: [],
        output_style: 'concise',
        available_output_styles: ['concise'],
        models,
        account: {},
        pid: 12345,
      },
    },
  });
  (child.stdout as Readable).push(response + '\n');
}

describe('probeModels', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('sends initialize request and parses model response', async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = probeModels('claude');

    // Wait for the initialize request to be written
    await vi.waitFor(() => {
      expect((child as any)._written.length).toBeGreaterThan(0);
    });

    const sent = JSON.parse((child as any)._written[0]);
    expect(sent.type).toBe('control_request');
    expect(sent.request.subtype).toBe('initialize');

    emitInitializeResponse(child, [
      {
        value: 'default',
        displayName: 'Default (recommended)',
        description: 'Opus 4.7 with 1M context',
        supportsEffort: true,
        supportsFastMode: true,
        supportsAutoMode: true,
      },
      { value: 'claude-sonnet-4-6', displayName: 'Sonnet', description: 'Sonnet 4.6 · Best for everyday tasks' },
    ]);

    const result = await promise;

    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({
      id: 'default',
      label: 'Default - Opus 4.7',
      description: 'Opus 4.7 with 1M context',
      supportsEffort: true,
      supportsFastMode: true,
      supportsAutoMode: true,
      isDefault: true,
    });
    expect(result![1]).toEqual({
      id: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      description: 'Sonnet 4.6 · Best for everyday tasks',
    });
    expect(child.kill).toHaveBeenCalled();
  });

  it('returns null on spawn error', async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = probeModels('claude');
    child.emit('error', new Error('not found'));

    const result = await promise;
    expect(result).toBeNull();
  });

  it('returns null on timeout', async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = probeModels('claude');
    vi.advanceTimersByTime(10_001);

    const result = await promise;
    expect(result).toBeNull();
    expect(child.kill).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
