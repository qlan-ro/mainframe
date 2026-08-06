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
import { toast } from 'sonner';
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

function fire(input: MfToastInput) {
  const { type, title, description, chatId, action, details } = input;
  const persistent = type === 'error' || type === 'permission';
  const primary =
    action ?? (chatId != null ? { label: 'Open session', onClick: () => openSessionById(chatId) } : undefined);

  // Permission has no native sonner method; it renders as a warning toast.
  const method = type === 'permission' ? toast.warning : toast[type];
  method(title, {
    description,
    duration: persistent ? Infinity : AUTO_DISMISS_MS,
    // Persistent toasts need an exit that isn't an action.
    closeButton: persistent,
    action: primary,
    cancel: details
      ? { label: 'Details', onClick: () => showToastDetails({ title, description, details }) }
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
