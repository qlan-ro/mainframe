/**
 * PanelAttachmentsGrid — unit tests.
 *
 * Behaviors covered:
 *  - one tile per attachment, images and files alike
 *  - only images are fetched: a file tile renders from its name alone
 *  - nothing is fetched while the section is closed — Context is expanded by
 *    default, so an ungated grid would fire N base64 reads per session switch
 *  - an image tile opens the lightbox; a file tile is inert
 *
 * Replaces `context-panel/__tests__/SessionAttachmentsGrid.test.tsx`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react';
import type { SessionAttachment } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@v2/components/ui/tooltip';

const getAttachment = vi.fn();
vi.mock('@/lib/api/attachments', () => ({ getAttachment: (...a: unknown[]) => getAttachment(...a) }));

const { PanelAttachmentsGrid } = await import('../PanelAttachmentsGrid');

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });

const image = (id: string, name: string): SessionAttachment => ({
  id,
  name,
  mediaType: 'image/png',
  sizeBytes: 2048,
  kind: 'image',
});
const file = (id: string, name: string): SessionAttachment => ({
  id,
  name,
  mediaType: 'application/pdf',
  sizeBytes: 4096,
  kind: 'file',
});

const attachments = [image('att-1', 'shot.png'), file('att-2', 'report.pdf')];

beforeEach(() => {
  getAttachment.mockReset().mockResolvedValue({
    name: 'shot.png',
    mediaType: 'image/png',
    sizeBytes: 2048,
    kind: 'image',
    data: 'QUJD',
  });
});

describe('PanelAttachmentsGrid', () => {
  it('renders one tile per attachment', () => {
    render(<PanelAttachmentsGrid port={31415} chatId="chat-9" attachments={attachments} enabled />);
    expect(screen.getByTestId('session-panel-attachment-grid')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-attachment-att-1')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-attachment-att-2')).toBeInTheDocument();
  });

  it('labels a file tile with its extension and never fetches its bytes', async () => {
    render(<PanelAttachmentsGrid port={31415} chatId="chat-9" attachments={attachments} enabled />);
    await waitFor(() => expect(getAttachment).toHaveBeenCalledTimes(1));
    expect(getAttachment).toHaveBeenCalledWith(31415, 'chat-9', 'att-1');
    expect(screen.getByTestId('session-panel-attachment-att-2')).toHaveTextContent('.pdf');
  });

  it('fetches nothing while the section is closed', () => {
    render(<PanelAttachmentsGrid port={31415} chatId="chat-9" attachments={attachments} enabled={false} />);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('opens the lightbox from an image tile', async () => {
    render(<PanelAttachmentsGrid port={31415} chatId="chat-9" attachments={attachments} enabled />);
    await waitFor(() => expect(getAttachment).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Open shot.png' }));
    expect(await screen.findByTestId('image-lightbox-dialog')).toBeInTheDocument();
  });

  it('leaves a file tile inert', async () => {
    render(<PanelAttachmentsGrid port={31415} chatId="chat-9" attachments={attachments} enabled />);
    fireEvent.click(screen.getByTestId('session-panel-attachment-att-2'));
    expect(screen.queryByTestId('image-lightbox-dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open report.pdf' })).toBeNull();
  });

  it('renders nothing when the session has no attachments', () => {
    const { container } = render(<PanelAttachmentsGrid port={31415} chatId="chat-9" attachments={[]} enabled />);
    expect(container).toBeEmptyDOMElement();
  });
});
