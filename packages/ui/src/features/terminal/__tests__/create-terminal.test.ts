// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import type { TerminalHandle } from '@qlan-ro/mainframe-types';

// A per-id term factory so two concurrent sessions get INDEPENDENT terms. Each
// term records every string it was written, so the interleave test can read
// back exactly what each terminal received.
interface FakeTerm {
  writes: string[];
  write: (s: string) => void;
  onData: ReturnType<typeof vi.fn>;
  onResize: ReturnType<typeof vi.fn>;
}
const terms = new Map<string, FakeTerm>();
function makeTerm(): FakeTerm {
  const writes: string[] = [];
  return {
    writes,
    write: (s: string) => writes.push(s),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onResize: vi.fn(() => ({ dispose: vi.fn() })),
  };
}
const getOrCreateSpy = vi.fn((id: string) => {
  const term = makeTerm();
  terms.set(id, term);
  return { wrapper: document.createElement('div'), term, fitAddon: {}, disposers: [] as Array<() => void> };
});
const disposeSpy = vi.fn();

vi.mock('../terminal-cache', () => ({
  getOrCreate: (...a: unknown[]) => getOrCreateSpy(...(a as [string])),
  disposeCachedTerminal: (...a: unknown[]) => disposeSpy(...a),
}));

import { createTerminalSession } from '../create-terminal';

describe('createTerminalSession', () => {
  let createTerminalSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    terms.clear();
    const fake = new FakeHostBridge();
    createTerminalSpy = vi.fn().mockResolvedValue({ write: vi.fn(), resize: vi.fn(), kill: vi.fn() });
    fake.terminal.create = createTerminalSpy as unknown as () => Promise<TerminalHandle>;
    setHostForTesting(fake);
  });

  afterEach(() => {
    resetHostForTesting();
  });

  it('returns an id and a title and creates the xterm + PTY', async () => {
    const result = await createTerminalSession({ cwd: '/wd', cols: 80, rows: 24 });
    expect(typeof result.id).toBe('string');
    expect(result.title).toBe('Terminal');
    expect(getOrCreateSpy).toHaveBeenCalledWith(result.id);
    expect(createTerminalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: result.id, cwd: '/wd', cols: 80, rows: 24 }),
      expect.objectContaining({ onData: expect.any(Function), onExit: expect.any(Function) }),
    );
  });

  it('routes PTY output into the cached term via onData', async () => {
    const { id } = await createTerminalSession({ cwd: '/wd', cols: 80, rows: 24 });
    const handlers = createTerminalSpy.mock.calls[0]![1] as { onData: (b: Uint8Array) => void };
    handlers.onData(new Uint8Array([72, 105])); // "Hi"
    expect(terms.get(id)!.writes.join('')).toContain('Hi');
  });

  it('writes a [process exited] notice on exit', async () => {
    const { id } = await createTerminalSession({ cwd: '/wd', cols: 80, rows: 24 });
    const handlers = createTerminalSpy.mock.calls[0]![1] as { onExit: (c: number | null) => void };
    handlers.onExit(0);
    expect(terms.get(id)!.writes.join('')).toContain('[process exited]');
  });

  it('disposes the cache entry and re-throws when terminal.create rejects', async () => {
    createTerminalSpy.mockRejectedValueOnce(new Error('boom'));
    await expect(createTerminalSession({ cwd: '/wd', cols: 80, rows: 24 })).rejects.toThrow('boom');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  // M3: two concurrent sessions must NOT share TextDecoder streaming state. We
  // split a 3-byte UTF-8 codepoint (€ = E2 82 AC) across two onData chunks on
  // session A, and INTERLEAVE a chunk for session B in between. With a shared
  // module-scope decoder, B's bytes would consume A's partial state and both
  // outputs would corrupt. With a per-session decoder, A reassembles "€" and B
  // is unaffected.
  it('keeps interleaved multibyte output independent across two sessions', async () => {
    const a = await createTerminalSession({ cwd: '/wd', cols: 80, rows: 24 });
    const b = await createTerminalSession({ cwd: '/wd', cols: 80, rows: 24 });
    const handlersA = createTerminalSpy.mock.calls[0]![1] as { onData: (b: Uint8Array) => void };
    const handlersB = createTerminalSpy.mock.calls[1]![1] as { onData: (b: Uint8Array) => void };

    handlersA.onData(new Uint8Array([0xe2, 0x82])); // first 2 bytes of "€"
    handlersB.onData(new Uint8Array([0x41])); // "A" on the other session, in between
    handlersA.onData(new Uint8Array([0xac])); // final byte of "€"

    expect(terms.get(a.id)!.writes.join('')).toBe('€');
    expect(terms.get(b.id)!.writes.join('')).toBe('A');
  });
});
