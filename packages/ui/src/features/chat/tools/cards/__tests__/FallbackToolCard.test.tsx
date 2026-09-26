/**
 * Tests for FallbackToolCard — the default/unregistered-tool card, extended
 * with tool-result image thumbnails (todo #363).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ToolCallMessagePartProps, ToolCallMessagePartStatus } from '@assistant-ui/react';
import { FallbackToolCard } from '../FallbackToolCard';

const noop = () => {};
const doneStatus: ToolCallMessagePartStatus = { type: 'complete' };

function renderCard(overrides: Partial<ToolCallMessagePartProps> = {}) {
  const defaults: ToolCallMessagePartProps = Object.assign(
    {
      type: 'tool-call' as const,
      toolCallId: 'fb-1',
      toolName: 'some_unregistered_tool',
      args: {},
      argsText: '',
      result: undefined,
      isError: false,
      status: doneStatus,
      addResult: noop,
      resume: noop,
      respondToApproval: noop,
    },
    overrides,
  );
  return render(<FallbackToolCard {...defaults} />);
}

describe('FallbackToolCard — text result (unchanged behavior)', () => {
  it('shows the string result under Result once expanded', () => {
    renderCard({ result: 'plain text result' });
    fireEvent.click(screen.getByTestId('chat-tool-fallback-trigger'));
    expect(screen.getByTestId('chat-tool-fallback-result')).toHaveTextContent('plain text result');
  });
});

describe('FallbackToolCard — image result (todo #363)', () => {
  const imageResult = { content: '', images: [{ mediaType: 'image/png', data: 'AAAA' }] };

  it('renders a thumbnail beside the trigger while collapsed', () => {
    renderCard({ result: imageResult });
    expect(screen.getByTestId('tool-result-image-fb-1-0')).toBeInTheDocument();
  });

  it('clicking the thumbnail opens the lightbox without toggling the card', () => {
    renderCard({ result: imageResult });
    const thumb = screen.getByTestId('tool-result-image-fb-1-0');
    const img = thumb.querySelector('img');
    if (img) fireEvent.load(img);

    fireEvent.click(screen.getByLabelText('Open image'));

    expect(screen.getByTestId('image-lightbox-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('chat-tool-fallback-card')).toHaveAttribute('data-state', 'closed');
  });

  it('does not leak base64 image data or JSON into the DOM', () => {
    renderCard({ result: imageResult });
    fireEvent.click(screen.getByTestId('chat-tool-fallback-trigger'));
    expect(screen.queryByText(/AAAA/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('"images"');
  });

  it('shows no Result section when the image result carries no text', () => {
    renderCard({ result: imageResult });
    fireEvent.click(screen.getByTestId('chat-tool-fallback-trigger'));
    expect(screen.queryByTestId('chat-tool-fallback-result')).not.toBeInTheDocument();
  });

  it('still shows accompanying text alongside the thumbnail', () => {
    renderCard({ result: { content: 'saved to disk', images: [{ mediaType: 'image/png', data: 'AAAA' }] } });
    fireEvent.click(screen.getByTestId('chat-tool-fallback-trigger'));
    expect(screen.getByTestId('chat-tool-fallback-result')).toHaveTextContent('saved to disk');
  });
});
