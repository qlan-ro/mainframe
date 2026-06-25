/**
 * lib/tauri/terminal.ts
 *
 * Tauri bridge for the local PTY backend (src-tauri/src/terminal/mod.rs).
 * Sibling to bridge.ts so bridge.ts stays under 300 lines.
 *
 * Transport (design Path A, verified live in the encoding spike):
 *  - PTY output streams over a raw `Channel`; each message arrives as an
 *    ArrayBuffer and is wrapped as a Uint8Array (so a UTF-8 char split across
 *    two PTY reads stays intact — a typed Channel<{data:Vec<u8>}> would
 *    serialize to a JSON number[] and corrupt it).
 *  - Exit travels on a typed `Channel<ExitEvent>` (JSON is fine for one small payload).
 */
import { invoke, Channel } from '@tauri-apps/api/core';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface ExitEvent {
  code: number | null;
}

export interface TerminalHandle {
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
}

export interface CreateTerminalOpts {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalHandlers {
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number | null) => void;
}

export async function createTerminal(opts: CreateTerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle> {
  if (!isTauri()) {
    throw new Error('createTerminal requires the Tauri runtime (terminals need a real PTY)');
  }

  // Raw channel: messages arrive as ArrayBuffer.
  const dataChannel = new Channel<ArrayBuffer>();
  dataChannel.onmessage = (buf) => handlers.onData(new Uint8Array(buf));

  const exitChannel = new Channel<ExitEvent>();
  exitChannel.onmessage = (evt) => handlers.onExit(evt.code);

  await invoke('terminal_create', {
    id: opts.id,
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    onData: dataChannel,
    onExit: exitChannel,
  });

  return {
    write: (data) => invoke('terminal_write', { id: opts.id, data }),
    resize: (cols, rows) => invoke('terminal_resize', { id: opts.id, cols, rows }),
    kill: () => invoke('terminal_kill', { id: opts.id }),
  };
}
