// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getExternalFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/files', () => ({ getExternalFile }));
vi.mock('@/lib/api/http', () => ({ apiBase: () => 'http://daemon' }));

import { MarkdownImage } from '../MarkdownImage';
import { resetLocalImageCache } from '@/lib/files/local-image';

beforeEach(() => {
  resetLocalImageCache();
  getExternalFile.mockReset();
});
afterEach(cleanup);

describe('MarkdownImage', () => {
  it('shows the skeleton while loading', () => {
    getExternalFile.mockReturnValue(new Promise(() => {}));
    render(<MarkdownImage src="/tmp/a.png" alt="x" />);
    expect(screen.getByTestId('chat-markdown-image-skeleton')).toBeTruthy();
  });

  it('renders a zoomable image once loaded and opens the lightbox', async () => {
    getExternalFile.mockResolvedValue('AAAA');
    render(<MarkdownImage src="file:///tmp/a.png" alt="x" />);
    const trigger = await screen.findByTestId('chat-image-zoom-trigger');
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(getExternalFile).toHaveBeenCalledWith(0, '/tmp/a.png', 'base64');
    fireEvent.click(trigger);
    expect(await screen.findByTestId('chat-image-zoom-dialog')).toBeTruthy();
  });

  it('renders the alt link plus suffix and no img on failure', async () => {
    getExternalFile.mockRejectedValue(new Error('404'));
    const { container } = render(<MarkdownImage src="/tmp/missing.png" alt="Shot" />);
    await screen.findByTestId('chat-markdown-image-unavailable');
    expect(screen.getByText('Shot')).toBeTruthy();
    expect(screen.getByText(/image unavailable/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to the base name when alt is empty', async () => {
    getExternalFile.mockRejectedValue(new Error('404'));
    render(<MarkdownImage src="/tmp/dir/missing.png" alt="" />);
    expect(await screen.findByText('missing.png')).toBeTruthy();
  });

  it('does not fetch a non-image extension', async () => {
    render(<MarkdownImage src="/tmp/a.txt" alt="t" />);
    await screen.findByTestId('chat-markdown-image-unavailable');
    expect(getExternalFile).not.toHaveBeenCalled();
  });

  it('renders https and data sources as a plain img without fetching', () => {
    const { container } = render(
      <>
        <MarkdownImage src="https://x.com/a.png" alt="a" />
        <MarkdownImage src="data:image/png;base64,AAAA" alt="b" />
      </>,
    );
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(getExternalFile).not.toHaveBeenCalled();
  });

  it('fetches once for re-renders and a second instance of the same path', async () => {
    getExternalFile.mockResolvedValue('AAAA');
    const { rerender } = render(<MarkdownImage src="/tmp/a.png" alt="x" />);
    rerender(<MarkdownImage src="/tmp/a.png" alt="x" />);
    render(<MarkdownImage src="/tmp/a.png" alt="x" />);
    await waitFor(() => expect(screen.getAllByTestId('chat-image-zoom-trigger')).toHaveLength(2));
    expect(getExternalFile).toHaveBeenCalledTimes(1);
  });
});
