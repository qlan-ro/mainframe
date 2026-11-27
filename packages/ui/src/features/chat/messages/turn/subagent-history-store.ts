import { create } from 'zustand';
import type { ThreadMessage } from '@assistant-ui/react';
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
  /** The last Find target a reset looked for, so a target it cannot reach is not looked for again. */
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
    messages: [],
    window: firstWindow(undefined, false),
    later: false,
    loading: true,
    side: 'open',
  };
}

/** The entry after its accumulator changed: messages converted again, cursors read off the window. */
function settled(entry: Entry, window: PageWindow): Entry {
  const messages = entry.converter
    .convert(entry.accumulator.itemsInOrder, () => new Date(0))
    .map(normalizeNativeMessage);
  return {
    ...entry,
    messages,
    window,
    before: olderCursor(window)?.before,
    later: hasNewer(window),
    loading: false,
    side: undefined,
    error: false,
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
async function step(entry: Entry, side: LoadSide, request: RequestPage, untilItemId?: string): Promise<Entry> {
  if (side === 'open') return openWindow(request);
  const cursor = side === 'older' ? olderCursor(entry.window) : newerCursor(entry.window);
  if (!cursor) return settled(entry, entry.window);
  const page = await ask(request, side === 'older' && untilItemId ? { ...cursor, until: untilItemId } : cursor);
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
export async function loadSubagentPage(
  key: string,
  request: RequestPage,
  side: LoadSide = 'open',
  untilItemId?: string,
) {
  const existing = current(key);
  if (existing?.loading) return;
  if (side === 'open' && existing && !existing.error) return;
  if (side === 'older' && !existing?.before) return;
  if (side === 'newer' && !existing?.later) return;
  const loading: Entry =
    existing && side !== 'open' ? { ...existing, loading: true, side, error: false } : emptyEntry();
  save(key, loading);
  try {
    const next = await step(loading, side, request, untilItemId);
    if (current(key) === loading) save(key, next);
  } catch {
    if (current(key) === loading) save(key, { ...loading, loading: false, error: true });
  }
}

/**
 * Brings a Find target (container `containerId`, holding item `itemId`) into the window. Held
 * already: nothing. While the window reaches the agent's end, the page from the target up to the
 * window is loaded, as scrolling up would. Once pages below were dropped, the target may be below
 * as well, so the window starts again from the newest page and reaches up to the target from there.
 */
export async function loadSubagentTarget(key: string, request: RequestPage, containerId: string, itemId: string) {
  const existing = current(key);
  if (!existing || existing.loading || existing.error) return;
  if (existing.messages.some(({ id }) => id === containerId)) return;
  if (!existing.later) return loadSubagentPage(key, request, 'older', itemId);
  if (existing.target === containerId) return;
  const loading: Entry = { ...existing, loading: true, side: 'open', target: containerId };
  save(key, loading);
  try {
    let next = { ...(await openWindow(request)), target: containerId };
    if (!next.messages.some(({ id }) => id === containerId) && next.before)
      next = { ...(await step(next, 'older', request, itemId)), target: containerId };
    if (current(key) === loading) save(key, next);
  } catch {
    if (current(key) === loading) save(key, { ...loading, loading: false, error: true });
  }
}
