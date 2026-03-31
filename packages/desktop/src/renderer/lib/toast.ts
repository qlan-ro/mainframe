import { useToastStore } from '../store/toasts';

export const toast = {
  success: (title: string, description?: string) => useToastStore.getState().add('success', title, description),
  error: (title: string, description?: string) => useToastStore.getState().add('error', title, description),
  info: (title: string, description?: string) => useToastStore.getState().add('info', title, description),
};
