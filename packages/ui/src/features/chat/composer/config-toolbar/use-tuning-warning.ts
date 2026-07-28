'use client';

/**
 * useTuningWarning — the confirm gate every mid-session tuning change passes through.
 *
 * `guard(request, apply)` either runs `apply` straight away (no history, no real
 * change, or the user opted out) or parks it until the dialog is answered. The
 * parked closure is the caller's original one, so confirming issues exactly the
 * PATCH the control would have issued unguarded — one request, same payload.
 *
 * `guard` keeps a stable identity across renders (it reads the live context through
 * a ref) because useComposerTuning's setters are useCallback-memoized on it.
 *
 * Switching threads does NOT remount the composer, so a parked change would
 * otherwise outlive the chat it was requested on and PATCH a session the user has
 * left. The origin chat id travels with the parked change and is checked twice: an
 * effect drops it on the switch, and confirm() refuses a mismatch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiPrefs } from '@/store/ui-prefs';
import {
  resolveTuningChange,
  shouldWarnTuningChange,
  type TuningChange,
  type TuningChangeRequest,
  type TuningWarningContext,
} from './tuning-warning';

export interface TuningWarningHook {
  /** The change awaiting confirmation, or null when no dialog is open. */
  pending: TuningChange | null;
  suppressChecked: boolean;
  setSuppressChecked: (value: boolean) => void;
  guard: (request: TuningChangeRequest, apply: () => void) => void;
  confirm: () => void;
  cancel: () => void;
}

interface ParkedChange {
  change: TuningChange;
  apply: () => void;
  originChatId: string | null;
}

export function useTuningWarning(ctx: TuningWarningContext): TuningWarningHook {
  const suppressed = useUiPrefs((s) => s.dontWarnOnTuningChange);
  const [parked, setParked] = useState<ParkedChange | null>(null);
  const [suppressChecked, setSuppressChecked] = useState(false);

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  const chatId = ctx.chat?.id ?? null;

  useEffect(() => {
    if (parked != null && parked.originChatId !== chatId) {
      setParked(null);
      setSuppressChecked(false);
    }
  }, [parked, chatId]);

  const guard = useCallback((request: TuningChangeRequest, apply: () => void) => {
    const live = ctxRef.current;
    const change = resolveTuningChange(live, request);
    if (
      change == null ||
      !shouldWarnTuningChange({ change, hasMessages: live.hasMessages, suppressed: suppressedRef.current })
    ) {
      apply();
      return;
    }
    setSuppressChecked(false);
    setParked({ change, apply, originChatId: live.chat?.id ?? null });
  }, []);

  const confirm = useCallback(() => {
    if (parked == null) return;
    setParked(null);
    setSuppressChecked(false);
    if (parked.originChatId !== (ctxRef.current.chat?.id ?? null)) return;
    // The preference commits here only, so checking the box then cancelling writes nothing.
    if (suppressChecked) useUiPrefs.getState().dismissTuningChangeWarning();
    parked.apply();
  }, [parked, suppressChecked]);

  const cancel = useCallback(() => {
    setParked(null);
    setSuppressChecked(false);
  }, []);

  return {
    pending: parked?.change ?? null,
    suppressChecked,
    setSuppressChecked,
    guard,
    confirm,
    cancel,
  };
}
