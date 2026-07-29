/**
 * tunnel-claim — the URL tab's ownership state machine (#281, D10/AC12).
 *
 * A claim is this tab's evidence that the daemon currently holds a tunnel, on
 * this daemon, on this port, that this tab caused to exist. It is the only
 * input to `started` in the consumer registry, and `started` is the only thing
 * that lets a release stop a tunnel — so every row below is a rule about when
 * closing a tab may kill cloudflared.
 *
 * There is deliberately **no watchdog case**: `ClaimSignal` carries no timeout
 * member, which is how the 120 s watchdog (a client timer the spec calls
 * non-terminal, D11/AC9) is kept from revoking a live claim. Do not add one.
 */
import { describe, it, expect } from 'vitest';
import { claimOwns, claimReducer, entryDaemonState, type ClaimSignal, type TunnelClaim } from '../tunnel-claim';
import type { PortTunnelEntry } from '../../../store/port-tunnels';

const HTTP = 31415;
const PORT = 5173;

const claim = (overrides: Partial<TunnelClaim> = {}): TunnelClaim => ({
  httpPort: HTTP,
  port: PORT,
  attempt: 0,
  sawEntry: false,
  ...overrides,
});

const issued = (overrides: Partial<Extract<ClaimSignal, { type: 'start-issued' }>> = {}): ClaimSignal => ({
  type: 'start-issued',
  httpPort: HTTP,
  port: PORT,
  attempt: 0,
  entryExisted: false,
  ...overrides,
});

const daemonState = (state: ReturnType<typeof entryDaemonState>, port = PORT, httpPort = HTTP): ClaimSignal => ({
  type: 'daemon-state',
  httpPort,
  port,
  state,
});

describe('entryDaemonState', () => {
  it('reads no entry as an absent tunnel', () => {
    expect(entryDaemonState(undefined)).toBe('absent');
  });

  it('reads a live entry as its own state', () => {
    expect(entryDaemonState({ state: 'starting' })).toBe('starting');
    expect(entryDaemonState({ state: 'ready', url: 'https://a.trycloudflare.com' })).toBe('ready');
  });

  it('reads an unmarked error as daemon truth: the daemon holds nothing', () => {
    expect(entryDaemonState({ state: 'error', error: 'cloudflared exited' })).toBe('error');
  });

  it('reads a client-written error as unknown — a chip’s rejected start POST is not daemon truth', () => {
    const entry: PortTunnelEntry = { state: 'error', error: 'fetch failed', errorOrigin: 'client' };
    expect(entryDaemonState(entry)).toBe('unknown');
  });
});

describe('claimReducer — rebind', () => {
  const rebind = (port: number | null, httpPort = HTTP): ClaimSignal => ({ type: 'rebind', httpPort, port });

  it('keeps a claim rebound to the same daemon and port', () => {
    const c = claim({ sawEntry: true });
    expect(claimReducer(c, rebind(PORT))).toBe(c);
  });

  it('drops a claim when the tab retargets to another port', () => {
    expect(claimReducer(claim({ sawEntry: true }), rebind(4000))).toBeNull();
  });

  it('drops a claim when the tab stops classifying as tunnellable at all', () => {
    expect(claimReducer(claim(), rebind(null))).toBeNull();
  });

  it('drops a claim made against another daemon', () => {
    expect(claimReducer(claim(), rebind(PORT, 31500))).toBeNull();
  });

  it('is a no-op with no claim', () => {
    expect(claimReducer(null, rebind(PORT))).toBeNull();
  });
});

describe('claimReducer — start-issued', () => {
  it('claims the port when the store showed no entry as the POST went out', () => {
    expect(claimReducer(null, issued())).toEqual(claim());
  });

  it('claims nothing when an entry already existed — this tab joined, it did not create', () => {
    expect(claimReducer(null, issued({ entryExisted: true }))).toBeNull();
  });

  it('keeps an owner across Retry and rebinds the attempt (D10)', () => {
    const c = claim({ sawEntry: true });
    expect(claimReducer(c, issued({ attempt: 1, entryExisted: true }))).toEqual({ ...c, attempt: 1 });
  });

  it('an owner retrying against an empty store keeps the claim with sawEntry reset', () => {
    const c = claim({ sawEntry: true });
    expect(claimReducer(c, issued({ attempt: 1 }))).toEqual({ ...c, attempt: 1, sawEntry: false });
  });

  it.each([false, true])(
    'never transfers a stale other-port claim onto the new port (entryExisted: %s)',
    (entryExisted) => {
      expect(claimReducer(claim(), issued({ port: 4000, entryExisted }))).toBeNull();
    },
  );

  it('never transfers a claim made against another daemon', () => {
    expect(claimReducer(claim(), issued({ httpPort: 31500 }))).toBeNull();
  });
});

