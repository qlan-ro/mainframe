import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchManager } from '../launch-manager.js';
import { FileChildRegistry, sweepStrayChildren, defaultSweepDeps } from '../../process/index.js';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';

/** True while `pid` is a live process this test can signal. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * End-to-end proof (no mocks) that the sweep actually reaps a launch orphan. The
 * child is a `#!` shell script, so the kernel rewrites its argv — the exact case
 * a bare-executable identity guard silently fails to match, leaking the tree.
 */
describe('launch orphan reaping (integration)', () => {
  it('records a #! child by its live command line so the real sweep reaps its group', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'launch-reap-'));
    const script = join(dir, 'sleeper.sh');
    await writeFile(script, '#!/bin/sh\nsleep 30\n');
    await chmod(script, 0o755);

    const registry = new FileChildRegistry(join(dir, 'children.json'));
    const manager = new LaunchManager('proj-1', dir, () => {}, undefined, registry);
    const config: LaunchConfiguration = {
      name: 'dev',
      runtimeExecutable: './sleeper.sh',
      runtimeArgs: [],
      port: null,
      url: null,
    };

    let pid = -1;
    try {
      await manager.start(config);

      const recorded = await registry.list();
      expect(recorded).toHaveLength(1);
      pid = recorded[0]!.pid;
      expect(isAlive(pid)).toBe(true);

      const result = await sweepStrayChildren(registry, { ...defaultSweepDeps, graceMs: 500 });
      expect(result.reaped).toBe(1);

      // Poll briefly: SIGTERM delivery is async, the process exits shortly after.
      for (let i = 0; i < 40 && isAlive(pid); i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(isAlive(pid)).toBe(false);
      expect(await registry.list()).toHaveLength(0);
    } finally {
      if (pid > 0) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
