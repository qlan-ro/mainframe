import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToolResultExpand } from '../ToolResultExpand.js';
import { useChatsStore } from '../../../../store/chats.js';

afterEach(() => vi.restoreAllMocks());

describe('ToolResultExpand', () => {
  it('shows truncated text + size button, fetches full on click, collapses back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, data: { content: 'THE WHOLE THING' } }),
      })) as never,
    );
    render(<ToolResultExpand chatId="c1" toolUseId="tu_1" truncatedContent="head…[truncated]" fullBytes={1234567} />);
    expect(screen.getByText(/head…\[truncated\]/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    await waitFor(() => expect(screen.getByText('THE WHOLE THING')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(screen.getByText(/head…\[truncated\]/)).toBeTruthy();
    expect(screen.queryByText('THE WHOLE THING')).toBeNull();
  });

  it('shows an unavailable state on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as never);
    render(<ToolResultExpand chatId="c1" toolUseId="tu_x" truncatedContent="t…[truncated]" fullBytes={9000} />);
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    await waitFor(() => expect(screen.getByText(/full output no longer available/i)).toBeTruthy());
    expect(screen.getByText(/t…\[truncated\]/)).toBeTruthy();
  });

  it('expanding does not write full content back into the chats store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, data: { content: 'X'.repeat(500000) } }),
      })) as never,
    );
    const before = JSON.stringify(useChatsStore.getState().messages.get('c1') ?? []);
    render(<ToolResultExpand chatId="c1" toolUseId="tu_1" truncatedContent="t…[truncated]" fullBytes={500000} />);
    fireEvent.click(screen.getByRole('button', { name: /show full output/i }));
    await waitFor(() => expect(screen.getByText(/X{100,}/)).toBeTruthy());
    const after = JSON.stringify(useChatsStore.getState().messages.get('c1') ?? []);
    expect(after).toBe(before);
  });
});
