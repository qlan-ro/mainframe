// packages/core/src/__tests__/codex-adapter.test.ts
import { describe, it, expect, vi } from 'vitest';
import { CodexAdapter } from '../plugins/builtin/codex/adapter.js';

// Mock execFile
vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string) => void) => {
      cb(null, 'codex 1.2.3');
    }),
  };
});

describe('CodexAdapter', () => {
  it('has id "codex"', () => {
    const adapter = new CodexAdapter();
    expect(adapter.id).toBe('codex');
  });

  it('has name "Codex"', () => {
    const adapter = new CodexAdapter();
    expect(adapter.name).toBe('Codex');
  });

  it('isInstalled returns true when codex --version succeeds', async () => {
    const adapter = new CodexAdapter();
    expect(await adapter.isInstalled()).toBe(true);
  });

  it('getVersion extracts semver from stdout', async () => {
    const adapter = new CodexAdapter();
    expect(await adapter.getVersion()).toBe('1.2.3');
  });

  it('createSession returns a CodexSession', () => {
    const adapter = new CodexAdapter();
    const session = adapter.createSession({ projectPath: '/tmp' });
    expect(session.adapterId).toBe('codex');
    expect(session.projectPath).toBe('/tmp');
  });

  it('killAll kills all tracked sessions', async () => {
    const adapter = new CodexAdapter();
    const session1 = adapter.createSession({ projectPath: '/tmp' });
    const session2 = adapter.createSession({ projectPath: '/tmp' });
    vi.spyOn(session1, 'kill').mockResolvedValue();
    vi.spyOn(session2, 'kill').mockResolvedValue();

    adapter.killAll();

    expect(session1.kill).toHaveBeenCalled();
    expect(session2.kill).toHaveBeenCalled();
  });

  it('getToolCategories hides todo_list (handled by TasksSection per todo #133)', () => {
    const adapter = new CodexAdapter();
    const cats = adapter.getToolCategories();
    expect(cats.hidden.has('todo_list')).toBe(true);
  });

  it('getToolCategories declares no explore or subagent tools (Codex has no equivalents)', () => {
    const adapter = new CodexAdapter();
    const cats = adapter.getToolCategories();
    expect(cats.explore.size).toBe(0);
    expect(cats.subagent.size).toBe(0);
  });

  it('getToolCategories keeps todo_list in progress for parity', () => {
    const adapter = new CodexAdapter();
    expect(adapter.getToolCategories().progress.has('todo_list')).toBe(true);
  });
});
