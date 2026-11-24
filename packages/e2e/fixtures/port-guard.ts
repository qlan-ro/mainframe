// The harness uses only servers it started, and stops only processes it started. Everything else on its ports is
// somebody else's (another session's run, a dev daemon, the installed app): the run refuses to start.
import { execFileSync, type ChildProcess } from 'child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from 'fs';
import { connect } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

/** The installed app's daemon. */
const PRODUCTION_PORT = 31415;

/** Where each run of this worktree lists the processes it starts, one file per run. */
const RUNS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../.harness');
/** This run's file. An env var, so a worker started later finds it too. */
const LEDGER_ENV = 'MF_E2E_RUN_LEDGER';

/** What this worktree starts on a port: the exact command line and working directory. */
export interface OwnProcess {
  command: string;
  cwd: string;
}

/** A process and its start time: a pid alone is reused. */
interface Identity {
  pid: number;
  started: string;
}

interface Started extends Identity {
  port: number;
}

interface Process extends Identity {
  ppid: number;
  command: string;
}

/** The port a variable names. Read at load, so a run that names the installed app's port never begins. */
export function harnessPort(envName: string, fallback: string): number {
  const value = process.env[envName] ?? fallback;
  if (!/^[1-9]\d{3,4}$/.test(value) || Number(value) > 65_535) throw new Error(`${envName}="${value}" is not a port.`);
  if (Number(value) === PRODUCTION_PORT) {
    throw new Error(`${envName} must not be ${PRODUCTION_PORT}: that is the installed app's daemon.`);
  }
  return Number(value);
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

const isSame = (a: Identity, b: Identity | undefined): boolean => a.pid === b?.pid && a.started === b.started;

function read(ledger: string | undefined): Started[] {
  if (!ledger || !existsSync(ledger)) return [];
  const lines = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line) as Started);
}

function ledgersIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).map((name) => path.join(dir, name)) : [];
}

const startedOn = (port: number, found: Process, ledger: string | undefined): boolean =>
  read(ledger).some((own) => own.port === port && isSame(own, found));

/** A process an earlier run of this worktree recorded and left: it has no parent, and is exactly what we would start. */
function isOwnOrphan(port: number, found: Process, own: OwnProcess | undefined): boolean {
  const ledger = process.env[LEDGER_ENV];
  if (!own || !ledger || found.ppid !== 1 || found.command !== own.command) return false;
  if (cwdOf(found.pid) !== realpathSync(own.cwd)) return false;
  return ledgersIn(path.dirname(ledger)).some((earlier) => earlier !== ledger && startedOn(port, found, earlier));
}

/** Looks the process up again right before the signal, so a pid reused meanwhile is left alone. */
function kill(own: Identity): void {
  if (!isSame(own, processOf(own.pid))) return;
  try {
    process.kill(own.pid, 'SIGKILL');
  } catch {
    /* expected: it exited by itself */
  }
}

/** Starts a run's record of its processes. The returned teardown kills the ones still alive. */
export function beginRun(dir = RUNS_DIR): () => void {
  // Records of processes that are gone say nothing any more.
  for (const ledger of ledgersIn(dir)) {
    if (!read(ledger).some((own) => isSame(own, processOf(own.pid)))) rmSync(ledger, { force: true });
  }
  mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env[LEDGER_ENV] = ledger;
  return () => {
    read(ledger).forEach(kill);
    rmSync(ledger, { force: true });
  };
}

/** Call right after spawning the server of a port. */
export function recordStarted(child: ChildProcess, port: number): void {
  const ledger = process.env[LEDGER_ENV];
  const found = child.pid === undefined ? undefined : processOf(child.pid);
  if (!ledger || !found) return;
  appendFileSync(ledger, `${JSON.stringify({ pid: found.pid, started: found.started, port } satisfies Started)}\n`);
}

function describe({ pid, command, started }: Process): string {
  const shown = command.length > 300 ? `${command.slice(0, 300)}…` : command;
  return `  pid ${pid}, started ${started}, in ${cwdOf(pid) ?? 'an unknown directory'}:\n    ${shown}`;
}

const taken = (port: number, foreign: Process[], remedy: string): Error =>
  new Error(
    `Port ${port} is taken by a process this run did not start, so it will not be used or stopped:\n` +
      (foreign.map(describe).join('\n') || '  a process lsof cannot name (another user’s, or lsof is missing)') +
      `\n${remedy}`,
  );

/**
 * Makes sure nothing listens on `port`. A process left by this run (a timed-out worker never runs its
 * `afterAll`), or orphaned by an earlier run of this worktree, is killed; anything else is refused by name.
 */
export async function ensurePortFree(port: number, own: OwnProcess | undefined, remedy: string): Promise<void> {
  const holders = listenersOn(port);
  if (holders.length === 0 && !(await accepts(port))) return;

  const ledger = process.env[LEDGER_ENV];
  const foreign = holders.filter((found) => !startedOn(port, found, ledger) && !isOwnOrphan(port, found, own));
  if (holders.length === 0 || foreign.length > 0) throw taken(port, foreign, remedy);

  holders.forEach(kill);
  const deadline = Date.now() + 5_000;
  while (listenersOn(port).length > 0 || (await accepts(port))) {
    if (Date.now() > deadline) throw new Error(`Port ${port} is still taken after stopping this worktree’s process.`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Whether the server on `port` is `child`: false while nothing listens yet. Throws when the child has exited or
 * something else listens. Call it before a request, so that none reaches a server this run did not start.
 */
export function isServing(child: ChildProcess, port: number, remedy: string): boolean {
  const holders = listenersOn(port);
  const foreign = holders.filter(({ pid }) => pid !== child.pid);
  if (foreign.length > 0) throw taken(port, foreign, remedy);
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`The server started for port ${port} exited (${child.signalCode ?? `code ${child.exitCode}`}).`);
  }
  return holders.length > 0;
}
