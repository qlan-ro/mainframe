import { create } from 'zustand';
import type { ThreadMessage } from '@assistant-ui/react';
import type { HistoryPageResult } from '@qlan-ro/mainframe-types';
import { AcpItemAccumulator } from '../../view-model/acp-item-accumulator';
import { TranscriptConverter } from '../../view-model/convert-acp-item';
import { normalizeNativeMessage } from '../../view-model/normalize-native-messages';

interface Entry {
  accumulator: AcpItemAccumulator;
  converter: TranscriptConverter;
  messages: readonly ThreadMessage[];
  before?: string;
  loading: boolean;
  error?: boolean;
}

type RequestPage = (before?: string) => Promise<HistoryPageResult>;
export const useSubagentHistoryStore = create<{ entries: ReadonlyMap<string, Entry> }>(() => ({ entries: new Map() }));
export const historyKey = (chatId: string, agentId: string) => JSON.stringify([chatId, agentId]);

export function releaseSubagentHistory(chatId: string) {
  const entries = new Map(useSubagentHistoryStore.getState().entries);
  const prefix = JSON.stringify([chatId]).slice(0, -1) + ',';
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  useSubagentHistoryStore.setState({ entries });
}

function save(key: string, entry: Entry) {
  const entries = new Map(useSubagentHistoryStore.getState().entries);
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > 64) entries.delete(entries.keys().next().value!);
  useSubagentHistoryStore.setState({ entries });
}

function emptyEntry(): Entry {
  return { accumulator: new AcpItemAccumulator(), converter: new TranscriptConverter(), messages: [], loading: true };
}

export async function loadSubagentPage(key: string, request: RequestPage, older = false, refresh = false) {
  const existing = useSubagentHistoryStore.getState().entries.get(key);
  if (existing?.loading || (older ? !existing?.before : existing && !existing.error && !refresh)) return;
  const loading = existing && !refresh ? { ...existing, loading: true, error: false } : emptyEntry();
  save(key, loading);
  try {
    let page = await request(older ? loading.before : undefined);
    const target = page.stale ? emptyEntry() : loading;
    if (page.stale) page = await request();
    if (page.stale || (page.hasMore && !page.floorItemId)) throw new Error('Invalid sub-agent page cursor');
    if (useSubagentHistoryStore.getState().entries.get(key) !== loading) return;
    target.accumulator.prepend(page.updates ?? []);
    const messages = target.converter
      .convert(target.accumulator.itemsInOrder, () => new Date(0))
      .map(normalizeNativeMessage);
    save(key, { ...target, messages, before: page.hasMore ? page.floorItemId : undefined, loading: false });
  } catch {
    if (useSubagentHistoryStore.getState().entries.get(key) === loading) {
      save(key, { ...loading, loading: false, error: true });
    }
  }
}
