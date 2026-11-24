// Frees a harness port only of a process the harness itself started. Everything else on the port is
// somebody else's (another session's run, a dev daemon, the installed app): the run refuses to start.
import { execFileSync } from 'child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs';
import { connect } from 'net';
import { tmpdir } from 'os';
import path from 'path';

/** The file naming every process this run started. An env var, so a worker started later finds it too. */
const LEDGER_ENV = 'MF_E2E_RUN_LEDGER';

/** What this worktree starts on a port: the exact command line and working directory. */
export interface OwnProcess {
  command: string;
  cwd: string;
}

interface Process {
  pid: number;
  ppid: number;
  /** With the pid, the identity of a process: a pid alone is reused. */
  started: string;
  command: string;
}

function output(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return ''; /* expected: ps and lsof exit 1 when they find nothing */
  }
}

function processOf(pid: number): Process | undefined {
  const line = output('ps', ['-ww', '-p', String(pid), '-o', 'ppid=,lstart=,command=']).trim();
  const match = /^(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/s.exec(line);
  if (!match) return undefined;
  return { pid, ppid: Number(match[1]), started: match[2]!, command: match[3]! };
}

function cwdOf(pid: number): string | undefined {
  const fields = output('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n');
  return fields.find((field) => field.startsWith('n'))?.slice(1);
}

/** Only listeners: without the state filter lsof also names the port's clients, browsers included. */
function listenersOn(port: number): Process[] {
  const pids = output('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'])
    .split('\n')
    .filter(Boolean);
  return pids.map((pid) => processOf(Number(pid))).filter((found) => found !== undefined);
}

function accepts(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host: '127.0.0.1', timeout: 1_000 });
    const finish = (open: boolean): void => {
      socket.destroy();
      done(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function recorded(): Pick<Process, 'pid' | 'started'>[] {
  const ledger = process.env[LEDGER_ENV];
  if (!ledger || !existsSync(ledger)) return [];
  return readFileSync(ledger, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Pick<Process, 'pid' | 'started'>);
}

function isRecorded(found: Process): boolean {
  return recorded().some((own) => own.pid === found.pid && own.started === found.started);
}

/** An earlier run of this worktree left it: nobody owns it any more, and it is exactly what we would start. */
function isOwnOrphan(found: Process, own: OwnProcess | undefined): boolean {
  if (!own) return false;
  return found.ppid === 1 && found.command === own.command && cwdOf(found.pid) === realpathSync(own.cwd);
}

function kill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* expected: it exited by itself */
  }
}

/** Starts a run's record of its processes. The returned teardown kills the ones still alive. */
export function beginRun(): () => void {
  const dir = mkdtempSync(path.join(tmpdir(), 'mf-e2e-run-'));
  process.env[LEDGER_ENV] = path.join(dir, 'started.jsonl');
  return () => {
    for (const { pid, started } of recorded()) if (processOf(pid)?.started === started) kill(pid);
    rmSync(dir, { recursive: true, force: true });
  };
}

/** Call right after spawning a process that will hold a port. */
export function recordStarted(pid: number | undefined): void {
  const ledger = process.env[LEDGER_ENV];
  const started = pid === undefined ? undefined : processOf(pid)?.started;
  if (ledger && started) appendFileSync(ledger, `${JSON.stringify({ pid, started })}\n`);
}

function describe({ pid, command, started }: Process): string {
  const shown = command.length > 300 ? `${command.slice(0, 300)}…` : command;
  return `  pid ${pid}, started ${started}, in ${cwdOf(pid) ?? 'an unknown directory'}:\n    ${shown}`;
}

/**
 * Makes sure nothing listens on `port`. A process left by this run (a timed-out worker never runs its
 * `afterAll`), or orphaned by an earlier run of this worktree, is killed; anything else is refused by name.
 */
export async function ensurePortFree(port: number, own: OwnProcess | undefined, remedy: string): Promise<void> {
  const holders = listenersOn(port);
  if (holders.length === 0 && !(await accepts(port))) return;

  const foreign = holders.filter((found) => !isRecorded(found) && !isOwnOrphan(found, own));
  if (holders.length === 0 || foreign.length > 0) {
    throw new Error(
      `Port ${port} is taken by a process this run did not start, so it will not be stopped:\n` +
        (foreign.map(describe).join('\n') || '  a process lsof cannot name (another user’s, or lsof is missing)') +
        `\n${remedy}`,
    );
  }

  for (const { pid } of holders) kill(pid);
  const deadline = Date.now() + 5_000;
  while (listenersOn(port).length > 0 || (await accepts(port))) {
    if (Date.now() > deadline) throw new Error(`Port ${port} is still taken after stopping this worktree’s process.`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
