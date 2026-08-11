import { describe, expect, it } from 'vitest';
import { derivePanelMode, gutterFitsPanel, INLINE_MIN_WIDTH, PANEL_BLOCK_WIDTH } from '../panel-mode';

describe('INLINE_MIN_WIDTH', () => {
  it('reserves the card, the rail and their margins in ONE gutter', () => {
    // ml-2 8 + w-72 288 + (ml-1 4 + mr-2 8) + rail 42
    expect(PANEL_BLOCK_WIDTH).toBe(350);
  });

  it('is the transcript column plus BOTH gutters — 1468px', () => {
    // max-w-3xl 768 (border-box: px-5 is inside) + 2 × 350
    expect(INLINE_MIN_WIDTH).toBe(1468);
  });
});

describe('gutterFitsPanel', () => {
  it('fits at the exact threshold and not one pixel below', () => {
    expect(gutterFitsPanel(1468)).toBe(true);
    expect(gutterFitsPanel(1467)).toBe(false);
  });

  it('does not fit at an unmeasured (zero) width', () => {
    expect(gutterFitsPanel(0)).toBe(false);
  });
});

describe('derivePanelMode — the gutter fits', () => {
  it('sits inline at the exact threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1468, overlayOpen: false })).toBe('inline');
  });

  it('is inline well above the threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1820, overlayOpen: false })).toBe('inline');
  });

  it('never floats when there is room — a stale overlay flag is ignored', () => {
    expect(derivePanelMode({ surfaceWidth: 1468, overlayOpen: true })).toBe('inline');
    expect(derivePanelMode({ surfaceWidth: 1820, overlayOpen: true })).toBe('inline');
  });
});

describe('derivePanelMode — the gutter is short', () => {
  it('drops to the rail one pixel below the threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1467, overlayOpen: false })).toBe('rail');
  });

  it('holds the rail at any measured width — it has no minimum', () => {
    expect(derivePanelMode({ surfaceWidth: 876, overlayOpen: false })).toBe('rail');
    expect(derivePanelMode({ surfaceWidth: 640, overlayOpen: false })).toBe('rail');
    expect(derivePanelMode({ surfaceWidth: 1, overlayOpen: false })).toBe('rail');
  });

  it('floats as an overlay once a rail click asks for it', () => {
    expect(derivePanelMode({ surfaceWidth: 1467, overlayOpen: true })).toBe('overlay');
    expect(derivePanelMode({ surfaceWidth: 900, overlayOpen: true })).toBe('overlay');
  });

  it('keeps the overlay available on a narrow surface — nothing is too small to float', () => {
    expect(derivePanelMode({ surfaceWidth: 640, overlayOpen: true })).toBe('overlay');
    expect(derivePanelMode({ surfaceWidth: 1, overlayOpen: true })).toBe('overlay');
  });
});

describe('derivePanelMode — unmeasured', () => {
  it('hides only at a zero width, so nothing flashes before the first measure', () => {
    expect(derivePanelMode({ surfaceWidth: 0, overlayOpen: false })).toBe('hidden');
    expect(derivePanelMode({ surfaceWidth: 0, overlayOpen: true })).toBe('hidden');
  });
});
