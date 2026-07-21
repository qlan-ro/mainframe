import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { SessionAttachment } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

const getAttachment = vi.fn();
vi.mock('@/lib/api/attachments', () => ({ getAttachment: (...a: unknown[]) => getAttachment(...a) }));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

import { SessionAttachmentsGrid } from '../SessionAttachmentsGrid';

const renderGrid = (ui: ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

const IMG: SessionAttachment = { id: 'img1', name: 'p.png', mediaType: 'image/png', sizeBytes: 1, kind: 'image' };
const DOC: SessionAttachment = { id: 'doc1', name: 'r.pdf', mediaType: 'application/pdf', sizeBytes: 1, kind: 'file' };

beforeEach(() => {
  getAttachment.mockReset().mockImplementation((_p: number, _c: string, id: string) =>
    Promise.resolve({
      name: id === 'img1' ? 'p.png' : 'r.pdf',
      mediaType: id === 'img1' ? 'image/png' : 'application/pdf',
      sizeBytes: 1,
      kind: id === 'img1' ? 'image' : 'file',
      data: 'AAAA',
    }),
  );
});

describe('SessionAttachmentsGrid', () => {
  it('renders a thumb per attachment and a file pill for non-images', async () => {
    renderGrid(<SessionAttachmentsGrid chatId="chat-1" attachments={[IMG, DOC]} />);
    expect(screen.getByTestId('sidebar-attachment-img1')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-attachment-doc1')).toBeInTheDocument();
    await waitFor(() => expect(getAttachment).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('sidebar-attachment-doc1')).toHaveTextContent('r.pdf');
  });

  it('opens the lightbox when an image thumb is clicked', async () => {
    renderGrid(<SessionAttachmentsGrid chatId="chat-1" attachments={[IMG]} />);
    // Wait for the image data to load, not just for the fetch to fire: the thumb
    // opens the lightbox only once its data is in state, so clicking earlier is a no-op.
    await screen.findByRole('img');
    fireEvent.click(screen.getByTestId('sidebar-attachment-img1'));
    await waitFor(() => expect(screen.getByTestId('image-lightbox-dialog')).toBeInTheDocument());
  });

  it('renders nothing for an empty attachment list', () => {
    const { container } = renderGrid(<SessionAttachmentsGrid chatId="chat-1" attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
