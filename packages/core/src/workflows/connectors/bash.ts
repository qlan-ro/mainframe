import { z } from 'zod';
import { execFile } from 'node:child_process';
import type { Connector } from './types.js';

export const bashConnector: Connector = {
  id: 'bash',
  title: 'Shell commands',
  auth: { kind: 'none' },
  actions: {
    run: {
      title: 'Run command',
      // Array args only — repo rule: no shell interpolation, ever.
      input: z.object({
        command: z.string(),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
        env: z.record(z.string(), z.string()).optional(),
      }),
      output: z.object({ exitCode: z.number(), stdout: z.string(), stderr: z.string() }),
      idempotent: false,
      async run(ctx, input) {
        const { command, args, cwd, timeoutMs, env } = input as {
          command: string;
          args: string[];
          cwd?: string;
          timeoutMs: number;
          env?: Record<string, string>;
        };
        return new Promise((resolvePromise) => {
          execFile(
            command,
            args,
            {
              cwd: cwd ? ctx.resolvePath(cwd) : undefined,
              timeout: timeoutMs,
              signal: ctx.signal,
              maxBuffer: 8 * 1024 * 1024,
              env: env ? { ...process.env, ...env } : process.env,
            },
            (err, stdout, stderr) => {
              const exitCode = extractExitCode(err);
              resolvePromise({ exitCode, stdout: String(stdout), stderr: String(stderr) });
            },
          );
        });
      },
    },
  },
};

function extractExitCode(err: { code?: number | string | null } | null): number {
  if (!err) return 0;
  if (typeof err.code === 'number') return err.code;
  return 1;
}
