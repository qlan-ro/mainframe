import type { Adapter, AdapterInfo } from '@mainframe/types';
import { ClaudeAdapter } from './claude.js';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  constructor() {
    this.register(new ClaudeAdapter());
  }

  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  all(): Adapter[] {
    return [...this.adapters.values()];
  }

  async list(): Promise<AdapterInfo[]> {
    const infos: AdapterInfo[] = [];
    for (const adapter of this.adapters.values()) {
      const installed = await adapter.isInstalled();
      const version = installed ? await adapter.getVersion() : undefined;
      const models = await adapter.listModels();
      infos.push({
        id: adapter.id,
        name: adapter.name,
        description: `${adapter.name} adapter`,
        installed,
        version: version || undefined,
        models,
      });
    }
    return infos;
  }
}

export { ClaudeAdapter } from './claude.js';
export { BaseAdapter } from './base.js';
