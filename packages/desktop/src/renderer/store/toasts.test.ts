import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from './toasts';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('adds toast with chatId', () => {
    useToastStore.getState().add('success', 'Done', 'Task finished', 'chat-123');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.chatId).toBe('chat-123');
    expect(toasts[0]!.title).toBe('Done');
    expect(toasts[0]!.description).toBe('Task finished');
  });

  it('adds toast without chatId', () => {
    useToastStore.getState().add('info', 'Hello');
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.chatId).toBeUndefined();
  });

  it('dismisses a toast by id', () => {
    useToastStore.getState().add('success', 'First');
    useToastStore.getState().add('error', 'Second');
    const id = useToastStore.getState().toasts[0]!.id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]!.title).toBe('Second');
  });
});
