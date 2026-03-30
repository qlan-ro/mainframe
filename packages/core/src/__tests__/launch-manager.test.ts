import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LaunchManager } from '../launch/launch-manager.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';

const ECHO_CONFIG = {
  version: '0.0.1',
  configurations: [
    {
      name: 'server',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'process.stdout.write("hello"); process.exit(0);'],
      port: 3000,
      url: null,
      preview: true,
    },
  ],
};

describe('LaunchManager', () => {
  let events: DaemonEvent[];
  let manager: LaunchManager;

  beforeEach(() => {
    events = [];
    manager = new LaunchManager('proj-1', '/tmp', (e) => events.push(e));
  });

  afterEach(() => {
    manager.stopAll();
  });

  it('starts a process and emits status running', async () => {
    await manager.start(ECHO_CONFIG.configurations[0]!);
    const statusEvents = events.filter((e) => e.type === 'launch.status') as Array<{
      type: 'launch.status';
      status: string;
    }>;
    expect(statusEvents.some((e) => e.status === 'starting' || e.status === 'running')).toBe(true);
  });

  it('emits output events from stdout', async () => {
    await manager.start(ECHO_CONFIG.configurations[0]!);
    // Give the process time to write stdout
    await new Promise((r) => setTimeout(r, 200));
    const outputEvents = events.filter((e) => e.type === 'launch.output') as Array<{
      type: 'launch.output';
      data: string;
      stream: string;
    }>;
    expect(outputEvents.some((e) => e.data.includes('hello'))).toBe(true);
  });

  it('stop emits status stopped', async () => {
    // Use a long-running process (port: null to skip port polling)
    const config = {
      name: 'server',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'setInterval(() => {}, 10000);'],
      port: null,
      url: null,
      preview: false,
    };
    await manager.start(config);
    manager.stop('server');
    await new Promise((r) => setTimeout(r, 100));
    const statusEvents = events
      .filter((e) => e.type === 'launch.status')
      .map((e) => (e as { type: 'launch.status'; status: string }).status);
    expect(statusEvents).toContain('stopped');
  });

  it('getStatus returns stopped for unknown name', () => {
    expect(manager.getStatus('nonexistent')).toBe('stopped');
  });

  it('getStatus returns running while process is alive', async () => {
    const config = {
      name: 'server',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'setInterval(() => {}, 10000);'],
      port: null,
      url: null,
      preview: false,
    };
    await manager.start(config);
    expect(manager.getStatus('server')).toBe('running');
    manager.stop('server');
  });

  it('emits effectivePath in launch.status events', async () => {
    const config = {
      name: 'ep-test',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'process.exit(0);'],
      port: null,
      url: null,
      preview: false,
    };
    await manager.start(config);
    await new Promise((r) => setTimeout(r, 200));
    const statusEvents = events.filter((e) => e.type === 'launch.status') as Array<
      Extract<DaemonEvent, { type: 'launch.status' }>
    >;
    expect(statusEvents.length).toBeGreaterThan(0);
    for (const e of statusEvents) {
      expect(e.effectivePath).toBe('/tmp');
    }
  });

  it('emits effectivePath in launch.output events', async () => {
    const config = {
      name: 'ep-out',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'process.stdout.write("hi");process.exit(0);'],
      port: null,
      url: null,
      preview: false,
    };
    await manager.start(config);
    await new Promise((r) => setTimeout(r, 200));
    const outputEvents = events.filter((e) => e.type === 'launch.output') as Array<
      Extract<DaemonEvent, { type: 'launch.output' }>
    >;
    expect(outputEvents.length).toBeGreaterThan(0);
    for (const e of outputEvents) {
      expect(e.effectivePath).toBe('/tmp');
    }
  });

  it('passes env vars to the spawned process', async () => {
    const config = {
      name: 'env-test',
      runtimeExecutable: 'node',
      runtimeArgs: ['-e', 'process.stdout.write(process.env.MY_VAR ?? "missing");process.exit(0);'],
      port: null,
      url: null,
      preview: false,
      env: { MY_VAR: 'hello-from-env' },
    };
    await manager.start(config);
    await new Promise((r) => setTimeout(r, 200));
    const outputEvents = events.filter((e) => e.type === 'launch.output') as Array<{
      type: 'launch.output';
      data: string;
      stream: string;
    }>;
    expect(outputEvents.some((e) => e.data.includes('hello-from-env'))).toBe(true);
  });
});
