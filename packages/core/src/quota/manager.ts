import type { DaemonEvent, ProviderQuota } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';
import { computeQuotaKey, resolveAccountIdentity } from './keying.js';
import { mergeProviderQuota, stampWindowObservedAt, type ProviderQuotaUpdate } from './merge.js';
import { handlePullFailure } from './backoff.js';
import { deriveProviderStatus } from './status.js';
import { safeParseQuota } from './quota-schema.js';

const log = createChildLogger('quota:manager');

const QUOTA_CATEGORY = 'quota';
/** Identity sentinel prefix meaning "read failed transiently" — reuse last-known, never re-key. */
const TRANSIENT_IDENTITY_PREFIX = 'transient:';
/** How long a resolved account identity is trusted before the resolver is consulted again. */
const IDENTITY_CACHE_TTL_MS = 60_000;

export interface QuotaManagerDeps {
  settings: {
    get(category: string, key: string): string | null;
    getByCategory(category: string): Record<string, string>;
    set(category: string, key: string, value: string): void;
  };
  emitEvent: (event: DaemonEvent) => void;
  now?: () => number;
}

/** Harvests a fresh blob for one adapter (e.g. Claude `/usage`). Null ⇒ nothing to ingest. */
export type QuotaPuller = () => Promise<ProviderQuota | null>;

/** Reads the live account identity for an adapter (concrete uuid/email, `unknown`, or a `transient:` sentinel). */
export type IdentityResolver = () => Promise<string>;

