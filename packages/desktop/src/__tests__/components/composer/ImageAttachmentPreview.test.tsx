import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

// Lightbox spy — captured by the mock provider
const openLightboxSpy = vi.fn();

// Mock MainframeRuntimeProvider context
vi.mock('../../../renderer/components/chat/assistant-ui/MainframeRuntimeProvider', () => ({
  useMainframeRuntime: () => ({
    chatId: 'chat-1',
    composerError: null,
    dismissComposerError: vi.fn(),
    openLightbox: openLightboxSpy,
    closeLightbox: vi.fn(),
    navigateLightbox: vi.fn(),
    lightbox: null,
    pendingPermission: undefined,
    respondToPermission: vi.fn(),
  }),
}));

// Mock assistant-ui hooks
vi.mock('@assistant-ui/react', async () => {
  const React = await import('react');
  return {
    useAttachment: vi.fn(),
    AttachmentPrimitive: {
      Root: ({ children, className }: { children: React.ReactNode; className?: string }) =>
        React.createElement('div', { className, 'data-testid': 'attachment-root' }, children),
      Remove: ({ children, className }: { children: React.ReactNode; className?: string }) =>
        React.createElement('button', { className, 'data-testid': 'attachment-remove' }, children),
    },
  };
});

import { useAttachment } from '@assistant-ui/react';
import { ImageAttachmentPreview } from '../../../renderer/components/chat/assistant-ui/composer/ImageAttachmentPreview';

describe('ImageAttachmentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an image thumbnail when attachment has image content', () => {
    vi.mocked(useAttachment).mockReturnValue({
      name: 'test.png',
      content: [{ type: 'image', image: PNG_DATA_URL }],
    } as ReturnType<typeof useAttachment>);

    render(<ImageAttachmentPreview />);
    const img = screen.getByAltText('test.png');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', PNG_DATA_URL);
  });

  it('renders file extension fallback when no image content', () => {
    vi.mocked(useAttachment).mockReturnValue({
      name: 'readme.txt',
      content: [{ type: 'text', text: 'hello' }],
    } as ReturnType<typeof useAttachment>);

    render(<ImageAttachmentPreview />);
    expect(screen.getByText('txt')).toBeInTheDocument();
  });

  it('opens lightbox with parsed mediaType and data on image click', async () => {
    vi.mocked(useAttachment).mockReturnValue({
      name: 'screenshot.png',
      content: [{ type: 'image', image: PNG_DATA_URL }],
    } as ReturnType<typeof useAttachment>);

    const user = userEvent.setup();
    render(<ImageAttachmentPreview />);

    const img = screen.getByAltText('screenshot.png');
    await user.click(img);

    expect(openLightboxSpy).toHaveBeenCalledTimes(1);
    expect(openLightboxSpy).toHaveBeenCalledWith([{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }], 0);
  });

  it('does not call openLightbox when clicking non-image attachment', async () => {
    vi.mocked(useAttachment).mockReturnValue({
      name: 'data.json',
      content: [{ type: 'text', text: '{}' }],
    } as ReturnType<typeof useAttachment>);

    const user = userEvent.setup();
    render(<ImageAttachmentPreview />);

    // Non-image fallback is a div, not a button — clicking it should not open lightbox
    const fallback = screen.getByText('json');
    await user.click(fallback);
    expect(openLightboxSpy).not.toHaveBeenCalled();
  });

  it('has a border on the image thumbnail', () => {
    vi.mocked(useAttachment).mockReturnValue({
      name: 'pic.png',
      content: [{ type: 'image', image: PNG_DATA_URL }],
    } as ReturnType<typeof useAttachment>);

    render(<ImageAttachmentPreview />);
    const button = screen.getByAltText('pic.png').closest('button');
    expect(button?.className).toContain('border');
    expect(button?.className).toContain('border-mf-border');
  });
});
