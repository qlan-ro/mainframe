import { create } from 'zustand';
import type { ThreadMessage, ThreadMessageLike } from '@assistant-ui/react';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../../view-model/acp-item-accumulator';
import { TranscriptConverter } from '../../view-model/convert-acp-item';
import { normalizeNativeMessage } from '../../view-model/normalize-native-messages';
import {
  firstWindow,
  hasNewer,
  landNewer,
  landOlder,
  newerCursor,
  olderCursor,
  type Landed,
  type PageCursor,
  type PageWindow,
} from './subagent-window';

export type LoadSide = 'open' | 'older' | 'newer';

interface Entry {
  accumulator: AcpItemAccumulator;
  converter: TranscriptConverter;
  /** Converted → normalized message: an untouched container keeps its message object, so its row does not render again. */
  native: WeakMap<ThreadMessageLike, ThreadMessage>;
  messages: readonly ThreadMessage[];
  window: PageWindow;
  /** The floor to page before: more is above the held window. */
  before?: string;
  /** Pages below the held window were dropped: the steps do not reach the agent's end. */
  later: boolean;
  loading: boolean;
  /** Which way the load in flight goes, or the failed one went (Retry repeats it). */
  side?: LoadSide;
  error?: boolean;
  /** The Find target the last seek ended on, so the same window is not searched again for it. Any later change clears it. */
  target?: string;
}

export type RequestPage = (before?: string, untilItemId?: string) => Promise<HistoryPageResult>;
export const useSubagentHistoryStore = create<{ entries: ReadonlyMap<string, Entry> }>(() => ({ entries: new Map() }));
export const historyKey = (chatId: string, agentId: string) => JSON.stringify([chatId, agentId]);

export function releaseSubagentHistory(chatId: string) {
  const entries = new Map(useSubagentHistoryStore.getState().entries);
  const prefix = JSON.stringify([chatId]).slice(0, -1) + ',';
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  useSubagentHistoryStore.setState({ entries });
}

const current = (key: string) => useSubagentHistoryStore.getState().entries.get(key);

function save(key: string, entry: Entry) {
  const entries = new Map(useSubagentHistoryStore.getState().entries);
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > 64) entries.delete(entries.keys().next().value!);
  useSubagentHistoryStore.setState({ entries });
}

function emptyEntry(): Entry {
  return {
    accumulator: new AcpItemAccumulator(),
    converter: new TranscriptConverter(),
    native: new WeakMap(),
    messages: [],
    window: firstWindow(undefined, false),
    later: false,
    loading: true,
    side: 'open',
  };
}

/** The entry after its accumulator changed: messages converted again, cursors read off the window. */
function settled(entry: Entry, window: PageWindow): Entry {
  const native = (like: ThreadMessageLike) => {
    let message = entry.native.get(like);
    if (!message) entry.native.set(like, (message = normalizeNativeMessage(like)));
    return message;
  };
  const messages = entry.converter.convert(entry.accumulator.itemsInOrder, () => new Date(0)).map(native);
  return {
    ...entry,
    messages,
    window,
    before: olderCursor(window)?.before,
    later: hasNewer(window),
    loading: false,
    side: undefined,
    error: false,
    target: undefined,
  };
}

function checked(page: HistoryPageResult): HistoryPageResult {
  if (page.stale || (page.hasMore && !page.floorItemId)) throw new Error('Invalid sub-agent page cursor');
  return page;
}

const ask = (request: RequestPage, cursor: PageCursor) =>
  cursor.until ? request(cursor.before, cursor.until) : request(cursor.before);

/** The newest page alone, as on open. */
async function openWindow(request: RequestPage): Promise<Entry> {
  const page = checked(await request());
  const entry = emptyEntry();
  entry.accumulator.prepend(page.updates ?? []);
  return settled(entry, firstWindow(page.floorItemId ?? entry.accumulator.itemsInOrder[0]?.id, page.hasMore));
}

function apply(entry: Entry, landed: Landed): Entry {
  if (landed.dropFrom) entry.accumulator.trimFrom(landed.dropFrom);
  if (landed.dropBefore) entry.accumulator.trimBefore(landed.dropBefore);
  return settled(entry, landed.window);
}

