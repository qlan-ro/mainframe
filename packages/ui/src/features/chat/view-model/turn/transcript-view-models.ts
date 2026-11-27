/**
 * The turn model of each recently shown chat, kept while its controller lives.
 *
 * A chat's messages are converted once per controller and survive a switch: the plane's
 * `TranscriptConverter` and the runtime's `TranscriptProjector` already live as long as the
 * controller. The turn model built from those messages did not. It lived in the transcript
 * component, which remounts on every switch, so coming back to a chat rebuilt every turn from an
 * empty `TurnCache`. This keeps the `TurnCache` and the last model per chat and view.
 *
 * - **Key.** The model is reused while the window's messages are the same objects in the same order
 *   (the window revision), and the scope and display settings are unchanged. Anything else
 *   rebuilds through the chat's own `TurnCache`, which keeps every turn and slice that did not change.
 * - **Invalidation.** An older page, a trim, a jump window (opening, moving or leaving it) and a
 *   change of display settings drop the cached model. An entry no view shows is dropped whole,
 *   so it never holds messages the window has let go.
 * - **Budget.** Entries are sized by an estimate of what they hold. Past the budget the least
 *   recently used entries go, never one a mounted view holds.
 */
import type { ThreadMessage } from '@assistant-ui/react';
import { buildTurns } from './build-turns';
import { TurnCache } from './turn-cache';
import type { TurnModel, TurnScope } from './types';

export const VIEW_MODEL_BUDGET_BYTES = 4 * 1024 * 1024;
/**
 * Estimated heap per message (its cached units, slice and turn objects) and per part (its unit),
 * measured in V8 on ten-turn windows of prose and tool calls.
 */
const BYTES_PER_MESSAGE = 768;
const BYTES_PER_PART = 384;

export interface ViewModelInputs {
  readonly messages: readonly ThreadMessage[];
  readonly scope: TurnScope;
  /** The display settings the view is drawn with. */
  readonly presentation: string;
}

interface Built {
  readonly messages: readonly ThreadMessage[];
  readonly scopeKey: string;
  readonly presentation: string;
  readonly model: TurnModel;
}

interface Entry {
  readonly owner: object;
  cache: TurnCache;
  built: Built | null;
  bytes: number;
  holds: number;
}

export interface TranscriptViewModelsOptions {
  budget?: number;
  /** Calls `changed` whenever the owner's window changes; returns the unsubscribe. */
  watch?: (owner: object, changed: () => void) => () => void;
}

function scopeKey(scope: TurnScope): string {
  return JSON.stringify([
    scope.rootThreadId,
    scope.ancestors,
    [...scope.pendingToolIds].sort(),
    scope.isRunning ?? null,
    scope.runAfter === undefined ? '' : scope.runAfter,
    scope.live ?? null,
  ]);
}

function sameMessages(a: readonly ThreadMessage[], b: readonly ThreadMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function estimate(messages: readonly ThreadMessage[]): number {
  let bytes = 0;
  for (const message of messages) bytes += BYTES_PER_MESSAGE + message.content.length * BYTES_PER_PART;
  return bytes;
}

export class TranscriptViewModels {
  /** Least recently used first. */
  private readonly entries = new Map<string, Entry>();
  private readonly ids = new WeakMap<object, number>();
  private readonly watching = new Map<object, () => void>();
  private nextId = 0;
  private total = 0;

  constructor(private readonly options: TranscriptViewModelsOptions = {}) {}

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.entries.size;
  }

  /** The turn model of `owner`'s `view`: the cached one when its inputs are unchanged. */
  model(owner: object, view: string, inputs: ViewModelInputs): TurnModel {
    const key = this.key(owner, view);
    const entry = this.touch(key, owner);
    const { messages, scope, presentation } = inputs;
    const scoped = scopeKey(scope);
    const built = entry.built;
    if (
      built &&
      built.scopeKey === scoped &&
      built.presentation === presentation &&
      sameMessages(built.messages, messages)
    )
      return built.model;
    const model = buildTurns(messages, scope, entry.cache);
    entry.built = { messages, scopeKey: scoped, presentation, model };
    this.total += estimate(messages) - entry.bytes;
    entry.bytes = estimate(messages);
    this.evict(key);
    return model;
  }

  /** A mounted view: its entry is not evicted, and an invalidation keeps its `TurnCache` (row identity). */
  hold(owner: object, view: string): () => void {
    const key = this.key(owner, view);
    this.touch(key, owner).holds += 1;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      const entry = this.entries.get(key);
      if (entry) entry.holds -= 1;
      this.evict();
    };
  }

  /** The owner's window or settings changed: drop its cached models, and its idle entries whole. */
  invalidate(owner: object): void {
    for (const [key, entry] of this.entries) if (entry.owner === owner) this.invalidateEntry(key, entry);
  }

  invalidateAll(): void {
    for (const [key, entry] of this.entries) this.invalidateEntry(key, entry);
  }

  /** The owner is gone (its controller was disposed): everything it had goes, held or not. */
  release(owner: object): void {
    for (const [key, entry] of this.entries) if (entry.owner === owner) this.drop(key, entry);
  }

  private invalidateEntry(key: string, entry: Entry): void {
    if (entry.holds > 0) {
      entry.built = null;
      this.total -= entry.bytes;
      entry.bytes = 0;
    } else this.drop(key, entry);
  }

  private key(owner: object, view: string): string {
    let id = this.ids.get(owner);
    if (id === undefined) {
      id = ++this.nextId;
      this.ids.set(owner, id);
    }
    return `${id}\0${view}`;
  }

  private touch(key: string, owner: object): Entry {
    let entry = this.entries.get(key);
    if (entry) this.entries.delete(key);
    else {
      entry = { owner, cache: new TurnCache(), built: null, bytes: 0, holds: 0 };
      if (!this.watching.has(owner) && this.options.watch)
        this.watching.set(
          owner,
          this.options.watch(owner, () => this.invalidate(owner)),
        );
    }
    this.entries.set(key, entry);
    return entry;
  }

  private drop(key: string, entry: Entry): void {
    if (!this.entries.delete(key)) return;
    this.total -= entry.bytes;
    if ([...this.entries.values()].some((other) => other.owner === entry.owner)) return;
    this.watching.get(entry.owner)?.();
    this.watching.delete(entry.owner);
  }

  /** Least recently used first, skipping held entries and `keep` (the one just built). */
  private evict(keep?: string): void {
    const budget = this.options.budget ?? VIEW_MODEL_BUDGET_BYTES;
    for (const [key, entry] of this.entries) {
      if (this.total <= budget) return;
      if (key !== keep && entry.holds === 0) this.drop(key, entry);
    }
  }
}
