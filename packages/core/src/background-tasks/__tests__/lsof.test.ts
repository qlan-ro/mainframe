import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lsofWriters, lsofWritersDetailed, lsofAny, __setExecForTests, __setLoggerForTests } from '../lsof.js';

type Run = (cmd: string, args: string[], opts: object) => Promise<{ stdout: string; stderr: string }>;

function ok(stdout: string): Run {
  return async () => ({ stdout, stderr: '' });
}
function fail(err: { code?: number | string; signal?: string; message?: string; stdout?: string }): Run {
  return async () => {
    throw Object.assign(new Error(err.message ?? 'lsof failed'), err);
  };
}

beforeEach(() => vi.resetAllMocks());

describe('lsofWritersDetailed', () => {
  it('parses write-mode FDs only', async () => {
    __setExecForTests(ok(['p1234', 'aw', 'n/p', 'p5678', 'ar', 'n/p', 'p9012', 'au', 'n/p'].join('\n') + '\n'));
    const r = await lsofWritersDetailed('/p');
    expect(r).toEqual({ ok: true, pids: [1234, 9012] });
  });
  it('exit code 1 => ok with empty pids (no matches)', async () => {
    __setExecForTests(fail({ code: 1, stdout: '' }));
    const r = await lsofWritersDetailed('/p');
    expect(r).toEqual({ ok: true, pids: [] });
  });
  it('ENOENT (lsof missing) => not ok', async () => {
    __setExecForTests(fail({ code: 'ENOENT' }));
    const r = await lsofWritersDetailed('/p');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/lsof/i);
  });
  it('exit code 2 (other error) => not ok', async () => {
    __setExecForTests(fail({ code: 2 }));
    const r = await lsofWritersDetailed('/p');
    expect(r.ok).toBe(false);
  });
  it('timeout (signal) => not ok', async () => {
    __setExecForTests(fail({ signal: 'SIGTERM', code: undefined }));
    const r = await lsofWritersDetailed('/p');
    expect(r.ok).toBe(false);
  });
  it('rejects non-numeric pids defensively', async () => {
    __setExecForTests(ok(['pabc', 'aw', 'n/p', 'p42', 'aw', 'n/p'].join('\n') + '\n'));
    const r = await lsofWritersDetailed('/p');
    expect(r).toEqual({ ok: true, pids: [42] });
  });
});

describe('lsofWriters (convenience)', () => {
  it('returns [] when lsof unavailable (collapses error to empty)', async () => {
    __setExecForTests(fail({ code: 'ENOENT' }));
    expect(await lsofWriters('/p')).toEqual([]);
  });
  it('returns pids on success', async () => {
    __setExecForTests(ok(['p7', 'aw', 'n/p'].join('\n') + '\n'));
    expect(await lsofWriters('/p')).toEqual([7]);
  });
});

describe('lsofAny', () => {
  it('returns pids regardless of access mode', async () => {
    __setExecForTests(ok(['p1', 'ar', 'n/p', 'p2', 'aw', 'n/p'].join('\n') + '\n'));
    expect(await lsofAny('/p')).toEqual([1, 2]);
  });
});

describe('lsof ENOENT warn-once', () => {
  it('only logs warn once across repeated ENOENT calls', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    });
    __setExecForTests(exec); // also resets warnedMissing
    const warnSpy = vi.fn();
    __setLoggerForTests({ warn: warnSpy });
    const r1 = await lsofWritersDetailed('/p');
    const r2 = await lsofWritersDetailed('/p');
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
