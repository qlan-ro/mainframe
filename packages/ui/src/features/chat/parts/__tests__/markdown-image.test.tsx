// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getExternalFile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/files', () => ({ getExternalFile }));
vi.mock('@/lib/api/http', () => ({ apiBase: () => 'http://daemon' }));

import { IMAGE_LOAD_TIMEOUT_MS, MarkdownImage } from '../MarkdownImage';
import { resetLocalImageCache } from '@/lib/files/local-image';

beforeEach(() => {
  resetLocalImageCache();
  getExternalFile.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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

  describe('reserved box', () => {
    const frameOf = (el: Element | null) => el?.closest('[data-image-frame]') ?? null;

    it('keeps one fixed-height frame from the skeleton to the loaded local image', async () => {
      let resolve: (value: string) => void = () => {};
      getExternalFile.mockReturnValue(new Promise<string>((r) => (resolve = r)));
      render(<MarkdownImage src="/tmp/a.png" alt="x" />);
      const skeleton = screen.getByTestId('chat-markdown-image-skeleton');
      expect(skeleton).toHaveClass('h-60');

      resolve('AAAA');
      const trigger = await screen.findByTestId('chat-image-zoom-trigger');
      expect(frameOf(trigger)).toHaveClass('h-60');
      expect(trigger.querySelector('img')).toHaveClass('max-h-60', 'max-w-full', 'object-contain');
    });

    it('reserves the frame for a remote image before it loads and keeps it after', () => {
      const { container } = render(<MarkdownImage src="https://x.com/a.png" alt="a" />);
      const img = container.querySelector('img')!;
      const frame = frameOf(img)!;
      expect(frame).toHaveClass('h-60', 'animate-pulse');

      fireEvent.load(img);
      expect(frame).toHaveClass('h-60');
      expect(frame).not.toHaveClass('animate-pulse');
      expect(img).toHaveClass('max-h-60', 'max-w-full', 'object-contain');
    });

    it('gives up on a remote image whose request hangs', () => {
      vi.useFakeTimers();
      const { container } = render(<MarkdownImage src="https://x.com/slow.png" alt="Slow" />);
      act(() => vi.advanceTimersByTime(IMAGE_LOAD_TIMEOUT_MS - 1));
      expect(container.querySelector('img')).not.toBeNull();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByTestId('chat-markdown-image-unavailable')).toHaveTextContent('Slow (image unavailable)');
      expect(container.querySelector('img')).toBeNull();
    });

    it('keeps a remote image that loaded in time', () => {
      vi.useFakeTimers();
      const { container } = render(<MarkdownImage src="https://x.com/a.png" alt="a" />);
      fireEvent.load(container.querySelector('img')!);
      act(() => vi.advanceTimersByTime(IMAGE_LOAD_TIMEOUT_MS * 2));
      expect(container.querySelector('img')).not.toBeNull();
    });

    it('gives up on a local image whose daemon request hangs, and ignores a late answer', async () => {
      vi.useFakeTimers();
      let resolve: (value: string) => void = () => {};
      getExternalFile.mockReturnValue(new Promise<string>((r) => (resolve = r)));
      render(<MarkdownImage src="/tmp/slow.png" alt="Slow" />);
      expect(screen.getByTestId('chat-markdown-image-skeleton')).toBeTruthy();

      act(() => vi.advanceTimersByTime(IMAGE_LOAD_TIMEOUT_MS));
      expect(screen.getByTestId('chat-markdown-image-unavailable')).toHaveTextContent('Slow (image unavailable)');

      await act(async () => resolve('AAAA'));
      expect(screen.queryByTestId('chat-image-zoom-trigger')).toBeNull();
    });

    it('falls back to the alt text when a remote image fails', () => {
      const { container } = render(<MarkdownImage src="https://x.com/a.png" alt="Diagram" />);
      fireEvent.error(container.querySelector('img')!);
      expect(screen.getByTestId('chat-markdown-image-unavailable')).toHaveTextContent('Diagram (image unavailable)');
      expect(container.querySelector('img')).toBeNull();
    });
  });
});
