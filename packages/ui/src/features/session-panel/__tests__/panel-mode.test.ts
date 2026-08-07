import { describe, expect, it } from 'vitest';
import {
  derivePanelMode,
  gutterFitsPanel,
  gutterFitsRail,
  INLINE_MIN_WIDTH,
  PANEL_BLOCK_WIDTH,
  RAIL_MIN_WIDTH,
} from '../panel-mode';

describe('INLINE_MIN_WIDTH', () => {
  it('reserves the card, the rail and their margins in ONE gutter', () => {
    // ml-2 8 + w-80 320 + (ml-1 4 + mr-2 8) + rail 42
    expect(PANEL_BLOCK_WIDTH).toBe(382);
  });

  it('is the transcript column plus BOTH gutters — 1532px', () => {
    // max-w-3xl 768 (border-box: px-5 is inside) + 2 × 382
    expect(INLINE_MIN_WIDTH).toBe(1532);
  });
});

describe('RAIL_MIN_WIDTH', () => {
  it('is the transcript column plus a rail block in BOTH gutters — 876px', () => {
    // 768 + 2 × (rail 42 + ml-1 4 + mr-2 8)
    expect(RAIL_MIN_WIDTH).toBe(876);
  });
});

describe('gutterFitsRail', () => {
  it('fits at the exact threshold and not one pixel below', () => {
    expect(gutterFitsRail(876)).toBe(true);
    expect(gutterFitsRail(875)).toBe(false);
  });
});

describe('gutterFitsPanel', () => {
  it('fits at the exact threshold and not one pixel below', () => {
    expect(gutterFitsPanel(1532)).toBe(true);
    expect(gutterFitsPanel(1531)).toBe(false);
  });

  it('does not fit at an unmeasured (zero) width', () => {
    expect(gutterFitsPanel(0)).toBe(false);
  });
});

describe('derivePanelMode — the gutter fits', () => {
  it('sits inline at the exact threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1532, userCollapsed: false, overlayOpen: false })).toBe('inline');
  });

  it('is inline well above the threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1820, userCollapsed: false, overlayOpen: false })).toBe('inline');
  });

  it('shows the rail instead when the user collapsed it', () => {
    expect(derivePanelMode({ surfaceWidth: 1820, userCollapsed: true, overlayOpen: false })).toBe('rail');
  });

  it('never floats when there is room — a stale overlay flag is ignored either way', () => {
    expect(derivePanelMode({ surfaceWidth: 1532, userCollapsed: false, overlayOpen: true })).toBe('inline');
    expect(derivePanelMode({ surfaceWidth: 1532, userCollapsed: true, overlayOpen: true })).toBe('rail');
  });
});

describe('derivePanelMode — the gutter is short', () => {
  it('drops to the rail one pixel below the threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1531, userCollapsed: false, overlayOpen: false })).toBe('rail');
  });

  it('holds the rail down to the rail threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 876, userCollapsed: false, overlayOpen: false })).toBe('rail');
  });

  it('floats as an overlay once a rail click asks for it', () => {
    expect(derivePanelMode({ surfaceWidth: 1531, userCollapsed: false, overlayOpen: true })).toBe('overlay');
    expect(derivePanelMode({ surfaceWidth: 900, userCollapsed: false, overlayOpen: true })).toBe('overlay');
  });

  it('floats regardless of the collapse preference — no room means no inline to return to', () => {
    expect(derivePanelMode({ surfaceWidth: 1200, userCollapsed: true, overlayOpen: true })).toBe('overlay');
    expect(derivePanelMode({ surfaceWidth: 1200, userCollapsed: true, overlayOpen: false })).toBe('rail');
  });
});

describe('derivePanelMode — the gutter is under even the rail', () => {
  it('hides everything one pixel below the rail threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 875, userCollapsed: false, overlayOpen: false })).toBe('hidden');
  });

  it('hides at an unmeasured (zero) width, so nothing flashes before the first measure', () => {
    expect(derivePanelMode({ surfaceWidth: 0, userCollapsed: false, overlayOpen: false })).toBe('hidden');
  });

  it('ignores a stale overlay flag and the collapse preference alike', () => {
    expect(derivePanelMode({ surfaceWidth: 640, userCollapsed: false, overlayOpen: true })).toBe('hidden');
    expect(derivePanelMode({ surfaceWidth: 640, userCollapsed: true, overlayOpen: false })).toBe('hidden');
  });
});
