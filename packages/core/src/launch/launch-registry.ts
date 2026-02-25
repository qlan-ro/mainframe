import type { DaemonEvent } from '@mainframe/types';
import { LaunchManager } from './launch-manager.js';

export class LaunchRegistry {
  private managers = new Map<string, LaunchManager>();

  constructor(private onEvent: (event: DaemonEvent) => void) {}

  getOrCreate(projectId: string, projectPath: string): LaunchManager {
    let manager = this.managers.get(projectId);
    if (!manager) {
      manager = new LaunchManager(projectId, projectPath, this.onEvent);
      this.managers.set(projectId, manager);
    }
    return manager;
  }

  stopAll(): void {
    for (const manager of this.managers.values()) {
      manager.stopAll();
    }
    this.managers.clear();
  }
}
