/**
 * Toast details bridge — a toast is one line, its payload often isn't.
 * `mfToast`'s `details` option routes here; ToastDetailsHost (mounted once at
 * the app root) renders whatever is parked as a dialog with the full text.
 */
import { create } from 'zustand';

export interface ToastDetailsPayload {
  title: string;
  description?: string;
  details: string;
}

interface ToastDetailsState {
  payload: ToastDetailsPayload | null;
  show: (payload: ToastDetailsPayload) => void;
  dismiss: () => void;
}

export const useToastDetails = create<ToastDetailsState>((set) => ({
  payload: null,
  show: (payload) => set({ payload }),
  dismiss: () => set({ payload: null }),
}));

export function showToastDetails(payload: ToastDetailsPayload): void {
  useToastDetails.getState().show(payload);
}
