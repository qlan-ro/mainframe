import { describe, it, expect } from 'vitest';
import { FakeHostBridge } from '../fake-adapter';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';

const meta: DaemonMeta = {
  id: 'daemon-1',
  kind: 'remote',
  label: 'My Remote',
  host: '192.168.1.10:31415',
};

describe('FakeHostBridge — daemons namespace', () => {
  it('list returns empty array initially', async () => {
    const host = new FakeHostBridge();
    await expect(host.daemons.list()).resolves.toEqual([]);
  });

  it('upsert then list returns the upserted meta', async () => {
    const host = new FakeHostBridge();
    await host.daemons.upsert(meta);
    await expect(host.daemons.list()).resolves.toEqual([meta]);
  });

  it('upsert overwrites an existing entry with the same id', async () => {
    const host = new FakeHostBridge();
    await host.daemons.upsert(meta);
    const updated: DaemonMeta = { ...meta, label: 'Updated Label' };
    await host.daemons.upsert(updated);
    const result = await host.daemons.list();
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(updated);
  });

  it('setToken then getToken round-trips in memory', async () => {
    const host = new FakeHostBridge();
    await host.daemons.setToken('daemon-1', 'secret-jwt');
    await expect(host.daemons.getToken('daemon-1')).resolves.toBe('secret-jwt');
  });

  it('getToken returns null for an unknown id', async () => {
    const host = new FakeHostBridge();
    await expect(host.daemons.getToken('no-such-id')).resolves.toBeNull();
  });

  it('remove drops the metadata', async () => {
    const host = new FakeHostBridge();
    await host.daemons.upsert(meta);
    await host.daemons.remove(meta.id);
    await expect(host.daemons.list()).resolves.toEqual([]);
  });

  it('remove drops the token', async () => {
    const host = new FakeHostBridge();
    await host.daemons.upsert(meta);
    await host.daemons.setToken(meta.id, 'tok');
    await host.daemons.remove(meta.id);
    await expect(host.daemons.getToken(meta.id)).resolves.toBeNull();
  });

  it('each FakeHostBridge instance has isolated storage', async () => {
    const a = new FakeHostBridge();
    const b = new FakeHostBridge();
    await a.daemons.upsert(meta);
    await expect(b.daemons.list()).resolves.toEqual([]);
  });
});
