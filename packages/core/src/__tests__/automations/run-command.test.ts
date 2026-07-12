// packages/core/src/__tests__/automations/run-command.test.ts
//
// A1 (contract §6): script chips never touch shell text. Each chip becomes
// its own MF_<n> child env var; the compiled script only ever substitutes a
// quoted "$MF_<n>" where the chip sat.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { compileScript, resolveShellBinary, runCommandAction } from '../../automations/actions/run-command.js';
import type { ActionCtx } from '../../automations/actions/types.js';

const silentLogger = pino({ level: 'silent' });

function ctxFor(projectRoot: string, overrides: Partial<ActionCtx> = {}): ActionCtx {
  return {
    creds: null,
    idempotencyKey: 'run-1:step-1:0',
    signal: new AbortController().signal,
    logger: silentLogger,
    resolvePath: (p) => p,
    projectRoot,
    ...overrides,
  };
}

describe('compileScript', () => {
  it('quotes each chip as its own MF_<n> placeholder and never splices the value into the script text', () => {
    const { script, env } = compileScript([
      { literal: 'echo ' },
      { chip: 'hello world' },
      { literal: ' && echo ' },
      { chip: 'again' },
    ]);
    expect(script).toBe('echo "$MF_0" && echo "$MF_1"');
    expect(env).toEqual({ MF_0: 'hello world', MF_1: 'again' });
  });

  it('leaves pure-literal scripts untouched with no env vars', () => {
    const { script, env } = compileScript([{ literal: 'echo hi' }]);
    expect(script).toBe('echo hi');
    expect(env).toEqual({});
  });
});

describe('resolveShellBinary', () => {
  it('prefers zsh when present', () => {
    expect(resolveShellBinary(() => true)).toBe('/bin/zsh');
  });

  it('falls back to sh when zsh is absent', () => {
    expect(resolveShellBinary(() => false)).toBe('/bin/sh');
  });
});

describe('run_command action', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'run-command-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs a multiline script via the login shell and captures trimmed stdout', async () => {
    const outcome = await runCommandAction.run(ctxFor(dir), {
      script: [{ literal: 'echo line1\necho line2\n' }],
      runIn: 'project root',
    });
    expect(outcome.output).toBe('line1\nline2');
    expect(outcome.exitCode).toBe(0);
  });

  it('a hostile chip value produces no side effect — it never becomes shell source', async () => {
    const marker = join(dir, 'mf_pwned');
    await runCommandAction.run(ctxFor(dir), {
      script: [{ literal: 'echo ' }, { chip: `; touch ${marker}; ` }],
      runIn: 'project root',
    });
    expect(existsSync(marker)).toBe(false);
  });

  it('the hostile chip value still reaches the script verbatim via $MF_n', async () => {
    const outcome = await runCommandAction.run(ctxFor(dir), {
      script: [{ literal: 'echo ' }, { chip: '; rm -rf /tmp/nope; ' }],
      runIn: 'project root',
    });
    expect(outcome.output).toBe('; rm -rf /tmp/nope;');
  });

  it('rejects a custom cwd outside the project root before spawning', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'run-command-outside-'));
    try {
      await expect(
        runCommandAction.run(ctxFor(dir), {
          script: [{ literal: `touch ${join(outsideDir, 'should-not-exist')}` }],
          runIn: 'custom',
          customPath: outsideDir,
        }),
      ).rejects.toThrow(/outside the project root/);
      expect(existsSync(join(outsideDir, 'should-not-exist'))).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('accepts a custom cwd contained within the project root', async () => {
    const inner = join(dir, 'inner');
    mkdirSync(inner);
    await runCommandAction.run(ctxFor(dir), {
      script: [{ literal: 'touch marker.txt' }],
      runIn: 'custom',
      customPath: inner,
    });
    expect(existsSync(join(inner, 'marker.txt'))).toBe(true);
  });

  it('"worktree" cwd mode spawns in ctx.worktreePath', async () => {
    const wt = join(dir, 'wt');
    mkdirSync(wt);
    await runCommandAction.run(ctxFor(dir, { worktreePath: wt }), {
      script: [{ literal: 'touch marker.txt' }],
      runIn: 'worktree',
    });
    expect(existsSync(join(wt, 'marker.txt'))).toBe(true);
  });

  it('"worktree" cwd mode fails loudly when no worktree is active for the run', async () => {
    await expect(
      runCommandAction.run(ctxFor(dir), { script: [{ literal: 'echo hi' }], runIn: 'worktree' }),
    ).rejects.toThrow(/no worktree/);
  });

  it('outputAs "lines" splits trimmed stdout into a list', async () => {
    const outcome = await runCommandAction.run(ctxFor(dir), {
      script: [{ literal: 'echo a\necho b\necho c\n' }],
      runIn: 'project root',
      outputAs: 'lines',
    });
    expect(outcome.output).toEqual(['a', 'b', 'c']);
  });

  it('a non-zero exit throws with the stderr tail in the message', async () => {
    await expect(
      runCommandAction.run(ctxFor(dir), {
        script: [{ literal: 'echo boom 1>&2; exit 3' }],
        runIn: 'project root',
      }),
    ).rejects.toThrow(/boom/);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(runCommandAction.id).toBe('run_command');
    expect(runCommandAction.idempotent).toBe(false);
    expect(runCommandAction.outputs).toEqual([
      { name: 'output', type: 'text' },
      { name: 'exitCode', type: 'number' },
    ]);
  });
});
