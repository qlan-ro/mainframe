'use client';

/**
 * Going Unattended asks once per session (C13), wherever it is chosen: the
 * composer's permissions and the plan gate share the answer. `run` does
 * anything else straight away.
 */
import { useCallback, useState } from 'react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';

/** The sessions that already said yes, for as long as the app runs. */
const confirmedChats = new Set<string>();

export interface UnattendedConfirm {
  open: boolean;
  confirm: () => void;
  cancel: () => void;
}

export interface UnattendedGuard extends UnattendedConfirm {
  /** Runs `action`, after asking when it takes the session from `current` to Unattended. */
  run: (next: ExecutionMode, current: ExecutionMode, action: () => void) => void;
}

interface Pending {
  chatId: string | null;
  action: () => void;
}

export function useUnattendedGuard(chatId: string | null): UnattendedGuard {
  const [pending, setPending] = useState<Pending | null>(null);
  // Leaving the chat drops the question: coming back must not reopen it.
  if (pending != null && pending.chatId !== chatId) setPending(null);

  const run = useCallback(
    (next: ExecutionMode, current: ExecutionMode, action: () => void) => {
      const asks = next === 'yolo' && current !== 'yolo' && (chatId == null || !confirmedChats.has(chatId));
      if (asks) setPending({ chatId, action });
      else action();
    },
    [chatId],
  );
  const cancel = useCallback(() => setPending(null), []);
  const confirm = useCallback(() => {
    setPending(null);
    if (pending == null || pending.chatId !== chatId) return;
    if (pending.chatId != null) confirmedChats.add(pending.chatId);
    pending.action();
  }, [chatId, pending]);
  return { open: pending != null && pending.chatId === chatId, run, confirm, cancel };
}
