/**
 * mfToast — the app's one toast API, on native sonner toasts (v2 Toaster).
 *
 * Every raise goes through here rather than sonner directly, so type→duration
 * policy and the details affordance stay in one place. Errors and permission
 * asks persist (Infinity + close button); the rest auto-dismiss.
 *
 * `details` is the escape hatch for abstract failures ("Agent Error"): pass
 * the raw payload (stack, stderr, response body) and the toast grows a
 * Details button that opens the ToastDetailsHost dialog — the toast itself
 * stays one line.
 *
 * Usage:
 *   mfToast.success('Branch pushed')
 *   mfToast.error('Push failed', { description: err.message, details: String(err.stack) })
 *   mfToast({ type: 'info', title: 'Running…', chatId: 'chat-123' })
 */
import * as React from 'react';
import { toast } from 'sonner';
import { ClampedDescription, ToastControls } from '@/components/ui/toast-parts';
import { openSessionById } from '@/lib/session-nav';
import { showToastDetails } from '@/store/toast-details';

const AUTO_DISMISS_MS = 4200;

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'permission';

export interface MfToastAction {
  label: string;
  onClick: () => void;
}

export interface MfToastOptions {
  description?: string;
  chatId?: string;
  /** Generic action button. Takes precedence over the chatId CTA. */
  action?: MfToastAction;
  /** Raw payload behind a Details button (stack, stderr, response body …). */
  details?: string;
}

export interface MfToastInput extends MfToastOptions {
  type: ToastType;
  title: string;
}

let nextId = 0;

function fire(input: MfToastInput, id: string = `mf-toast-${++nextId}`) {
  const { type, title, description, chatId, action, details } = input;
  const persistent = type === 'error' || type === 'permission';
  const primary =
    action ?? (chatId != null ? { label: 'Open session', onClick: () => openSessionById(chatId) } : undefined);

  // When the description overflows its 3-line clamp and the caller gave no
  // details, re-issue by id with the full text behind a Details button.
  // Sonner re-measures height only when a slot changes, hence the re-issue.
  const onOverflow =
    description != null && details == null ? () => fire({ ...input, details: description }, id) : undefined;

  const detailsButton =
    details != null
      ? { label: 'Details', onClick: () => showToastDetails({ title, description, details }) }
      : undefined;

  // Permission has no native sonner method; it renders as a warning toast.
  const method = type === 'permission' ? toast.warning : toast[type];
  method(title, {
    id,
    description:
      description != null ? React.createElement(ClampedDescription, { text: description, onOverflow }) : undefined,
    duration: persistent ? Infinity : AUTO_DISMISS_MS,
    // The close button is ours (inside the card); sonner's stays off.
    closeButton: false,
    action:
      primary || detailsButton || persistent
        ? React.createElement(ToastControls, { id, primary, details: detailsButton, closable: persistent })
        : undefined,
  });
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
