import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ToolResultImageThumbs } from '../ToolResultImageThumbs';
import { getToolImage } from '@/lib/api/tool-images';

vi.mock('@/lib/api/tool-images', () => ({ getToolImage: vi.fn() }));
const observers: IntersectionObserverCallback[] = [];
const image = (index: number) => ({
  mediaType: 'image/png',
  data: '',
  uri: `/api/chats/chat/tool-result/tool/images/${index}?v=0123456789abcdef`,
});

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function reveal(index: number) {
  act(() => observers[index]!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
}

it('does not fetch offscreen images, then resolves a visible thumbnail without expanding its tool', async () => {
  vi.mocked(getToolImage).mockResolvedValue({ mediaType: 'image/png', data: 'AAAA' });
  render(<ToolResultImageThumbs toolCallId="tool" images={[image(0)]} />);
  expect(getToolImage).not.toHaveBeenCalled();
  reveal(0);
  const thumbnail = screen.getByTestId('tool-result-image-tool-0');
  await waitFor(() => expect(thumbnail.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA'));
  expect(getToolImage).toHaveBeenCalledExactlyOnceWith(image(0).uri);
  fireEvent.load(thumbnail.querySelector('img')!);
  fireEvent.click(screen.getByLabelText('Open image'));
  expect(screen.getByTestId('image-lightbox-current')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
});

it('fetches the next gallery image on navigation even when its thumbnail is offscreen', async () => {
  let resolveNext!: (value: { mediaType: string; data: string }) => void;
  vi.mocked(getToolImage)
    .mockResolvedValueOnce({ mediaType: 'image/png', data: 'AAAA' })
    .mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
    );
  render(<ToolResultImageThumbs toolCallId="tool" images={[image(0), image(1)]} />);
  reveal(0);
  await waitFor(() =>
    expect(screen.getByTestId('tool-result-image-tool-0').querySelector('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    ),
  );
  fireEvent.load(screen.getByTestId('tool-result-image-tool-0').querySelector('img')!);
  fireEvent.click(screen.getByLabelText('Open image'));
  fireEvent.click(screen.getByLabelText('Next image'));
  expect(screen.getByLabelText('Loading image')).toBeInTheDocument();
  expect(getToolImage).toHaveBeenCalledWith(image(1).uri);
  await act(async () => resolveNext({ mediaType: 'image/png', data: 'BBBB' }));
  expect(screen.getByTestId('image-lightbox-current')).toHaveAttribute('src', 'data:image/png;base64,BBBB');
});

it('shows an unavailable thumbnail when its deferred image no longer exists', async () => {
  vi.mocked(getToolImage).mockRejectedValue(new Error('Not found'));
  render(<ToolResultImageThumbs toolCallId="tool" images={[image(0)]} />);
  reveal(0);
  await waitFor(() => expect(screen.getByTestId('tool-result-image-tool-0')).toHaveAttribute('data-state', 'error'));
  expect(screen.queryByLabelText('Open image')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Retry image')).toBeInTheDocument();
});

it('retries a failed visible image without requiring the row to scroll away', async () => {
  vi.mocked(getToolImage)
    .mockRejectedValueOnce(new Error('Disconnected'))
    .mockResolvedValueOnce({ mediaType: 'image/png', data: 'AAAA' });
  render(<ToolResultImageThumbs toolCallId="tool" images={[image(0)]} />);
  reveal(0);
  await waitFor(() => expect(screen.getByLabelText('Retry image')).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Retry image'));
  reveal(1);
  await waitFor(() =>
    expect(screen.getByTestId('tool-result-image-tool-0').querySelector('img')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    ),
  );
  fireEvent.load(screen.getByTestId('tool-result-image-tool-0').querySelector('img')!);
  expect(screen.getByLabelText('Open image')).toBeInTheDocument();
  expect(getToolImage).toHaveBeenCalledTimes(2);
});

it('retries a failed gallery image while keeping the gallery open', async () => {
  vi.mocked(getToolImage)
    .mockResolvedValueOnce({ mediaType: 'image/png', data: 'AAAA' })
    .mockRejectedValueOnce(new Error('Disconnected'))
    .mockResolvedValueOnce({ mediaType: 'image/png', data: 'BBBB' });
  render(<ToolResultImageThumbs toolCallId="tool" images={[image(0), image(1)]} />);
  reveal(0);
  const thumb = screen.getByTestId('tool-result-image-tool-0');
  await waitFor(() => expect(thumb.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA'));
  fireEvent.load(thumb.querySelector('img')!);
  fireEvent.click(screen.getByLabelText('Open image'));
  fireEvent.click(screen.getByLabelText('Next image'));
  await waitFor(() => expect(screen.getByLabelText('Image unavailable')).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Retry image' }));
  await waitFor(() =>
    expect(screen.getByTestId('image-lightbox-current')).toHaveAttribute('src', 'data:image/png;base64,BBBB'),
  );
  expect(getToolImage).toHaveBeenCalledTimes(3);
});
