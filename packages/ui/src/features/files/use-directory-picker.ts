/**
 * Directory-picker promise-bridge (mirrors archive-confirm-bridge.ts).
 *
 * `pickDirectory` opens the modal and returns a Promise that resolves with the
 * selected path (string) or null on cancel. A second call displaces any in-flight
 * request, resolving the first with null so callers aren't left hanging.
 *
 * `DirectoryPickerModal` reads `pending` to decide when to render, and calls
 * `resolve` when the user confirms or cancels.
 */
import { create } from 'zustand';

export interface PickRequest {
  mode: 'directory' | 'file';
}

interface DirectoryPickerState {
  pending: PickRequest | null;
  pickDirectory: (opts: { mode?: 'directory' | 'file' }) => Promise<string | null>;
  resolve: (path: string | null) => void;
}

let resolver: ((path: string | null) => void) | null = null;

export const useDirectoryPicker = create<DirectoryPickerState>((set, get) => ({
  pending: null,
  pickDirectory: (opts) =>
    new Promise<string | null>((res) => {
      // One prompt at a time: a second request displaces the first. Resolve the
      // stranded resolver with null so its caller is unblocked instead of hanging.
      const displaced = resolver;
      resolver = res;
      set({ pending: { mode: opts.mode ?? 'directory' } });
      displaced?.(null);
    }),
  resolve: (path) => {
    const r = resolver;
    if (!get().pending || !r) return;
    resolver = null;
    set({ pending: null });
    r(path);
  },
}));