describe('claimReducer — start-rejected', () => {
  const rejected = (attempt: number, port = PORT, httpPort = HTTP): ClaimSignal => ({
    type: 'start-rejected',
    httpPort,
    port,
    attempt,
  });

  it('revokes the claim its own attempt made', () => {
    expect(claimReducer(claim({ sawEntry: true }), rejected(0))).toBeNull();
  });

  it('leaves a later attempt’s claim alone', () => {
    const c = claim({ attempt: 1, sawEntry: true });
    expect(claimReducer(c, rejected(0))).toBe(c);
  });

  it('a hung attempt-0 POST that rejects after attempt 1 succeeded never revokes attempt 1', () => {
    let c = claimReducer(null, issued({ attempt: 0 }));
    c = claimReducer(c, { type: 'local-clear', httpPort: HTTP, port: PORT });
    c = claimReducer(c, issued({ attempt: 1 }));
    c = claimReducer(c, daemonState('ready'));
    expect(claimReducer(c, rejected(0))).toEqual(claim({ attempt: 1, sawEntry: true }));
  });

  it('ignores a rejection for another port or another daemon', () => {
    const c = claim();
    expect(claimReducer(c, rejected(0, 4000))).toBe(c);
    expect(claimReducer(c, rejected(0, PORT, 31500))).toBe(c);
  });
});

describe('claimReducer — daemon-state', () => {
  it.each(['starting', 'ready'] as const)('records that the daemon holds a tunnel (%s)', (state) => {
    expect(claimReducer(claim(), daemonState(state))).toEqual(claim({ sawEntry: true }));
  });

  it('does not churn the claim once the entry has been seen', () => {
    const c = claim({ sawEntry: true });
    expect(claimReducer(c, daemonState('ready'))).toBe(c);
  });

  it('revokes on a daemon-sourced error — the daemon holds no live tunnel', () => {
    expect(claimReducer(claim({ sawEntry: true }), daemonState('error'))).toBeNull();
  });

  it('revokes when a tunnel this claim watched disappears', () => {
    expect(claimReducer(claim({ sawEntry: true }), daemonState('absent'))).toBeNull();
  });

  it('keeps a claim whose start is still in flight — no entry yet is not a gone entry', () => {
    const c = claim();
    expect(claimReducer(c, daemonState('absent'))).toBe(c);
  });

  it.each([true, false])('an unknown entry moves nothing (sawEntry: %s)', (sawEntry) => {
    const c = claim({ sawEntry });
    expect(claimReducer(c, daemonState('unknown'))).toBe(c);
  });

  it('ignores state on another port or another daemon', () => {
    const c = claim({ sawEntry: true });
    expect(claimReducer(c, daemonState('error', 4000))).toBe(c);
    expect(claimReducer(c, daemonState('error', PORT, 31500))).toBe(c);
  });

  it('is a no-op with no claim', () => {
    expect(claimReducer(null, daemonState('ready'))).toBeNull();
  });
});

describe('claimReducer — local-clear', () => {
  const localClear = (port = PORT, httpPort = HTTP): ClaimSignal => ({ type: 'local-clear', httpPort, port });

  it('keeps the claim but forgets the entry a Retry just cleared', () => {
    expect(claimReducer(claim({ sawEntry: true }), localClear())).toEqual(claim({ sawEntry: false }));
  });

  it('so the absent entry that follows a Retry does not revoke the claim', () => {
    const cleared = claimReducer(claim({ sawEntry: true }), localClear());
    expect(claimReducer(cleared, daemonState('absent'))).toEqual(claim({ sawEntry: false }));
  });

  it('does not churn a claim that has seen no entry', () => {
    const c = claim();
    expect(claimReducer(c, localClear())).toBe(c);
  });

  it('ignores a clear on another port or another daemon', () => {
    const c = claim({ sawEntry: true });
    expect(claimReducer(c, localClear(4000))).toBe(c);
    expect(claimReducer(c, localClear(PORT, 31500))).toBe(c);
  });
});

describe('claimReducer — signals for a port this claim does not name', () => {
  const foreign: ClaimSignal[] = [
    issued({ port: 4000, entryExisted: true }),
    { type: 'start-rejected', httpPort: HTTP, port: 4000, attempt: 0 },
    daemonState('error', 4000),
    daemonState('absent', 4000),
    { type: 'local-clear', httpPort: HTTP, port: 4000 },
  ];

  it.each(foreign.map((s) => [s.type, s] as const))('%s leaves the claim untouched by reference', (_type, signal) => {
    const c = claim({ sawEntry: true });
    // start-issued is the one signal that reacts to a mismatch, by dropping.
    const expected = signal.type === 'start-issued' ? null : c;
    expect(claimReducer(c, signal)).toBe(expected);
  });
});

describe('claimOwns', () => {
  it('owns nothing without a claim', () => {
    expect(claimOwns(null, HTTP, PORT)).toBe(false);
  });

  it('owns only the exact daemon-and-port pair it named', () => {
    const c = claim({ sawEntry: true });
    expect(claimOwns(c, HTTP, PORT)).toBe(true);
    expect(claimOwns(c, HTTP, 4000)).toBe(false);
    expect(claimOwns(c, 31500, PORT)).toBe(false);
    expect(claimOwns(c, HTTP, null)).toBe(false);
  });
});
