'use client';

/**
 * Turning on Unattended asks once per session (C13). `request` runs any other
 * mode change straight away; Unattended waits for the dialog the first time.
 */
import { useCallback, useState } from 'react';
import type { ExecutionMode } from '@qlan-ro/mainframe-types';

/** The sessions that already said yes, for as long as the app runs. */
const confirmedChats = new Set<string>();

export interface UnattendedConfirm {
  open: boolean;
  request: (mode: ExecutionMode) => void;
  confirm: () => void;
  cancel: () => void;
}

export function useUnattendedConfirm(
  chatId: string | null,
  current: ExecutionMode,
  setMode: (mode: ExecutionMode) => void,
): UnattendedConfirm {
  const [pendingChat, setPendingChat] = useState<string | null>(null);
  const request = useCallback(
    (mode: ExecutionMode) => {
      if (mode !== 'yolo' || current === 'yolo' || chatId == null || confirmedChats.has(chatId)) setMode(mode);
      else setPendingChat(chatId);
    },
    [chatId, current, setMode],
  );
  const cancel = useCallback(() => setPendingChat(null), []);
  const confirm = useCallback(() => {
    setPendingChat(null);
    if (chatId == null || pendingChat !== chatId) return;
    confirmedChats.add(chatId);
    setMode('yolo');
  }, [chatId, pendingChat, setMode]);
  return { open: pendingChat != null && pendingChat === chatId, request, confirm, cancel };
}
