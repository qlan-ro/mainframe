/**
 * CaptureContextRow — behavior tests.
 *
 * The component is a pure props component with no assistant-ui hooks, so no
 * mocking is needed — just render with fixed props and assert on the DOM.
 *
 * Behaviors covered:
 *  B1 — element row renders its chip testid, selector in <code>, img with the
 *       resolved src, and the accent-ring span.
 *  B2 — screenshot row renders "Screenshot" text and NO accent-ring.
 *  B3 — element row with annotation renders the annotation text.
 *  B4 — mixed image lookup: imageName resolves by position in the image-only
 *       filtered previews list, not the raw previews list (regression guard).
 *  B5 — imageName not found in previews → no <img>, placeholder shown, chip
 *       testid still present.
 *  B6 — empty rows array → component returns null, container testid absent.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CaptureContextRow } from '../CaptureContextRow';
import type { CaptureRow } from '../../view-model/parse-captures';
import type { MainframeMessageMeta } from '../../view-model/message-meta';

type Previews = MainframeMessageMeta['attachmentPreviews'];

// ---------------------------------------------------------------------------
// B1 — element row: chip, selector, img, accent ring
// ---------------------------------------------------------------------------

describe('CaptureContextRow — B1: element row with selector and matching image', () => {
  it('renders the chip testid, selector text, img src, and accent-ring span', () => {
    const rows: CaptureRow[] = [{ label: 'element1', imageName: 'element1.png', selector: 'nav.sidebar > .rail-icon' }];
    const previews: Previews = [{ name: 'element1.png', kind: 'image' }];
    const imageSrcs = ['data:img1'];

    const { container } = render(<CaptureContextRow rows={rows} imageSrcs={imageSrcs} previews={previews} />);

    // Chip present.
    expect(screen.getByTestId('chat-user-capture-element1')).toBeInTheDocument();

    // Selector rendered in a <code> element.
    expect(screen.getByText('nav.sidebar > .rail-icon')).toBeInTheDocument();

    // Image resolved by name → index 0 → 'data:img1'.
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('data:img1');

    // Accent-ring span present (element capture).
    const ring = container.querySelector('[class*="shadow-[inset"]');
    expect(ring).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B2 — screenshot row: "Screenshot" text, no accent ring
// ---------------------------------------------------------------------------

describe('CaptureContextRow — B2: screenshot row shows "Screenshot" and no accent ring', () => {
  it('renders "Screenshot" and omits the accent-ring span', () => {
    const rows: CaptureRow[] = [{ label: 'screenshot1', imageName: 'screenshot1.png' }];
    const previews: Previews = [{ name: 'screenshot1.png', kind: 'image' }];
    const imageSrcs = ['data:s1'];

    const { container } = render(<CaptureContextRow rows={rows} imageSrcs={imageSrcs} previews={previews} />);

    expect(screen.getByText('Screenshot')).toBeInTheDocument();

    // No accent ring for screenshot rows.
    const ring = container.querySelector('[class*="shadow-[inset"]');
    expect(ring).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B3 — element row with annotation
// ---------------------------------------------------------------------------

describe('CaptureContextRow — B3: element row with annotation renders annotation text', () => {
  it('renders the annotation text below the selector', () => {
    const rows: CaptureRow[] = [
      { label: 'element1', imageName: 'element1.png', selector: '.x', annotation: 'make it bigger' },
    ];
    const previews: Previews = [{ name: 'element1.png', kind: 'image' }];
    const imageSrcs = ['data:x'];

    render(<CaptureContextRow rows={rows} imageSrcs={imageSrcs} previews={previews} />);

    expect(screen.getByText('make it bigger')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// B4 — mixed image lookup: resolves by position in image-only filtered list
// ---------------------------------------------------------------------------

describe('CaptureContextRow — B4: image src resolved by position among image-kind previews only', () => {
  it('picks data:b (index 1) for element1.png when photo.png precedes it in previews', () => {
    const rows: CaptureRow[] = [{ label: 'element1', imageName: 'element1.png', selector: '.y' }];
    // photo.png is at index 0 of the image-kind list → src 'data:a'
    // element1.png is at index 1                       → src 'data:b'
    const previews: Previews = [
      { name: 'photo.png', kind: 'image' },
      { name: 'element1.png', kind: 'image' },
    ];
    const imageSrcs = ['data:a', 'data:b'];

    const { container } = render(<CaptureContextRow rows={rows} imageSrcs={imageSrcs} previews={previews} />);

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // Must be 'data:b', not 'data:a'.
    expect(img!.getAttribute('src')).toBe('data:b');
  });
});

// ---------------------------------------------------------------------------
// B5 — imageName not found → placeholder, no <img>
// ---------------------------------------------------------------------------

describe('CaptureContextRow — B5: imageName absent from previews shows placeholder, no img', () => {
  it('renders the chip testid but no img element when the name is not in previews', () => {
    const rows: CaptureRow[] = [{ label: 'element1', imageName: 'missing.png', selector: '.z' }];
    const previews: Previews = [{ name: 'other.png', kind: 'image' }];
    const imageSrcs = ['data:o'];

    const { container } = render(<CaptureContextRow rows={rows} imageSrcs={imageSrcs} previews={previews} />);

    // Chip still present.
    expect(screen.getByTestId('chat-user-capture-element1')).toBeInTheDocument();

    // No img — placeholder (ImageIcon) shown instead.
    expect(container.querySelector('img')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B6 — empty rows → component returns null
// ---------------------------------------------------------------------------

describe('CaptureContextRow — B6: empty rows array renders nothing', () => {
  it('does not render the container when rows is empty', () => {
    render(<CaptureContextRow rows={[]} imageSrcs={[]} previews={undefined} />);

    expect(screen.queryByTestId('chat-user-capture-row')).not.toBeInTheDocument();
  });
});
