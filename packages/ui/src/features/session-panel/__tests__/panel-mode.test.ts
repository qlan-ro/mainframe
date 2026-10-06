import { describe, expect, it } from 'vitest';
import { columnFitsPanel, derivePanelMode, GAP, INLINE_MIN_WIDTH, PANEL_WIDTH, TRANSCRIPT_MIN } from '../panel-mode';

describe('INLINE_MIN_WIDTH', () => {
  it('D20: reserves the capped transcript column, the gap and the docked panel width — 1044px', () => {
    expect(TRANSCRIPT_MIN).toBe(720);
    expect(GAP).toBe(24);
    expect(PANEL_WIDTH).toBe(300);
    expect(INLINE_MIN_WIDTH).toBe(1044);
  });
});

describe('columnFitsPanel', () => {
  it('fits at the exact threshold and not one pixel below', () => {
    expect(columnFitsPanel(1044)).toBe(true);
    expect(columnFitsPanel(1043)).toBe(false);
  });

  it('does not fit at an unmeasured (zero) width', () => {
    expect(columnFitsPanel(0)).toBe(false);
  });
});

describe('derivePanelMode — D20: the panel docks instead of floating when the column fits', () => {
  it('docks inline at the exact threshold when open', () => {
    expect(derivePanelMode({ columnWidth: 1044, open: true, overlayOpen: false })).toBe('inline');
  });

  it('docks inline well above the threshold when open', () => {
    expect(derivePanelMode({ columnWidth: 1820, open: true, overlayOpen: false })).toBe('inline');
  });

  it('never overlays when the column fits — a stale overlay flag is ignored', () => {
    expect(derivePanelMode({ columnWidth: 1044, open: true, overlayOpen: true })).toBe('inline');
    expect(derivePanelMode({ columnWidth: 1820, open: true, overlayOpen: true })).toBe('inline');
  });
});

describe('derivePanelMode — the column is short', () => {
  it('drops to overlay-or-hidden one pixel below the threshold', () => {
    expect(derivePanelMode({ columnWidth: 1043, open: true, overlayOpen: false })).toBe('hidden');
    expect(derivePanelMode({ columnWidth: 1043, open: true, overlayOpen: true })).toBe('overlay');
  });

  it('holds overlay-or-hidden at any measured width — it has no minimum', () => {
    expect(derivePanelMode({ columnWidth: 876, open: true, overlayOpen: false })).toBe('hidden');
    expect(derivePanelMode({ columnWidth: 876, open: true, overlayOpen: true })).toBe('overlay');
    expect(derivePanelMode({ columnWidth: 1, open: true, overlayOpen: false })).toBe('hidden');
    expect(derivePanelMode({ columnWidth: 1, open: true, overlayOpen: true })).toBe('overlay');
  });
});

describe('derivePanelMode — closed', () => {
  it('D20: hides whatever the width once the persisted bit is closed', () => {
    expect(derivePanelMode({ columnWidth: 1820, open: false, overlayOpen: false })).toBe('hidden');
    expect(derivePanelMode({ columnWidth: 1820, open: false, overlayOpen: true })).toBe('hidden');
    expect(derivePanelMode({ columnWidth: 0, open: false, overlayOpen: false })).toBe('hidden');
  });
});

describe('derivePanelMode — unmeasured', () => {
  it('hides at a zero width even while open, so nothing flashes before the first measure', () => {
    expect(derivePanelMode({ columnWidth: 0, open: true, overlayOpen: false })).toBe('hidden');
    expect(derivePanelMode({ columnWidth: 0, open: true, overlayOpen: true })).toBe('hidden');
  });
});
