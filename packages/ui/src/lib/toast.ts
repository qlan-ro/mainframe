/**
 * mfToast — typed toast helper for the warm-chrome WsToastCard.
 *
 * Wraps sonner's `toast.custom()` so every call produces a fully-styled
 * WsToastCard instead of a plain sonner toast.
 *
 * Usage:
 *   mfToast.success('Branch pushed')
 *   mfToast.error('Push failed', { description: err.message })
 *   mfToast({ type: 'info', title: 'Running…', chatId: 'chat-123' })
 */
import { createElement } from 'react';
import { toast } from 'sonner';
import { WsToastCard } from '@/components/ui/ws-toast';
import type { ToastType, WsToastAction } from '@/components/ui/ws-toast';
import { openSessionById } from '@/lib/session-nav';

const AUTO_DISMISS_MS = 4200;

export interface MfToastOptions {
  description?: string;
  chatId?: string;
  action?: WsToastAction;
}

export interface MfToastInput extends MfToastOptions {
  type: ToastType;
  title: string;
}

function fire(input: MfToastInput) {
  const { type, title, description, chatId, action } = input;
  const duration = type === 'error' || type === 'permission' ? Infinity : AUTO_DISMISS_MS;

  toast.custom(
    (id) =>
      createElement(WsToastCard, {
        id,
        type,
        title,
        description,
        action,
        chatId,
        onOpenSession: openSessionById,
        onDismiss: (tid) => toast.dismiss(tid),
      }),
    { duration },
  );
}

function success(title: string, opts?: MfToastOptions) {
  fire({ type: 'success', title, ...opts });
}

function error(title: string, opts?: MfToastOptions) {
  fire({ type: 'error', title, ...opts });
}

function warning(title: string, opts?: MfToastOptions) {
  fire({ type: 'warning', title, ...opts });
}

function info(title: string, opts?: MfToastOptions) {
  fire({ type: 'info', title, ...opts });
}

function permission(title: string, opts?: MfToastOptions) {
  fire({ type: 'permission', title, ...opts });
}

export const mfToast = Object.assign(fire, { success, error, warning, info, permission });
