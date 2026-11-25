import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

export async function freePort() {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

/** The running process, or undefined once it has exited (a zombie has). */
export function identityOf(pid) {
  let line = '';
  try {
    const env = { ...process.env, LC_ALL: 'C' };
    line = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=,stat=,lstart='], { encoding: 'utf8', env }).trim();
  } catch {
    return undefined; // ps exits 1 when there is no such process
  }
  const [, ppid, stat, started] = /^(\d+)\s+(\S+)\s+(.*)$/.exec(line);
  return stat.startsWith('Z') ? undefined : { ppid: Number(ppid), started };
}

export async function until(condition, otherwise, tries = 200) {
  for (let i = 0; !(await condition()); i++) {
    assert.ok(i < tries, otherwise);
    await new Promise((r) => setTimeout(r, 50));
  }
}

export const assertGone = (pid) => until(() => !identityOf(pid), `pid ${pid} is still running`);

/** A signal lands after `kill` returns, so it waits for the exit a wrong one would cause. */
export async function assertSurvives(pid) {
  const before = identityOf(pid);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(before, `pid ${pid} was stopped`);
  assert.deepEqual(identityOf(pid), before, `pid ${pid} was stopped`);
}
