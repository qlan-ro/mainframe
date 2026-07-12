// packages/core/src/automations/actions/run-command.ts
//
// A1 (contract §6): script chips never touch shell text. The future
// run_action executor (Task 23) resolves each chip in the script to its
// plain string value but — unlike every other action's ChipText, which gets
// joined into one rendered string — keeps chip boundaries, passing them here
// as `script` parts. Each chip becomes its own MF_<n> child env var; only
// author-typed literal text ever becomes shell source.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { resolveAndValidatePath } from '../../server/routes/path-utils.js';
import type { ActionCtx, ActionDef } from './types.js';

const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const STDERR_TAIL_CHARS = 4000;

const scriptPartSchema = z.union([z.object({ literal: z.string() }).strict(), z.object({ chip: z.string() }).strict()]);

export const RunCommandInputSchema = z
  .object({
    script: z.array(scriptPartSchema).min(1),
    runIn: z.enum(['project root', 'worktree', 'custom']),
    customPath: z.string().optional(),
    outputAs: z.enum(['text', 'lines']).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.runIn === 'custom' && !input.customPath) {
      ctx.addIssue({ code: 'custom', message: "runIn 'custom' requires customPath" });
    }
  });

export type RunCommandInput = z.infer<typeof RunCommandInputSchema>;

/** Each chip becomes its own quoted `"$MF_<n>"` placeholder — the value never becomes shell text. */
export function compileScript(parts: RunCommandInput['script']): { script: string; env: Record<string, string> } {
  const env: Record<string, string> = {};
  let script = '';
  let chipIndex = 0;
  for (const part of parts) {
    if ('literal' in part) {
      script += part.literal;
      continue;
    }
    const name = `MF_${chipIndex}`;
    env[name] = part.chip;
    script += `"$${name}"`;
    chipIndex += 1;
  }
  return { script, env };
}

/** cwd is never shell source — 'custom' is the only mode that runs user-authored text through path containment (A1). */
function resolveCwd(ctx: ActionCtx, input: RunCommandInput): string {
  if (input.runIn === 'project root') return ctx.projectRoot;
  if (input.runIn === 'worktree') {
    if (!ctx.worktreePath)
      throw new Error('run_command runIn "worktree" requested but no worktree is active for this run');
    return ctx.worktreePath;
  }
  const resolved = resolveAndValidatePath(ctx.projectRoot, input.customPath!);
  if (!resolved) throw new Error(`run_command custom cwd '${input.customPath}' is outside the project root`);
  return resolved;
}

export function resolveShellBinary(exists: (path: string) => boolean = existsSync): string {
  return exists('/bin/zsh') ? '/bin/zsh' : '/bin/sh';
}

function extractExitCode(err: { code?: number | string | null } | null): number | null {
  if (!err) return 0;
  return typeof err.code === 'number' ? err.code : null;
}

function spawnScript(
  shell: string,
  script: string,
  cwd: string,
  env: Record<string, string>,
  signal: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      shell,
      ['-lc', script],
      { cwd, env: { ...process.env, ...env }, signal, maxBuffer: MAX_OUTPUT_BYTES },
      (err, stdout, stderr) => {
        const exitCode = extractExitCode(err);
        // A null exit code means the process never produced one (spawn error, abort) — that's not a script failure to report as exitCode.
        if (err && exitCode === null) {
          rejectPromise(err);
          return;
        }
        resolvePromise({ exitCode: exitCode ?? 0, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

function formatOutput(stdout: string, outputAs: RunCommandInput['outputAs']): string | string[] {
  const trimmed = stdout.trim();
  if (outputAs !== 'lines') return trimmed;
  if (trimmed.length === 0) return [];
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const runCommandAction: ActionDef = {
  id: 'run_command',
  title: 'Run command',
  group: 'builtin',
  auth: 'none',
  input: RunCommandInputSchema,
  outputs: [
    { name: 'output', type: 'text' },
    { name: 'exitCode', type: 'number' },
  ],
  idempotent: false,
  async run(ctx, rawInput) {
    const input = RunCommandInputSchema.parse(rawInput);
    const cwd = resolveCwd(ctx, input);
    const { script, env } = compileScript(input.script);
    const shell = resolveShellBinary();
    const { exitCode, stdout, stderr } = await spawnScript(shell, script, cwd, env, ctx.signal);
    if (exitCode !== 0) {
      const tail = stderr.trim().slice(-STDERR_TAIL_CHARS);
      throw new Error(`run_command exited ${exitCode}: ${tail || '(no stderr output)'}`);
    }
    return { output: formatOutput(stdout, input.outputAs), exitCode };
  },
};
