import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ImageAttachmentPreview } from '../ImageAttachmentPreview.js';

vi.mock('@assistant-ui/react', () => ({
  AttachmentPrimitive: {
    Root: (props: { children: React.ReactNode; className?: string }) => (
      <div data-testid="attachment-root" className={props.className}>
        {props.children}
      </div>
    ),
    Remove: (props: { children: React.ReactNode; 'aria-label'?: string; className?: string }) => (
      <button aria-label={props['aria-label']} className={props.className}>
        {props.children}
      </button>
    ),
  },
  useAttachment: () => ({
    name: 'screenshot1.png',
    content: [{ type: 'image', image: 'data:image/png;base64,AAA' }],
  }),
}));

vi.mock('../../MainframeRuntimeProvider', () => ({
  useMainframeRuntime: () => ({ openLightbox: () => {} }),
}));

describe('ImageAttachmentPreview', () => {
  it('renders the attachment name as a caption beneath the thumb', () => {
    render(<ImageAttachmentPreview />);
    const caption = screen.getByTestId('attachment-name');
    expect(caption.textContent).toBe('screenshot1');
  });
});
