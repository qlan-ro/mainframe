import { isHeldHistoryItem } from './acp-history-items';
import type { HistoryWindowHost } from './acp-history';
import type { AcpTranscriptStore } from './acp-transcript-store';

/**
 * The window half of the history host: what the plane does to its transcript store when the history
 * trims the live window or shows, extends and hides a window around a jump target. `refresh`
 * converts what the store shows and dispatches it.
 */
export function planeWindowHost(
  store: AcpTranscriptStore,
  refresh: () => void,
  chatId: () => string,
): HistoryWindowHost {
  return {
    trim: (turns, refreshAfter) => {
      const start = store.trimLive(turns);
      if (start && refreshAfter) refresh();
      return start;
    },
    showWindow: (result) => {
      store.openAround(result.updates ?? []);
      refresh();
    },
    extendWindow: (result, side) => {
      if (side === 'before') window.dispatchEvent(new CustomEvent('mainframe:history-prepend', { detail: chatId() }));
      if (store.extendAround(result.updates ?? [], side).length) refresh();
    },
    hideWindow: () => {
      store.closeAround();
      refresh();
    },
    windowHasItem: (id) => isHeldHistoryItem(store.shown.itemsInOrder, id),
    windowSpan: (id) => {
      const items = store.shown.itemsInOrder;
      const at = items.findIndex((item) => item.id === id);
      return at < 0 ? null : { before: at, after: items.length - at - 1 };
    },
  };
}
