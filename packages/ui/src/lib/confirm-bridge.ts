/**
 * Confirm bridge — the app's single boolean-confirm mechanism: a zustand store
 * that lets any action hook await a yes/no dialog without coupling to React
 * rendering, and without the browser-native dialogs the Tauri webview never
 * renders.
 *
 * `requestConfirm(opts)` returns a Promise<boolean> that resolves when the user
 * accepts or cancels the ConfirmDialog `ConfirmDialogHost` mounts at the app
 * root. A second call while one is pending displaces the first (resolves it
 * false) so only one dialog is ever visible at a time.
 */
import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Testid root for the rendered dialog; the host defaults it to `confirm-dialog`. */
  testid?: string;
}

interface ConfirmBridgeState {
  pending: ConfirmRequest | null;
  request: (opts: ConfirmRequest) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

let resolver: ((ok: boolean) => void) | null = null;

export const useConfirmBridge = create<ConfirmBridgeState>((set, get) => ({
  pending: null,
  request: (opts) =>
    new Promise<boolean>((res) => {
      const displaced = resolver;
      resolver = res;
      set({ pending: opts });
      displaced?.(false);
    }),
  resolve: (ok) => {
    const r = resolver;
    if (!get().pending || !r) return;
    resolver = null;
    set({ pending: null });
    r(ok);
  },
}));

/** Thin wrapper action hooks call. Resolves with the user's boolean choice. */
export const requestConfirm = (opts: ConfirmRequest): Promise<boolean> => useConfirmBridge.getState().request(opts);
