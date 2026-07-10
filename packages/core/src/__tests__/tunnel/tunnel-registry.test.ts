import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTunnelRegistry, NoopTunnelRegistry } from '../../tunnel/tunnel-registry.js';
import type { TunnelRegistryEntry } from '../../tunnel/tunnel-registry.js';

function entry(pid: number, label = `preview:${pid}`): TunnelRegistryEntry {
  return { pid, label, binPath: '/home/user/.mainframe/bin/bin/cloudflared', spawnedAt: 1_000 };
}

describe('FileTunnelRegistry', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tunnel-registry-'));
    file = join(dir, 'cloudflared-tunnels.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('list returns [] when the file does not exist', async () => {
    const registry = new FileTunnelRegistry(file);
    expect(await registry.list()).toEqual([]);
  });

  it('persists an added entry across instances', async () => {
    const registry = new FileTunnelRegistry(file);
    await registry.add(entry(111));
    const reopened = new FileTunnelRegistry(file);
    expect(await reopened.list()).toEqual([entry(111)]);
  });

  it('remove drops only the matching pid', async () => {
    const registry = new FileTunnelRegistry(file);
    await registry.add(entry(111));
    await registry.add(entry(222));
    await registry.remove(111);
    expect(await registry.list()).toEqual([entry(222)]);
  });

  it('replaces an existing entry with the same pid rather than duplicating', async () => {
    const registry = new FileTunnelRegistry(file);
    await registry.add(entry(111, 'daemon'));
    await registry.add(entry(111, 'daemon-again'));
    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe('daemon-again');
  });

  it('clear empties the registry', async () => {
    const registry = new FileTunnelRegistry(file);
    await registry.add(entry(111));
    await registry.clear();
    expect(await registry.list()).toEqual([]);
  });

  it('does not lose entries under concurrent adds', async () => {
    const registry = new FileTunnelRegistry(file);
    await Promise.all([1, 2, 3, 4, 5].map((pid) => registry.add(entry(pid))));
    const pids = (await registry.list()).map((e) => e.pid).sort((a, b) => a - b);
    expect(pids).toEqual([1, 2, 3, 4, 5]);
  });

  it('tolerates a corrupt registry file and treats it as empty', async () => {
    await writeFile(file, 'not json{{{', 'utf-8');
    const registry = new FileTunnelRegistry(file);
    expect(await registry.list()).toEqual([]);
    await registry.add(entry(111));
    expect(await registry.list()).toEqual([entry(111)]);
  });

  it('drops malformed entries when reading', async () => {
    await writeFile(file, JSON.stringify([entry(111), { pid: 'nope' }, { label: 'x' }, null]), 'utf-8');
    const registry = new FileTunnelRegistry(file);
    expect(await registry.list()).toEqual([entry(111)]);
  });

  it('writes atomically without leaving a .tmp file behind', async () => {
    const registry = new FileTunnelRegistry(file);
    await registry.add(entry(111));
    const contents = await readFile(file, 'utf-8');
    expect(JSON.parse(contents)).toEqual([entry(111)]);
  });
});

describe('NoopTunnelRegistry', () => {
  it('is inert', async () => {
    const registry = new NoopTunnelRegistry();
    await registry.add(entry(1));
    await registry.remove(1);
    await registry.clear();
    expect(await registry.list()).toEqual([]);
  });
});
