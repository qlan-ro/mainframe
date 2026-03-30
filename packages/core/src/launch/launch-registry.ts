import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { TunnelManager } from '../tunnel/index.js';
import { LaunchManager } from './launch-manager.js';

export class LaunchRegistry {
  private managers = new Map<string, LaunchManager>();

  constructor(
    private onEvent: (event: DaemonEvent) => void,
    public tunnelManager?: TunnelManager,
  ) {}

  get(projectId: string, projectPath: string): LaunchManager | undefined {
    return this.managers.get(`${projectId}:${projectPath}`);
  }

  getOrCreate(projectId: string, projectPath: string): LaunchManager {
    const key = `${projectId}:${projectPath}`;
    let manager = this.managers.get(key);
    if (!manager) {
      manager = new LaunchManager(projectId, projectPath, this.onEvent, this.tunnelManager);
      this.managers.set(key, manager);
    }
    return manager;
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled(Array.from(this.managers.values()).map((manager) => manager.stopAll()));
    this.managers.clear();
  }
}
