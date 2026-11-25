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

/** Longer than either program takes on a loaded machine. One that hangs must not hang the run. */
const LOOKUP_TIMEOUT = 10_000;

/**
 * What ps or lsof prints, or '' when it found nothing: exit 1 without output. Throws when it cannot tell, because it
 * is missing, took too long, or failed. lsof also exits 1 after printing some of what it was asked for, so its list
 * may lack the very process a caller must know of.
 */
function output(file: string, args: string[]): string {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: LOOKUP_TIMEOUT,
      killSignal: 'SIGKILL',
    });
  } catch (err) {
    const { code, status, stdout } = err as { code?: string; status?: number | null; stdout?: string };
    if (status === 1 && !stdout?.trim()) return '';
    const printed = stdout?.trim() ? ` and printed: ${stdout.trim().slice(0, 300)}` : '';
    throw new Error(
      `Cannot tell what runs here, so nothing will be used or stopped: ${[file, ...args].join(' ')} failed ` +
        `(${code ?? `exit ${status}`})${printed}`,
    );
  }
}

function processOf(pid: number): Process | undefined {
  const line = output('ps', ['-ww', '-p', String(pid), '-o', 'ppid=,lstart=,command=']).trim();
  if (!line) return undefined;
  const match = /^(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d{4})\s*(.*)$/s.exec(line);
  if (!match) throw new Error(`Cannot tell what pid ${pid} is. ps printed: ${line.slice(0, 300)}`);
  return { pid, ppid: Number(match[1]), started: match[2]!, command: match[3]! };
}

function cwdOf(pid: number): string | undefined {
  const fields = output('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n');
  return fields.find((field) => field.startsWith('n'))?.slice(1);
}

/** Whether `isOwn` holds for the process or one it descends from. A parent that has exited ends the line. */
function descendsFrom(found: Process, isOwn: (each: Process) => boolean): boolean {
  let each: Process | undefined = found;
  while (each) {
    if (isOwn(each)) return true;
    each = each.ppid > 1 ? processOf(each.ppid) : undefined;
  }
  return false;
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

/** The ledger's lines. A process killed while writing leaves a torn one, which says nothing. */
function lines(ledger: string | undefined): Record<string, unknown>[] {
  if (!ledger || !existsSync(ledger)) return [];
  const parsed = readFileSync(ledger, 'utf8')
    .split('\n')
    .map((line): unknown => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined; /* expected: a torn or an empty line */
      }
    });
  return parsed.filter((line): line is Record<string, unknown> => typeof line === 'object' && line !== null);
}

const isIdentity = (value: Record<string, unknown>): boolean =>
  Number.isInteger(value['pid']) && typeof value['started'] === 'string';

function read(ledger: string | undefined): Started[] {
  const found = lines(ledger).filter((line) => isIdentity(line) && Number.isInteger(line['port']));
  return found as unknown as Started[];
}

/** Whether the run that keeps the ledger is over; undefined when the ledger does not say whose it is. */
function isOver(ledger: string): boolean | undefined {
  const run = lines(ledger).find((line) => line['run'] === true && isIdentity(line)) as Identity | undefined;
  return run && !isSame(run, processOf(run.pid));
}

// A line of its own even after a torn one.
const append = (ledger: string, line: object): void => appendFileSync(ledger, `\n${JSON.stringify(line)}\n`);

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
  return ledgersIn(path.dirname(ledger)).some((earlier) => startedOn(port, found, earlier) && isOver(earlier) === true);
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
  // Records of processes that are gone say nothing any more. A run that is not over may still add to its own.
  for (const ledger of ledgersIn(dir)) {
    const running = read(ledger).some((own) => isSame(own, processOf(own.pid)));
    if (!running && isOver(ledger) !== false) rmSync(ledger, { force: true });
  }
  mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.jsonl`);
  process.env[LEDGER_ENV] = ledger;
  const self = processOf(process.pid);
  if (self) append(ledger, { run: true, pid: self.pid, started: self.started });
  return () => {
    const failures = read(ledger).flatMap((own) => {
      try {
        kill(own);
        return [];
      } catch (err) {
        return [err]; // the others are stopped all the same
      }
    });
    // Kept otherwise: it lets the next run stop what this one could not.
    if (failures.length > 0) throw new AggregateError(failures, failures.map(String).join('\n'));
    rmSync(ledger, { force: true });
  };
}

/** Call right after spawning the server of a port. */
export function recordStarted(child: ChildProcess, port: number): void {
  const ledger = process.env[LEDGER_ENV];
  const found = child.pid === undefined ? undefined : processOf(child.pid);
  if (!ledger || !found) return;
  append(ledger, { pid: found.pid, started: found.started, port } satisfies Started);
}

function describe({ pid, command, started }: Process): string {
  const shown = command.length > 300 ? `${command.slice(0, 300)}…` : command;
  let cwd: string | undefined;
  try {
    cwd = cwdOf(pid);
  } catch {
    /* expected: lsof could not tell; the refusal names the rest */
  }
  return `  pid ${pid}, started ${started}, in ${cwd ?? 'an unknown directory'}:\n    ${shown}`;
}

const taken = (port: number, foreign: Process[], remedy: string): Error =>
  new Error(
    `Port ${port} is taken by a process this run did not start, so it will not be used or stopped:\n` +
      (foreign.map(describe).join('\n') || '  a process lsof cannot name (another user’s)') +
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
 * A process the child starts holds its listener too, until it execs, so a descendant is the child's as well.
 */
export function isServing(child: ChildProcess, port: number, remedy: string): boolean {
  const holders = listenersOn(port);
  const foreign = holders.filter((found) => !descendsFrom(found, ({ pid }) => pid === child.pid));
  if (foreign.length > 0) throw taken(port, foreign, remedy);
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`The server started for port ${port} exited (${child.signalCode ?? `code ${child.exitCode}`}).`);
  }
  return holders.length > 0;
}

/**
 * Throws unless every listener on `port` is one this run recorded, or descends from it as above. For a server another
 * process of the run started: the workers', say, of the preview.
 */
export function assertRunServes(port: number, remedy: string): void {
  const holders = listenersOn(port);
  const ledger = process.env[LEDGER_ENV];
  const foreign = holders.filter((found) => !descendsFrom(found, (each) => startedOn(port, each, ledger)));
  if (foreign.length > 0) throw taken(port, foreign, remedy);
  if (holders.length === 0) throw new Error(`Nothing listens on port ${port} any more.`);
}
