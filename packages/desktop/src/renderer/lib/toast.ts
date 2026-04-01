import { useToastStore } from '../store/toasts';

export const toast = {
  success: (title: string, description?: string, chatId?: string) =>
    useToastStore.getState().add('success', title, description, chatId),
  error: (title: string, description?: string, chatId?: string) =>
    useToastStore.getState().add('error', title, description, chatId),
  info: (title: string, description?: string, chatId?: string) =>
    useToastStore.getState().add('info', title, description, chatId),
};
