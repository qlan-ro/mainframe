import { getHost } from '@/lib/host';
import { getOrCreate, disposeCachedTerminal } from './terminal-cache';

export interface CreateTerminalSessionOpts {
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalSession {
  id: string;
  title: string;
}

/**
 * Build the xterm + PTY for a new terminal and wire output both ways.
 * Knows nothing about the layout store. On PTY-create failure it disposes the
 * already-inserted cache entry so no orphan xterm remains, then re-throws.
 */
export async function createTerminalSession(opts: CreateTerminalSessionOpts): Promise<TerminalSession> {
  const id = `term-${crypto.randomUUID().slice(0, 8)}`;
  const cached = getOrCreate(id);

  // One decoder PER session, captured in this session's onData closure (M3).
  // A shared module-scope decoder with { stream: true } interleaves partial
  // multibyte state across terminals and corrupts split UTF-8 codepoints — the
  // exact bug the raw-Channel transport was chosen to prevent. Per-session
  // streaming state keeps each terminal's bytes independent.
  const decoder = new TextDecoder();

  try {
    const handle = await getHost().terminal.create(
      { id, cwd: opts.cwd, cols: opts.cols, rows: opts.rows },
      {
        onData: (bytes) => cached.term.write(decoder.decode(bytes, { stream: true })),
        onExit: () => cached.term.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n'),
      },
    );

    // Wire the xterm → PTY direction now that the handle exists. These
    // disposables tear down when the tab/pane is closed.
    const onData = cached.term.onData((data: string) => {
      void handle.write(data).catch((e) => console.warn('[terminal] write failed', e));
    });
    const onResize = cached.term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      void handle.resize(cols, rows).catch((e) => console.warn('[terminal] resize failed', e));
    });

    // Wrap async PTY teardowns as void-returning disposers so the disposers
    // array stays () => void and fire-and-forget rejections are logged, not swallowed.
    cached.disposers.push(
      () => onData.dispose(),
      () => onResize.dispose(),
      () => {
        void handle.kill().catch((e) => console.warn('[terminal] kill failed', e));
      },
    );

    return { id, title: 'Terminal' };
  } catch (err) {
    disposeCachedTerminal(id);
    throw err;
  }
}
