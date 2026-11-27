import { isHeldHistoryItem } from './acp-history-items';
import type { HistoryWindowHost } from './acp-history';
import type { AcpTranscriptStore } from './acp-transcript-store';

/**
 * The window half of the history host: what the plane does to its transcript store when the history
 * trims the live window or shows, extends and hides a window around a jump target. `refreshLive`
 * converts and dispatches the live window; `refreshWindow` the window around a target (or none).
 */
export function planeWindowHost(
  store: AcpTranscriptStore,
  refresh: { live: () => void; window: () => void },
  chatId: () => string,
): HistoryWindowHost {
  return {
    newestPageStart: (turns) => store.newestPageStart(turns),
    trimTo: (start) => {
      store.trimTo(start);
      refresh.live();
    },
    showWindow: (result, more = []) => {
      store.openAround(result.updates ?? []);
      for (const step of more) store.extendAround(step.result.updates ?? [], step.side);
      refresh.window();
    },
    extendWindow: (result, side) => {
      if (side === 'before') window.dispatchEvent(new CustomEvent('mainframe:history-prepend', { detail: chatId() }));
      if (store.extendAround(result.updates ?? [], side).length) refresh.window();
    },
    hideWindow: () => {
      store.closeAround();
      refresh.window();
    },
    windowHasItem: (id) => isHeldHistoryItem(store.shown.itemsInOrder, id),
    windowSpan: (id) => {
      const items = store.shown.itemsInOrder;
      const at = items.findIndex((item) => item.id === id);
      return at < 0 ? null : { before: at, after: items.length - at - 1 };
    },
  };
}
