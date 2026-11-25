/**
 * use-activity-jump — the jump from an Activity row to the transcript, as the
 * section sees it: which row is waiting for history, and what to say when the
 * history doesn't hold it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/error-message';
import { mfToast } from '@/lib/toast';
import type { ActivityEntry } from './activity-model';
import { cancelActivityJump, jumpToActivitySource } from './activity-source';
import { usePanelControl, type PanelColumnId } from './panel-control-store';

/** A load shorter than this shows nothing. */
const SLOW_LOAD_MS = 150;

export interface ActivityJumps {
  jump: (row: ActivityEntry) => void;
  /** For a row action that shows something else. */
  cancel: () => void;
  /** The row whose history is still loading. */
  loadingId?: string;
}

export function useActivityJump(chatId: string, columnId: PanelColumnId): ActivityJumps {
  const setOverlayOpen = usePanelControl((s) => s.setOverlayOpen);
  const [loading, setLoading] = useState<{ chatId: string; rowId: string }>();
  const slow = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ticket = useRef(0);
  useEffect(() => () => clearTimeout(slow.current), []);

  const settle = useCallback(() => {
    clearTimeout(slow.current);
    setLoading(undefined);
  }, []);

  const cancel = useCallback(() => {
    ticket.current++;
    cancelActivityJump();
    settle();
  }, [settle]);

  const jump = useCallback(
    (row: ActivityEntry) => {
      cancel();
      const mine = ticket.current;
      const outOfHistory = () => mfToast.info(`“${row.title}” started before the history shown here`);
      if (!row.source) {
        outOfHistory();
        return;
      }
      const done = () => {
        if (ticket.current === mine) settle();
      };
      slow.current = setTimeout(() => setLoading({ chatId, rowId: row.id }), SLOW_LOAD_MS);
      jumpToActivitySource(chatId, row.source, () => {
        done();
        // The floating panel covers the row it goes to. Until then it stays, with the row's feedback in it.
        setOverlayOpen(columnId, false);
      })
        .then((outcome) => outcome === 'missing' && outOfHistory())
        .catch((error: unknown) => mfToast.error('Could not load the message', { description: errorMessage(error) }))
        .finally(done);
    },
    [cancel, settle, chatId, columnId, setOverlayOpen],
  );

  return { jump, cancel, loadingId: loading?.chatId === chatId ? loading.rowId : undefined };
}
