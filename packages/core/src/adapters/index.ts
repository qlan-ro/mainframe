import type { Adapter, AdapterInfo, AdapterModel, DaemonEvent } from '@qlan-ro/mainframe-types';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  getAll(): Adapter[] {
    return [...this.adapters.values()];
  }

  killAll(): void {
    for (const adapter of this.adapters.values()) {
      adapter.killAll();
    }
  }

  async probeAllModels(emitEvent: (event: DaemonEvent) => void): Promise<void> {
    const probes = [...this.adapters.values()]
      .filter(
        (a): a is Adapter & { probeModels(): Promise<AdapterModel[] | null> } =>
          typeof (a as any).probeModels === 'function',
      )
      .map(async (adapter) => {
        const models = await adapter.probeModels();
        if (models) {
          emitEvent({ type: 'adapter.models.updated', adapterId: adapter.id, models });
        }
      });
    await Promise.allSettled(probes);
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
        capabilities: adapter.capabilities,
      });
    }
    return infos;
  }
}
