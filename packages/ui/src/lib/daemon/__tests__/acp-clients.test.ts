/**
 * acp-clients registry — behavior tests (todo #350 plan review fixes, T26, R1.1).
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { getAcpFacadeClient, resetAcpFacadeClients } from '../acp-clients';
import { setActiveDaemon } from '../active-daemon';

function daemonTarget(id: string) {
  return { id, kind: 'local' as const, label: id, baseUrl: `http://127.0.0.1:${id}`, token: null };
}

beforeEach(() => {
  resetAcpFacadeClients();
  setActiveDaemon(daemonTarget('A'));
});

describe('getAcpFacadeClient — keyed by active daemon', () => {
  it('resolves the same instance for repeat calls against the same daemon', () => {
    expect(getAcpFacadeClient('claude')).toBe(getAcpFacadeClient('claude'));
  });

  it('resolves a different instance after the active daemon changes, without disconnecting the old one', () => {
    const first = getAcpFacadeClient('claude');

    setActiveDaemon(daemonTarget('B'));
    const second = getAcpFacadeClient('claude');

    expect(second).not.toBe(first);
  });

  it("switching back to a prior daemon reuses that daemon's own cached client", () => {
    const onA = getAcpFacadeClient('claude');
    setActiveDaemon(daemonTarget('B'));
    getAcpFacadeClient('claude');
    setActiveDaemon(daemonTarget('A'));

    expect(getAcpFacadeClient('claude')).toBe(onA);
  });
});
