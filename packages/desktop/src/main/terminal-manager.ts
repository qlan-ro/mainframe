import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'crypto';
import pty from 'node-pty';
import type { IPty } from 'node-pty';
import { createMainLogger } from './logger.js';

const log = createMainLogger('terminal');

interface ManagedTerminal {
  pty: IPty;
  /** webContents.id that owns this terminal — used to route data events */
  webContentsId: number;
}

const terminals = new Map<string, ManagedTerminal>();

export function setupTerminalIPC(shellEnv: Record<string, string>): void {
  const defaultShell =
    process.platform === 'win32' ? 'powershell.exe' : shellEnv['SHELL'] || process.env.SHELL || '/bin/zsh';

  ipcMain.handle('terminal:create', (event: IpcMainInvokeEvent, options: { cwd: string }) => {
    const id = randomUUID();
    const cols = 80;
    const rows = 24;

    const term = pty.spawn(defaultShell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: options.cwd,
      env: { ...shellEnv, TERM_PROGRAM: 'Mainframe' },
    });

    const webContentsId = event.sender.id;
    terminals.set(id, { pty: term, webContentsId });

    term.onData((data: string) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('terminal:data', id, data);
        }
      } catch {
        /* webContents destroyed — terminal will be cleaned up on quit */
      }
    });

    term.onExit(({ exitCode }) => {
      try {
        if (!event.sender.isDestroyed()) {
          event.sender.send('terminal:exit', id, exitCode);
        }
      } catch {
        /* webContents destroyed */
      }
      terminals.delete(id);
    });

    log.info({ id, cwd: options.cwd, shell: defaultShell }, 'terminal created');
    return { id };
  });

  ipcMain.handle('terminal:write', (_event: IpcMainInvokeEvent, id: string, data: string) => {
    const entry = terminals.get(id);
    if (!entry) return;
    entry.pty.write(data);
  });

  ipcMain.handle('terminal:resize', (_event: IpcMainInvokeEvent, id: string, cols: number, rows: number) => {
    const entry = terminals.get(id);
    if (!entry) return;
    try {
      entry.pty.resize(cols, rows);
    } catch {
      /* resize can throw if process already exited */
    }
  });

  ipcMain.handle('terminal:kill', (_event: IpcMainInvokeEvent, id: string) => {
    const entry = terminals.get(id);
    if (!entry) return;
    try {
      entry.pty.kill();
    } catch {
      /* already dead */
    }
    terminals.delete(id);
    log.info({ id }, 'terminal killed');
  });
}

export function killAllTerminals(): void {
  const count = terminals.size;
  for (const [, entry] of terminals) {
    try {
      entry.pty.kill();
    } catch {
      /* already dead */
    }
  }
  terminals.clear();
  log.info({ count }, 'all terminals killed');
}
