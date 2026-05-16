import { describe, it, expect, vi } from 'vitest';
import { resolveAdapterExecutable, backfillAdapterExecutables, BARE_NAMES } from '../resolve-executable.js';

type SettingsStub = {
  store: Map<string, string>;
  get: (c: string, k: string) => string | null;
  set: (c: string, k: string, v: string) => void;
};
function settingsStub(initial: Record<string, string> = {}): SettingsStub {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: (c, k) => store.get(`${c}.${k}`) ?? null,
    set: (c, k, v) => void store.set(`${c}.${k}`, v),
  };
}

describe('resolveAdapterExecutable', () => {
  it('uses a configured path and validates via --version', async () => {
    const runner = vi.fn(async (cmd: string, args: string[]) => {
      if (args.includes('--version')) return { ok: true, stdout: 'claude 1.2.3\n' };
      return { ok: false, stdout: '' };
    });
    const s = settingsStub({ 'provider.claude.executablePath': '/usr/local/bin/claude' });
    const r = await resolveAdapterExecutable('claude', { settings: s, run: runner, platform: 'darwin' });
    expect(r).toEqual({ path: '/usr/local/bin/claude', source: 'config', valid: true, version: '1.2.3' });
    expect(runner).toHaveBeenCalledWith('/usr/local/bin/claude', ['--version'], expect.anything());
  });

  it('detects via which on posix and reports detected', async () => {
    const runner = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { ok: true, stdout: '/opt/homebrew/bin/claude\n' };
      if (args.includes('--version')) return { ok: true, stdout: 'claude 9.9.9\n' };
      return { ok: false, stdout: '' };
    });
    const r = await resolveAdapterExecutable('claude', { settings: settingsStub(), run: runner, platform: 'darwin' });
    expect(r).toEqual({ path: '/opt/homebrew/bin/claude', source: 'detected', valid: true, version: '9.9.9' });
    expect(runner).toHaveBeenCalledWith('which', ['claude'], expect.anything());
  });

  it('detects via where on win32', async () => {
    const runner = vi.fn(async (cmd: string) => {
      if (cmd === 'where') return { ok: true, stdout: 'C:\\bin\\codex.exe\r\n' };
      return { ok: true, stdout: 'codex 1.0.0' };
    });
    const r = await resolveAdapterExecutable('codex', { settings: settingsStub(), run: runner, platform: 'win32' });
    expect(r.source).toBe('detected');
    expect(r.path).toBe('C:\\bin\\codex.exe');
  });

  it('falls back to bare name when nothing is found', async () => {
    const runner = vi.fn(async () => ({ ok: false, stdout: '' }));
    const r = await resolveAdapterExecutable('claude', { settings: settingsStub(), run: runner, platform: 'darwin' });
    expect(r).toEqual({ path: 'claude', source: 'fallback', valid: false });
  });
});

describe('backfillAdapterExecutables', () => {
  it('writes detected absolute path only when config is empty (idempotent)', async () => {
    const runner = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'which') return { ok: true, stdout: '/opt/homebrew/bin/claude\n' };
      if (args.includes('--version')) return { ok: true, stdout: 'claude 1.0.0' };
      return { ok: false, stdout: '' };
    });
    const s = settingsStub();
    await backfillAdapterExecutables(['claude'], { settings: s, run: runner, platform: 'darwin' });
    expect(s.get('provider', 'claude.executablePath')).toBe('/opt/homebrew/bin/claude');

    const runner2 = vi.fn(async () => ({ ok: true, stdout: '/somewhere/else/claude\n' }));
    await backfillAdapterExecutables(['claude'], { settings: s, run: runner2, platform: 'darwin' });
    expect(s.get('provider', 'claude.executablePath')).toBe('/opt/homebrew/bin/claude');
  });

  it('does not backfill when detection fails', async () => {
    const runner = vi.fn(async () => ({ ok: false, stdout: '' }));
    const s = settingsStub();
    await backfillAdapterExecutables(['codex'], { settings: s, run: runner, platform: 'linux' });
    expect(s.get('provider', 'codex.executablePath')).toBeNull();
  });
});

it('exposes a bare-name map', () => {
  expect(BARE_NAMES.claude).toBe('claude');
  expect(BARE_NAMES.codex).toBe('codex');
});

it('defaultRun returns ok:false for a nonexistent binary (no throw)', async () => {
  const { defaultRun } = await import('../resolve-executable.js');
  const r = await defaultRun('definitely-not-a-real-binary-xyz', ['--version'], { timeoutMs: 2000 });
  expect(r.ok).toBe(false);
  expect(typeof r.stdout).toBe('string');
});
