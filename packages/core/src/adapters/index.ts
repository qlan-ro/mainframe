import type { Adapter, AdapterInfo, AdapterModel, DaemonEvent } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('adapter-registry');
const REFRESH_LIST_CAP_MS = 2_000;

interface RunResult {
  ok: boolean;
  stdout: string;
}
interface RefreshDeps {
  resolveExecutablePath(adapterId: string): Promise<string | undefined>;
  run(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<RunResult>;
  emitEvent(event: DaemonEvent): void;
}

function parseVersion(stdout: string): string | undefined {
  return stdout.match(/(\d+\.\d+\.\d+)/)?.[1];
}

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();
  private snapshots = new Map<string, AdapterInfo>();
  private deps: RefreshDeps | null = null;
  private refreshAllowed = false;
  private inFlight = new Map<string, Promise<void>>(); // per-adapter single-flight
  private succeeded = new Set<string>(); // per-adapter success latch

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
    for (const a of this.adapters.values()) a.killAll();
  }

  configureRefresh(deps: RefreshDeps): void {
    this.deps = deps;
  }
  allowRefresh(): void {
    this.refreshAllowed = true;
  }

  /** STATIC-ONLY seed: no CLI spawn. Safe to call before server.start(). */
  seedStaticSnapshots(): void {
    for (const adapter of this.adapters.values()) {
      this.snapshots.set(adapter.id, {
        id: adapter.id,
        name: adapter.name,
        description: `${adapter.name} adapter`,
        installed: false, // enriched post-backfill; never frozen — refreshAll always runs after backfill
        version: undefined,
        models: adapter.getFallbackModels?.() ?? [],
        modelsRevision: 1,
        catalogSource: 'fallback',
        capabilities: adapter.capabilities,
      });
    }
  }

  getSnapshots(): AdapterInfo[] {
    return [...this.snapshots.values()];
  }

  async list(): Promise<AdapterInfo[]> {
    if (this.refreshAllowed) {
      const p = this.refreshAll();
      await Promise.race([p, new Promise<void>((r) => setTimeout(r, REFRESH_LIST_CAP_MS).unref())]);
    }
    return this.getSnapshots();
  }

  /** Per-adapter, parallel, single-flight. Idempotent — safe to call repeatedly. */
  refreshAll(): Promise<void> {
    return Promise.allSettled(this.getAll().map((a) => this.refreshAdapter(a.id))).then((results) => {
      // Log rejections outside each adapter's own try/catch (no silent catches).
      for (const r of results) if (r.status === 'rejected') log.warn({ err: r.reason }, 'adapter refresh rejected');
    });
  }

  private refreshAdapter(adapterId: string): Promise<void> {
    if (!this.refreshAllowed || this.succeeded.has(adapterId)) return Promise.resolve();
    const existing = this.inFlight.get(adapterId);
    if (existing) return existing;
    const p = this.runRefresh(adapterId).finally(() => this.inFlight.delete(adapterId));
    this.inFlight.set(adapterId, p);
    return p;
  }

  private async runRefresh(adapterId: string): Promise<void> {
    const adapter = this.adapters.get(adapterId);
    const deps = this.deps;
    if (!adapter || !deps) return;
    const exePath = await deps.resolveExecutablePath(adapterId);
    // One --version spawn covers installed AND version (blocker #6: collapse the double spawn, use the resolved path).
    const ver = await deps.run(exePath ?? adapter.id, ['--version'], { timeoutMs: 5_000 });
    let installed = ver.ok;
    let version = ver.ok ? parseVersion(ver.stdout) : undefined;
    // The spawn above assumes the adapter is a literal CLI binary on PATH. Plugin-provided
    // adapters (e.g. the e2e mock-cli plugin, or any future non-CLI Adapter) have no such
    // binary and would always ENOENT here — they report their own installed state instead.
    // Fall back to asking the adapter directly before concluding "not installed".
    if (!installed) {
      installed = await adapter.isInstalled();
      if (installed) version = (await adapter.getVersion()) ?? undefined;
    }
    // Skip live model discovery for an uninstalled adapter — no point spawning a probe (or Codex's
    // 30s app-server) that will only ENOENT. Keep the fallback snapshot; refresh installed/version only.
    if (!installed) {
      this.applyRefresh(adapterId, { installed, version, models: undefined }, deps);
      log.warn({ adapterId, exePath }, 'adapter not installed — skipping live catalog discovery');
      return;
    }
    // Live model catalog: Claude probes; Codex (no probeModels) lists.
    let models: AdapterModel[] | null;
    try {
      models =
        typeof adapter.probeModels === 'function' ? await adapter.probeModels(exePath) : await adapter.listModels();
    } catch (err) {
      log.warn({ err, adapterId }, 'live model refresh threw; keeping fallback catalog');
      models = null;
    }
    const gotLive = Array.isArray(models) && models.length > 0;
    this.applyRefresh(adapterId, { installed, version, models: gotLive ? models! : undefined }, deps);
    if (gotLive) this.succeeded.add(adapterId);
    else log.warn({ adapterId, exePath }, 'no live catalog — will retry on next refresh');
  }

  private applyRefresh(
    adapterId: string,
    patch: { installed: boolean; version?: string; models?: AdapterModel[] },
    deps: RefreshDeps,
  ): void {
    const prev = this.snapshots.get(adapterId);
    if (!prev) return;
    const modelsChanged = patch.models !== undefined;
    const modelsRevision = modelsChanged ? (prev.modelsRevision ?? 1) + 1 : prev.modelsRevision;
    const next: AdapterInfo = {
      ...prev,
      installed: patch.installed,
      version: patch.version ?? prev.version,
      models: patch.models ?? prev.models,
      modelsRevision,
      catalogSource: modelsChanged ? 'probed' : prev.catalogSource,
    };
    // Mutate the cache BEFORE emitting so a throwing emitEvent cannot leave the snapshot un-updated (blocker #12).
    this.snapshots.set(adapterId, next);
    if (modelsChanged) {
      log.info({ adapterId, modelsRevision, count: patch.models!.length }, 'adapter catalog updated');
      try {
        deps.emitEvent({
          type: 'adapter.models.updated',
          adapterId,
          models: patch.models!,
          modelsRevision: modelsRevision!,
        });
      } catch (err) {
        log.error({ err, adapterId }, 'emit adapter.models.updated failed (snapshot already updated)');
      }
    }
  }
}