interface CachedIdentity {
  identity: string;
  expiresAt: number;
}

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
  private readonly mergeOnPull = new Set<string>();
  private readonly identityResolvers = new Map<string, IdentityResolver>();
  private readonly identityCache = new Map<string, CachedIdentity>();
  private readonly now: () => number;

  constructor(private readonly deps: QuotaManagerDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** `mergeOnPull` folds pull results sparsely (Codex) instead of full-replacing them (Claude). */
  registerPuller(adapterId: string, puller: QuotaPuller, options?: { mergeOnPull?: boolean }): void {
    this.pullers.set(adapterId, puller);
    if (options?.mergeOnPull) this.mergeOnPull.add(adapterId);
  }

  /** Resolves the account identity for identity-less pushes (Codex rate-limit events) and boot selection. */
  registerIdentityResolver(adapterId: string, resolver: IdentityResolver): void {
    this.identityResolvers.set(adapterId, resolver);
  }

  /**
   * Rehydrate persisted blobs. Per adapter the resolver picks the live account's blob when its
   * identity is concrete and present on disk; otherwise the newest-observed blob wins.
   */
  async loadFromDisk(): Promise<void> {
    const stored = this.deps.settings.getByCategory(QUOTA_CATEGORY);
    const keysByAdapter = new Map<string, string[]>();
    for (const [key, value] of Object.entries(stored)) {
      const blob = safeParseQuota(value);
      if (!blob) {
        log.warn({ key }, 'quota: discarding unparseable persisted blob');
        continue;
      }
      this.blobs.set(key, blob);
      const adapterId = adapterIdFromKey(key);
      if (!adapterId) continue;
      const keys = keysByAdapter.get(adapterId) ?? [];
      keys.push(key);
      keysByAdapter.set(adapterId, keys);
    }
    for (const [adapterId, keys] of keysByAdapter) {
      const key = await this.selectBootKey(adapterId, keys);
      if (!key) continue;
      this.currentKey.set(adapterId, key);
      const identity = this.blobs.get(key)?.accountIdentity;
      if (identity && !identity.startsWith(TRANSIENT_IDENTITY_PREFIX)) {
        this.lastKnownIdentity.set(adapterId, identity);
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
   * sparse-merges (an omitted window keeps the prior value). An identity-less push resolves
   * the live account through the registered resolver. Persists and emits either way.
   */
  async ingest(adapterId: string, quota: ProviderQuota, mode: 'pull' | 'push'): Promise<ProviderQuota> {
    const now = this.now();
    const identity = await this.resolveIngestIdentity(adapterId, quota.accountIdentity, mode);
    const key = computeQuotaKey(adapterId, identity);
    const next =
      mode === 'pull'
        ? replaceBlob(quota, identity, now)
        : mergeProviderQuota(this.blobs.get(key), toSparseUpdate(quota, identity), now);
    this.commit(adapterId, key, identity, next);
    return next;
  }

  /** Puller-driven refresh. On failure/no-data keep the last-known blob; no puller ⇒ last-known. */
  async refresh(adapterId: string): Promise<ProviderQuota | undefined> {
    const puller = this.pullers.get(adapterId);
    if (!puller) return this.get(adapterId);
    try {
      const quota = await puller();
      if (!quota) return this.reevaluate(adapterId);
      return await this.ingest(adapterId, quota, this.mergeOnPull.has(adapterId) ? 'push' : 'pull');
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

  private async resolveIngestIdentity(
    adapterId: string,
    rawIdentity: string | undefined,
    mode: 'pull' | 'push',
  ): Promise<string | undefined> {
    if (rawIdentity !== undefined) return this.resolveIdentity(adapterId, rawIdentity);
    const resolved = mode === 'push' ? await this.cachedResolve(adapterId) : undefined;
    return this.resolveIdentity(adapterId, resolved);
  }

  private resolveIdentity(adapterId: string, rawIdentity: string | undefined): string | undefined {
    const isTransient = !rawIdentity || rawIdentity.startsWith(TRANSIENT_IDENTITY_PREFIX);
    if (isTransient) return resolveAccountIdentity(null, this.lastKnownIdentity.get(adapterId));
    return rawIdentity;
  }

  private async selectBootKey(adapterId: string, keys: string[]): Promise<string | undefined> {
    const resolved = await this.cachedResolve(adapterId);
    if (resolved && !resolved.startsWith(TRANSIENT_IDENTITY_PREFIX)) {
      const key = computeQuotaKey(adapterId, resolved);
      if (this.blobs.has(key)) return key;
    }
    return newestKey(keys, this.blobs);
  }

  /** Resolve the adapter identity through a TTL cache so bursty pushes don't re-read auth each time. */
  private async cachedResolve(adapterId: string): Promise<string | undefined> {
    const resolver = this.identityResolvers.get(adapterId);
    if (!resolver) return undefined;
    const now = this.now();
    const cached = this.identityCache.get(adapterId);
    if (cached && now < cached.expiresAt) return cached.identity;
    try {
      const identity = await resolver();
      this.identityCache.set(adapterId, { identity, expiresAt: now + IDENTITY_CACHE_TTL_MS });
      return identity;
    } catch (err) {
      log.warn({ err, adapterId }, 'quota: identity resolver failed; reusing last-known');
      return undefined;
    }
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

/** A full-replacement pull: take exactly the harvested windows (stamped), re-deriving status. */
function replaceBlob(quota: ProviderQuota, identity: string | undefined, now: number): ProviderQuota {
  const blob: ProviderQuota = {
    status: 'unknown',
    session: stampWindowObservedAt(quota.session, quota.observedAt),
    weekly: stampWindowObservedAt(quota.weekly, quota.observedAt),
    modelWindows: (quota.modelWindows ?? []).map((window) => ({ ...window, observedAt: quota.observedAt })),
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

/** The key whose blob was observed most recently, used as the boot fallback. */
function newestKey(keys: string[], blobs: Map<string, ProviderQuota>): string | undefined {
  let best: string | undefined;
  let bestObservedAt = -Infinity;
  for (const key of keys) {
    const observedAt = blobs.get(key)?.observedAt ?? -Infinity;
    if (observedAt > bestObservedAt) {
      best = key;
      bestObservedAt = observedAt;
    }
  }
  return best;
}
