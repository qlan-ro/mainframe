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
      subtype: 'initialize',
      request_id: 'test',
      models,
      commands: [],
      agents: [],
      output_style: 'concise',
      available_output_styles: ['concise'],
      account: {},
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
        value: 'claude-opus-4-6',
        displayName: 'Opus',
        description: 'Most capable',
        supportsEffort: true,
        supportsFastMode: true,
        supportsAutoMode: true,
      },
      { value: 'claude-sonnet-4-6', displayName: 'Sonnet', description: 'Fast' },
    ]);

    const result = await promise;

    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({
      id: 'claude-opus-4-6',
      label: 'Opus',
      supportsEffort: true,
      supportsFastMode: true,
      supportsAutoMode: true,
    });
    expect(result![1]).toEqual({ id: 'claude-sonnet-4-6', label: 'Sonnet' });
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
