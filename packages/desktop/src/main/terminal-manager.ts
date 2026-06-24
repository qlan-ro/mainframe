import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { statSync } from 'fs';
import pty from 'node-pty';
import type { IPty } from 'node-pty';
import {
  TerminalCreateOptsSchema,
  TerminalWriteSchema,
  TerminalResizeSchema,
  TerminalIdSchema,
} from '@qlan-ro/mainframe-types';
import { parseIpcArg } from './ipc-validate.js';
import { createMainLogger } from './logger.js';

const log = createMainLogger('terminal');

interface ManagedTerminal {
  pty: IPty;
  /** webContents.id that owns this terminal — used to route data events */
  webContentsId: number;
}

const terminals = new Map<string, ManagedTerminal>();
const resizeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PTY_RESIZE_DEBOUNCE_MS = 100;

export function setupTerminalIPC(shellEnv: Record<string, string>): void {
  const defaultShell =
    process.platform === 'win32' ? 'powershell.exe' : shellEnv['SHELL'] || process.env.SHELL || '/bin/zsh';

  ipcMain.handle('terminal:create', (event: IpcMainInvokeEvent, options: unknown) => {
    const opts = parseIpcArg(TerminalCreateOptsSchema, options, 'terminal:create');
    try {
      const st = statSync(opts.cwd);
      if (!st.isDirectory()) throw new Error(`Not a directory: ${opts.cwd}`);
    } catch (err) {
      log.warn({ cwd: opts.cwd, err }, 'terminal:create invalid cwd');
      throw new Error(`Invalid terminal cwd: ${opts.cwd}`);
    }

    const id = opts.id;
    const term = pty.spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, ...shellEnv, TERM_PROGRAM: 'Mainframe', ZSH_DOTENV_PROMPT: 'false' },
    });

    const webContentsId = event.sender.id;
    terminals.set(id, { pty: term, webContentsId });

    term.onData((data: string) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('terminal:data', id, Buffer.from(data, 'utf-8'));
        }
      } catch {
        /* expected: webContents destroyed — cleaned up on quit */
      }
    });

    term.onExit(({ exitCode }) => {
      try {
        if (!event.sender.isDestroyed()) event.sender.send('terminal:exit', id, exitCode);
      } catch {
        /* expected: webContents destroyed */
      }
      terminals.delete(id);
    });

    log.info({ id, cwd: opts.cwd, shell: defaultShell }, 'terminal created');
    return { id };
  });

  ipcMain.handle('terminal:write', (_event: IpcMainInvokeEvent, options: unknown) => {
    const opts = parseIpcArg(TerminalWriteSchema, options, 'terminal:write');
    const entry = terminals.get(opts.id);
    if (!entry) return;
    entry.pty.write(opts.data);
  });

  ipcMain.handle('terminal:resize', (_event: IpcMainInvokeEvent, options: unknown) => {
    const opts = parseIpcArg(TerminalResizeSchema, options, 'terminal:resize');
    const entry = terminals.get(opts.id);
    if (!entry) return;
    clearTimeout(resizeTimers.get(opts.id));
    resizeTimers.set(
      opts.id,
      setTimeout(() => {
        resizeTimers.delete(opts.id);
        try {
          entry.pty.resize(opts.cols, opts.rows);
        } catch {
          /* resize can throw if process already exited */
        }
      }, PTY_RESIZE_DEBOUNCE_MS),
    );
  });

  ipcMain.handle('terminal:kill', (_event: IpcMainInvokeEvent, options: unknown) => {
    const opts = parseIpcArg(TerminalIdSchema, options, 'terminal:kill');
    const entry = terminals.get(opts.id);
    if (!entry) return;
    clearTimeout(resizeTimers.get(opts.id));
    resizeTimers.delete(opts.id);
    try {
      entry.pty.kill();
    } catch {
      /* already dead */
    }
    terminals.delete(opts.id);
    log.info({ id: opts.id }, 'terminal killed');
  });
}

export function killAllTerminals(): void {
  const count = terminals.size;
  for (const [id, entry] of terminals) {
    clearTimeout(resizeTimers.get(id));
    try {
      entry.pty.kill();
    } catch {
      /* already dead */
    }
  }
  terminals.clear();
  resizeTimers.clear();
  log.info({ count }, 'all terminals killed');
}
