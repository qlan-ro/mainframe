/**
 * ImageLightbox unit tests.
 *
 * A controlled multi-image lightbox: the parent owns the open index (null =
 * closed) and ImageLightbox renders prev/next/counter + keyboard nav, wrapping
 * around at the ends. Restores the desktop multi-image gallery affordance that
 * single-image ZoomableImage didn't cover.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImageLightbox } from '../ImageLightbox';

const THREE = [
  { src: 'a.png', alt: 'A' },
  { src: 'b.png', alt: 'B' },
  { src: 'c.png', alt: 'C' },
];

describe('ImageLightbox', () => {
  it('renders nothing when index is null', () => {
    render(<ImageLightbox images={THREE} index={null} onIndexChange={vi.fn()} />);
    expect(screen.queryByTestId('image-lightbox-dialog')).toBeNull();
  });

  it('renders the image at the given index when open', () => {
    render(<ImageLightbox images={THREE} index={1} onIndexChange={vi.fn()} />);
    const img = screen.getByTestId('image-lightbox-current') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('b.png');
  });

  it('shows a "current / total" counter', () => {
    render(<ImageLightbox images={THREE} index={1} onIndexChange={vi.fn()} />);
    expect(screen.getByTestId('image-lightbox-counter').textContent).toBe('2 / 3');
  });

  it('next advances the index', () => {
    const onIndexChange = vi.fn();
    render(<ImageLightbox images={THREE} index={0} onIndexChange={onIndexChange} />);
    fireEvent.click(screen.getByTestId('image-lightbox-next'));
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('next wraps from the last image to the first', () => {
    const onIndexChange = vi.fn();
    render(<ImageLightbox images={THREE} index={2} onIndexChange={onIndexChange} />);
    fireEvent.click(screen.getByTestId('image-lightbox-next'));
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('prev wraps from the first image to the last', () => {
    const onIndexChange = vi.fn();
    render(<ImageLightbox images={THREE} index={0} onIndexChange={onIndexChange} />);
    fireEvent.click(screen.getByTestId('image-lightbox-prev'));
    expect(onIndexChange).toHaveBeenCalledWith(2);
  });

  it('ArrowRight advances the index', () => {
    const onIndexChange = vi.fn();
    render(<ImageLightbox images={THREE} index={0} onIndexChange={onIndexChange} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onIndexChange).toHaveBeenCalledWith(1);
  });

  it('ArrowLeft decrements the index', () => {
    const onIndexChange = vi.fn();
    render(<ImageLightbox images={THREE} index={1} onIndexChange={onIndexChange} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onIndexChange).toHaveBeenCalledWith(0);
  });

  it('single image: no prev/next controls and no counter', () => {
    render(<ImageLightbox images={[{ src: 'solo.png' }]} index={0} onIndexChange={vi.fn()} />);
    expect(screen.queryByTestId('image-lightbox-next')).toBeNull();
    expect(screen.queryByTestId('image-lightbox-prev')).toBeNull();
    expect(screen.queryByTestId('image-lightbox-counter')).toBeNull();
  });
});
