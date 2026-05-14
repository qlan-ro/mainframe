#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pinoPretty from 'pino-pretty';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const config = require(resolve(__dirname, '..', 'pino-pretty.config.cjs'));

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: dev-pretty.mjs <cmd> [args...]');
  process.exit(2);
}

const child = spawn(cmd, args, {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: process.env,
});

// pino-pretty writes its formatted output to `destination` (defaults to stdout).
// Do NOT pipe its Transform output to stdout — that would duplicate the raw input.
// `sync: true` flushes each line immediately to fd 1; without it, SonicBoom's
// async buffering can swallow output when the source stream is slow/idle.
const prettyStream = pinoPretty({ ...config, destination: 1, sync: true });
child.stdout.pipe(prettyStream);

const forward = (sig) => {
  try {
    child.kill(sig);
  } catch {
    /* child may already be dead */
  }
};

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
process.on('SIGHUP', () => forward('SIGHUP'));

child.on('exit', (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
    } catch {
      /* child may already be dead */
    }
    return;
  }
  process.exit(code ?? 0);
});
