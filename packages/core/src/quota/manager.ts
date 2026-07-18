import type { DaemonEvent, ProviderQuota } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';
import { computeQuotaKey, resolveAccountIdentity } from './keying.js';
import { mergeProviderQuota, type ProviderQuotaUpdate } from './merge.js';
import { handlePullFailure } from './backoff.js';
import { deriveProviderStatus } from './status.js';

const log = createChildLogger('quota:manager');

const QUOTA_CATEGORY = 'quota';
/** Identity sentinel prefix meaning "read failed transiently" — reuse last-known, never re-key. */
const TRANSIENT_IDENTITY_PREFIX = 'transient:';

export interface QuotaManagerDeps {
  settings: {
    get(category: string, key: string): string | null;
    getByCategory(category: string): Record<string, string>;
    set(category: string, key: string, value: string): void;
  };
  emitEvent: (event: DaemonEvent) => void;
  now?: () => number;
}

/** Harvests a fresh full-replacement blob for one adapter (e.g. Claude `/usage`). */
export type QuotaPuller = () => Promise<ProviderQuota>;

/**
 * In-memory quota state for the daemon. Adapters push escalations (sparse merges) and
 * registered pullers refresh full snapshots; both are keyed per account so a same-provider
 * swap lands on a fresh bucket (#259). The current blob is persisted to the settings KV and
 * reloaded on boot. Status is always re-derived at read time so expiry reflects the real clock.
 */
export class QuotaManager {
  private readonly blobs = new Map<string, ProviderQuota>();
  private readonly currentKey = new Map<string, string>();
  private readonly lastKnownIdentity = new Map<string, string>();
  private readonly pullers = new Map<string, QuotaPuller>();
  private readonly now: () => number;

  constructor(private readonly deps: QuotaManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  registerPuller(adapterId: string, puller: QuotaPuller): void {
    this.pullers.set(adapterId, puller);
  }

  /** Rehydrate persisted blobs; the newest-observed per adapter becomes the current one. */
  loadFromDisk(): void {
    const stored = this.deps.settings.getByCategory(QUOTA_CATEGORY);
    for (const [key, value] of Object.entries(stored)) {
      const blob = safeParseQuota(value);
      if (!blob) {
        log.warn({ key }, 'quota: discarding unparseable persisted blob');
        continue;
      }
      this.blobs.set(key, blob);
      const adapterId = adapterIdFromKey(key);
      if (!adapterId) continue;
      const current = this.getCurrentBlob(adapterId);
      if (!current || blob.observedAt > current.observedAt) {
        this.currentKey.set(adapterId, key);
        if (blob.accountIdentity) this.lastKnownIdentity.set(adapterId, blob.accountIdentity);
      }
    }
  }

  /** The current blob for an adapter, with status re-derived at the present instant. */
  get(adapterId: string): ProviderQuota | undefined {
    const blob = this.getCurrentBlob(adapterId);
    if (!blob) return undefined;
    return { ...blob, status: deriveProviderStatus(blob, this.now()) };
  }

  /**
   * Fold a harvested quota into state. `pull` fully replaces the account's blob; `push`
   * sparse-merges (an omitted window keeps the prior value). Persists and emits either way.
   */
  ingest(adapterId: string, quota: ProviderQuota, mode: 'pull' | 'push'): ProviderQuota {
    const now = this.now();
    const identity = this.resolveIdentity(adapterId, quota.accountIdentity);
    const key = computeQuotaKey(adapterId, identity);
    const next =
      mode === 'pull'
        ? replaceBlob(quota, identity, now)
        : mergeProviderQuota(this.blobs.get(key), toSparseUpdate(quota, identity), now);
    this.commit(adapterId, key, identity, next);
    return next;
  }

  /** Puller-driven refresh. On failure keep the last-known blob (backoff); no puller ⇒ last-known. */
  async refresh(adapterId: string): Promise<ProviderQuota | undefined> {
    const puller = this.pullers.get(adapterId);
    if (!puller) return this.get(adapterId);
    try {
      return this.ingest(adapterId, await puller(), 'pull');
    } catch (err) {
      log.warn({ err, adapterId }, 'quota pull failed; keeping last-known');
      return this.reevaluate(adapterId);
    }
  }

  /** Re-derive status on the current blob (post-failure / expiry) and re-persist + emit. */
  private reevaluate(adapterId: string): ProviderQuota | undefined {
    const key = this.currentKey.get(adapterId);
    const prior = key ? this.blobs.get(key) : undefined;
    if (!key || !prior) return undefined;
    const next = handlePullFailure(prior, this.now());
    this.commit(adapterId, key, prior.accountIdentity, next);
    return next;
  }

  private getCurrentBlob(adapterId: string): ProviderQuota | undefined {
    const key = this.currentKey.get(adapterId);
    return key ? this.blobs.get(key) : undefined;
  }

  private resolveIdentity(adapterId: string, rawIdentity: string | undefined): string | undefined {
    const isTransient = !rawIdentity || rawIdentity.startsWith(TRANSIENT_IDENTITY_PREFIX);
    if (isTransient) return resolveAccountIdentity(null, this.lastKnownIdentity.get(adapterId));
    return rawIdentity;
  }

  private commit(adapterId: string, key: string, identity: string | undefined, blob: ProviderQuota): void {
    this.blobs.set(key, blob);
    this.currentKey.set(adapterId, key);
    if (identity && !identity.startsWith(TRANSIENT_IDENTITY_PREFIX)) {
      this.lastKnownIdentity.set(adapterId, identity);
    }
    this.deps.settings.set(QUOTA_CATEGORY, key, JSON.stringify(blob));
    this.deps.emitEvent({ type: 'provider.quota.updated', adapterId, quota: blob });
  }
}

/** A full-replacement pull: take exactly the harvested windows, re-deriving status. */
function replaceBlob(quota: ProviderQuota, identity: string | undefined, now: number): ProviderQuota {
  const blob: ProviderQuota = {
    status: 'unknown',
    session: quota.session,
    weekly: quota.weekly,
    modelWindows: quota.modelWindows ?? [],
    observedAt: quota.observedAt,
    accountIdentity: identity,
  };
  blob.status = deriveProviderStatus(blob, now);
  return blob;
}

/** An empty modelWindows array is dropped so a push can't clear the prior model windows. */
function toSparseUpdate(quota: ProviderQuota, identity: string | undefined): ProviderQuotaUpdate {
  return {
    observedAt: quota.observedAt,
    accountIdentity: identity,
    session: quota.session,
    weekly: quota.weekly,
    modelWindows: quota.modelWindows.length > 0 ? quota.modelWindows : undefined,
  };
}

/** The adapterId is the key segment before the first colon (`claude`/`codex` carry none). */
function adapterIdFromKey(key: string): string | undefined {
  const colon = key.indexOf(':');
  return colon > 0 ? key.slice(0, colon) : undefined;
}

function safeParseQuota(value: string): ProviderQuota | undefined {
  try {
    const parsed = JSON.parse(value) as ProviderQuota;
    if (typeof parsed?.observedAt === 'number' && Array.isArray(parsed.modelWindows)) return parsed;
  } catch {
    return undefined; /* malformed persisted blob — caller logs and skips */
  }
  return undefined;
}