/** One page further along `side`, applied to the entry; a stale cursor opens the newest page again. */
async function step(entry: Entry, side: LoadSide, request: RequestPage): Promise<Entry> {
  if (side === 'open') return openWindow(request);
  const cursor = side === 'older' ? olderCursor(entry.window) : newerCursor(entry.window);
  if (!cursor) return settled(entry, entry.window);
  const page = await ask(request, cursor);
  if (page.stale) return openWindow(request);
  checked(page);
  if (side === 'older') {
    const updates = page.updates ?? [];
    if (!updates.length) return settled(entry, entry.window);
    entry.accumulator.prepend(updates);
    // The daemon names the page by its first item; the first item held now is the same one.
    const floor = page.floorItemId ?? entry.accumulator.itemsInOrder[0]!.id;
    return apply(entry, landOlder(entry.window, floor, page.hasMore));
  }
  const landed = landNewer(entry.window, page.floorItemId);
  if (!landed) return openWindow(request);
  entry.accumulator.append(page.updates ?? []);
  return apply(entry, landed);
}

/**
 * Loads the newest page on open (or again after an error), or one page above or below the held
 * window. At most `SUBAGENT_PAGES_KEPT` pages are held: the page furthest from the one that
 * landed is dropped, and it loads again when the reader scrolls back to it.
 */
export async function loadSubagentPage(key: string, request: RequestPage, side: LoadSide = 'open') {
  const existing = current(key);
  if (existing?.loading) return;
  if (side === 'open' && existing && !existing.error) return;
  if (side === 'older' && !existing?.before) return;
  if (side === 'newer' && !existing?.later) return;
  const loading: Entry =
    existing && side !== 'open' ? { ...existing, loading: true, side, error: false } : emptyEntry();
  save(key, loading);
  try {
    const next = await step(loading, side, request);
    if (current(key) === loading) save(key, next);
  } catch {
    if (current(key) === loading) save(key, { ...loading, loading: false, error: true });
  }
}

const holds = (entry: Entry, containerId: string) => entry.messages.some(({ id }) => id === containerId);

/** An older page that lands, or `null` when the daemon has nothing above the window up to `until`: the item is below it. */
async function olderUntil(entry: Entry, request: RequestPage, until: string): Promise<Entry | null> {
  const cursor = olderCursor(entry.window);
  if (!cursor) return null;
  const page = await request(cursor.before, until);
  if (page.stale) return openWindow(request);
  checked(page);
  const updates = page.updates ?? [];
  if (!updates.length) return null;
  entry.accumulator.prepend(updates);
  const floor = page.floorItemId ?? entry.accumulator.itemsInOrder[0]!.id;
  return apply(entry, landOlder(entry.window, floor, page.hasMore));
}

/**
 * Where a Find target is, within the bounded window. Above it: the page from the target up to the
 * window lands, as scrolling up to it would. Below it (the daemon has nothing above up to the target):
 * the dropped pages come back one at a time until the target is held, each step bounded like any
 * other. Neither (the item is not in this transcript): the window stays as it is.
 */
async function seek(entry: Entry, request: RequestPage, containerId: string, itemId: string): Promise<Entry> {
  const above = await olderUntil(entry, request, itemId);
  let next = above ?? settled(entry, entry.window);
  while (!above && !holds(next, containerId) && next.later) next = await step(next, 'newer', request);
  return next;
}

/** Brings a Find target (container `containerId`, holding item `itemId`) into the window. */
export async function loadSubagentTarget(key: string, request: RequestPage, containerId: string, itemId: string) {
  const existing = current(key);
  if (!existing || existing.loading || existing.error) return;
  if (holds(existing, containerId) || existing.target === containerId) return;
  const loading: Entry = { ...existing, loading: true, side: 'older', error: false };
  save(key, loading);
  try {
    const next = await seek(loading, request, containerId, itemId);
    if (current(key) === loading) save(key, { ...next, target: containerId });
  } catch {
    if (current(key) === loading) save(key, { ...loading, loading: false, error: true });
  }
}
