import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageThumbs } from './ImageThumbs';

describe('ImageThumbs (assistant image rendering)', () => {
  it('renders nothing when imageBlocks is empty', () => {
    const { container } = render(<ImageThumbs imageBlocks={[]} openLightbox={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an <img> with correct data-URI src for a base64 image block', () => {
    const block = { type: 'image' as const, mediaType: 'image/png', data: 'abc123==' };
    render(<ImageThumbs imageBlocks={[block]} openLightbox={vi.fn()} />);

    const img = screen.getByRole('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123==');
  });

  it('renders multiple images when multiple image blocks are provided', () => {
    const blocks = [
      { type: 'image' as const, mediaType: 'image/png', data: 'first==' },
      { type: 'image' as const, mediaType: 'image/jpeg', data: 'second==' },
    ];
    render(<ImageThumbs imageBlocks={blocks} openLightbox={vi.fn()} />);

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', 'data:image/png;base64,first==');
    expect(images[1]).toHaveAttribute('src', 'data:image/jpeg;base64,second==');
  });

  it('calls openLightbox with correct args when thumbnail is clicked', async () => {
    const user = userEvent.setup();
    const openLightbox = vi.fn();
    const blocks = [{ type: 'image' as const, mediaType: 'image/png', data: 'click==' }];
    render(<ImageThumbs imageBlocks={blocks} openLightbox={openLightbox} />);

    const thumb = screen.getByTestId('message-image-thumb');
    await user.click(thumb);

    expect(openLightbox).toHaveBeenCalledOnce();
    expect(openLightbox).toHaveBeenCalledWith(blocks, 0);
  });
});
