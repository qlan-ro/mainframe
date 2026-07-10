import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileChildRegistry, NoopChildRegistry } from '../../process/child-registry.js';
import type { ManagedChildEntry } from '../../process/child-registry.js';

function tunnelEntry(pid: number, label = `preview:${pid}`): ManagedChildEntry {
  return {
    pid,
    kind: 'tunnel',
    command: '/home/user/.mainframe/bin/bin/cloudflared',
    args: [],
    cwd: null,
    group: false,
    label,
    spawnedAt: 1_000,
  };
}

function launchEntry(pid: number, name = `dev-${pid}`): ManagedChildEntry {
  return {
    pid,
    kind: 'launch',
    command: '/opt/homebrew/bin/pnpm',
    args: ['run', 'dev'],
    cwd: '/Users/me/project',
    group: true,
    label: `proj:${name}`,
    spawnedAt: 2_000,
  };
}

describe('FileChildRegistry', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'child-registry-'));
    file = join(dir, 'managed-children.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('list returns [] when the file does not exist', async () => {
    const registry = new FileChildRegistry(file);
    expect(await registry.list()).toEqual([]);
  });

  it('persists entries of both kinds across instances', async () => {
    const registry = new FileChildRegistry(file);
    await registry.add(tunnelEntry(111));
    await registry.add(launchEntry(222));
    const reopened = new FileChildRegistry(file);
    expect(await reopened.list()).toEqual([tunnelEntry(111), launchEntry(222)]);
  });

  it('listByKind filters by kind', async () => {
    const registry = new FileChildRegistry(file);
    await registry.add(tunnelEntry(111));
    await registry.add(launchEntry(222));
    expect(await registry.listByKind('launch')).toEqual([launchEntry(222)]);
    expect(await registry.listByKind('tunnel')).toEqual([tunnelEntry(111)]);
  });

  it('remove drops only the matching pid', async () => {
    const registry = new FileChildRegistry(file);
    await registry.add(tunnelEntry(111));
    await registry.add(launchEntry(222));
    await registry.remove(111);
    expect(await registry.list()).toEqual([launchEntry(222)]);
  });

  it('replaces an existing entry with the same pid rather than duplicating', async () => {
    const registry = new FileChildRegistry(file);
    await registry.add(launchEntry(111, 'first'));
    await registry.add(launchEntry(111, 'second'));
    const list = await registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe('proj:second');
  });

  it('clear empties the registry', async () => {
    const registry = new FileChildRegistry(file);
    await registry.add(tunnelEntry(111));
    await registry.clear();
    expect(await registry.list()).toEqual([]);
  });

  it('does not lose entries under concurrent adds', async () => {
    const registry = new FileChildRegistry(file);
    await Promise.all([1, 2, 3, 4, 5].map((pid) => registry.add(launchEntry(pid))));
    const pids = (await registry.list()).map((e) => e.pid).sort((a, b) => a - b);
    expect(pids).toEqual([1, 2, 3, 4, 5]);
  });

  it('tolerates a corrupt registry file and treats it as empty', async () => {
    await writeFile(file, 'not json{{{', 'utf-8');
    const registry = new FileChildRegistry(file);
    expect(await registry.list()).toEqual([]);
    await registry.add(tunnelEntry(111));
    expect(await registry.list()).toEqual([tunnelEntry(111)]);
  });

  it('tolerates a stale old-format cloudflared registry file (ignores foreign entries)', async () => {
    // The pre-generalization format was { pid, label, binPath, spawnedAt } — no
    // kind/command/args/cwd/group. Such entries must be dropped, not crash.
    await writeFile(
      file,
      JSON.stringify([{ pid: 999, label: 'daemon', binPath: '/x/cloudflared', spawnedAt: 1 }, launchEntry(5)]),
      'utf-8',
    );
    const registry = new FileChildRegistry(file);
    expect(await registry.list()).toEqual([launchEntry(5)]);
  });

  it('drops malformed entries when reading', async () => {
    await writeFile(file, JSON.stringify([tunnelEntry(111), { pid: 'nope' }, { kind: 'launch' }, null]), 'utf-8');
    const registry = new FileChildRegistry(file);
    expect(await registry.list()).toEqual([tunnelEntry(111)]);
  });

  it('writes atomically without leaving a .tmp file behind', async () => {
    const registry = new FileChildRegistry(file);
    await registry.add(tunnelEntry(111));
    const contents = await readFile(file, 'utf-8');
    expect(JSON.parse(contents)).toEqual([tunnelEntry(111)]);
  });
});

describe('NoopChildRegistry', () => {
  it('is inert', async () => {
    const registry = new NoopChildRegistry();
    await registry.add(tunnelEntry(1));
    await registry.remove(1);
    await registry.clear();
    expect(await registry.list()).toEqual([]);
    expect(await registry.listByKind('launch')).toEqual([]);
  });
});
