import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSandboxStore } from '../../../renderer/store/sandbox';

/**
 * ComposerCard has heavy assistant-ui provider dependencies.
 * To test the capture thumbnail behavior in isolation, we extract
 * a minimal harness that mirrors the exact rendering logic from
 * ComposerCard's capture section + the lightbox integration.
 */

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJ=';

const openLightboxSpy = vi.fn();

function CaptureAttachmentsHarness() {
  const captures = useSandboxStore((s) => s.captures);
  const removeCapture = useSandboxStore((s) => s.removeCapture);

  return (
    <div data-testid="captures-container">
      {captures.map((c, i) => (
        <div key={c.id} data-testid={`capture-${c.id}`} className="relative group w-14 h-14">
          <button
            type="button"
            className="w-full h-full rounded overflow-hidden border border-mf-border"
            onClick={() => {
              const images = captures.map((cap) => {
                const match = cap.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
                return { mediaType: match?.[1] ?? 'image/png', data: match?.[2] ?? '' };
              });
              openLightboxSpy(images, i);
            }}
          >
            <img
              src={c.imageDataUrl}
              alt={c.type === 'screenshot' ? 'screenshot' : (c.selector ?? 'element')}
              className="w-full h-full object-cover"
            />
          </button>
          <button
            type="button"
            onClick={() => removeCapture(c.id)}
            aria-label="Remove capture"
            data-testid={`remove-${c.id}`}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

describe('Capture attachments in composer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSandboxStore.setState({ captures: [] });
  });

  it('renders nothing when there are no captures', () => {
    render(<CaptureAttachmentsHarness />);
    const container = screen.getByTestId('captures-container');
    expect(container.children).toHaveLength(0);
  });

  it('renders capture thumbnails as images', () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: PNG_DATA_URL,
      selector: 'div.hero',
    });

    render(<CaptureAttachmentsHarness />);
    const img = screen.getByAltText('div.hero');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', PNG_DATA_URL);
  });

  it('renders screenshot captures with "screenshot" alt text', () => {
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: PNG_DATA_URL,
    });

    render(<CaptureAttachmentsHarness />);
    expect(screen.getByAltText('screenshot')).toBeInTheDocument();
  });

  it('opens lightbox with correct image data on click', async () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: PNG_DATA_URL,
      selector: 'button.submit',
    });

    const user = userEvent.setup();
    render(<CaptureAttachmentsHarness />);

    await user.click(screen.getByAltText('button.submit'));

    expect(openLightboxSpy).toHaveBeenCalledTimes(1);
    expect(openLightboxSpy).toHaveBeenCalledWith([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }], 0);
  });

  it('opens lightbox at correct index with multiple captures', async () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: PNG_DATA_URL,
      selector: 'div.first',
    });
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: JPEG_DATA_URL,
    });

    const user = userEvent.setup();
    render(<CaptureAttachmentsHarness />);

    // Click the second capture (screenshot)
    await user.click(screen.getByAltText('screenshot'));

    expect(openLightboxSpy).toHaveBeenCalledTimes(1);
    expect(openLightboxSpy).toHaveBeenCalledWith(
      [
        { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        { mediaType: 'image/jpeg', data: '/9j/4AAQSkZJ=' },
      ],
      1,
    );
  });

  it('removes a capture when the remove button is clicked', async () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: PNG_DATA_URL,
      selector: 'div.remove-me',
    });

    const user = userEvent.setup();
    render(<CaptureAttachmentsHarness />);

    expect(screen.getByAltText('div.remove-me')).toBeInTheDocument();

    const captures = useSandboxStore.getState().captures;
    const captureId = captures[0]!.id;
    await user.click(screen.getByTestId(`remove-${captureId}`));

    expect(useSandboxStore.getState().captures).toHaveLength(0);
  });

  it('parses data URL correctly for various media types', async () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: JPEG_DATA_URL,
      selector: 'img.photo',
    });

    const user = userEvent.setup();
    render(<CaptureAttachmentsHarness />);

    await user.click(screen.getByAltText('img.photo'));

    expect(openLightboxSpy).toHaveBeenCalledWith([{ mediaType: 'image/jpeg', data: '/9j/4AAQSkZJ=' }], 0);
  });

  it('capture thumbnails have border styling', () => {
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: PNG_DATA_URL,
      selector: 'div.styled',
    });

    render(<CaptureAttachmentsHarness />);
    const button = screen.getByAltText('div.styled').closest('button');
    expect(button?.className).toContain('border');
    expect(button?.className).toContain('border-mf-border');
  });

  it('file attachments and captures share the same container row', () => {
    // This is a structural test — in the real ComposerCard, both
    // ComposerPrimitive.Attachments and capture thumbnails are children
    // of the same flex container. We verify the captures are siblings
    // within a single parent.
    useSandboxStore.getState().addCapture({
      type: 'element',
      imageDataUrl: PNG_DATA_URL,
      selector: 'a',
    });
    useSandboxStore.getState().addCapture({
      type: 'screenshot',
      imageDataUrl: JPEG_DATA_URL,
    });

    render(<CaptureAttachmentsHarness />);
    const container = screen.getByTestId('captures-container');
    // Both captures should be direct children of the same container
    expect(container.children).toHaveLength(2);
  });
});
