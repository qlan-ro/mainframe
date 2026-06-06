/**
 * ZoomableImage — behavior tests.
 *
 * Strategy:
 *  - Render the component directly; no external dependencies to mock.
 *  - The Radix Dialog opens synchronously in jsdom (click-driven), but its
 *    content is mounted in a portal (document.body). `screen.findByTestId`
 *    (async) is used for the dialog-open assertion to handle any microtask
 *    flushing Radix schedules before the portal content appears.
 *  - All expected values are hardcoded — no logic mirrors the component.
 *
 * Behaviors covered:
 *  1. Trigger renders with correct testid and aria-label; thumbnail img has
 *     the passed src and className; dialog is NOT in the DOM initially.
 *  2. Clicking the trigger opens the dialog; dialog content contains a full-
 *     size img with the same src.
 *  3. The alt prop is forwarded to the thumbnail img.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomableImage } from '../ZoomableImage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ZoomableImage', () => {
  // -------------------------------------------------------------------------
  // 1. Initial render — trigger present, dialog absent
  // -------------------------------------------------------------------------

  it('renders the zoom trigger button with the thumbnail img and no open dialog', () => {
    render(<ZoomableImage src="https://example.com/photo.png" className="size-16" />);

    const trigger = screen.getByTestId('chat-image-zoom-trigger');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-label', 'View image full size');

    const thumbnail = trigger.querySelector('img');
    expect(thumbnail).not.toBeNull();
    expect(thumbnail).toHaveAttribute('src', 'https://example.com/photo.png');
    // className is forwarded verbatim to the thumbnail
    expect(thumbnail?.className).toContain('size-16');

    // Dialog content must not be in the DOM before any interaction
    expect(screen.queryByTestId('chat-image-zoom-dialog')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. Click trigger → dialog opens with full-size img
  // -------------------------------------------------------------------------

  it('opens the zoom dialog containing the full-size img when the trigger is clicked', async () => {
    render(<ZoomableImage src="https://example.com/photo.png" />);

    const trigger = screen.getByTestId('chat-image-zoom-trigger');
    fireEvent.click(trigger);

    // Radix portals the content into document.body; findByTestId awaits the
    // DOM update so the assertion is stable without an explicit act() call.
    const dialog = await screen.findByTestId('chat-image-zoom-dialog');
    expect(dialog).toBeInTheDocument();

    const fullSizeImg = dialog.querySelector('img');
    expect(fullSizeImg).not.toBeNull();
    expect(fullSizeImg).toHaveAttribute('src', 'https://example.com/photo.png');
  });

  // -------------------------------------------------------------------------
  // 3. alt prop forwarded to thumbnail
  // -------------------------------------------------------------------------

  it('forwards the alt prop to the thumbnail img', () => {
    render(<ZoomableImage src="https://example.com/cat.jpg" alt="a cat" />);

    const trigger = screen.getByTestId('chat-image-zoom-trigger');
    const thumbnail = trigger.querySelector('img');
    expect(thumbnail).toHaveAttribute('alt', 'a cat');
  });
});
