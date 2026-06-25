/**
 * Git confirm bridge — a zustand store that lets action hooks await a boolean
 * confirm dialog without coupling to React rendering.
 *
 * `requestGitConfirm(opts)` returns a Promise<boolean> that resolves when the
 * user accepts or cancels the mounted ConfirmDialog.  A second call while one
 * is pending displaces the first (resolves it false) so only one dialog is
 * ever visible at a time.
 */
import { create } from 'zustand';

export interface GitConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface GitConfirmState {
  pending: GitConfirmRequest | null;
  request: (opts: GitConfirmRequest) => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

let resolver: ((ok: boolean) => void) | null = null;

export const useGitConfirm = create<GitConfirmState>((set, get) => ({
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
export const requestGitConfirm = (opts: GitConfirmRequest): Promise<boolean> => useGitConfirm.getState().request(opts);
