import { describe, expect, it } from 'vitest';
import { derivePanelMode, INLINE_MIN_WIDTH } from '../panel-mode';

describe('INLINE_MIN_WIDTH', () => {
  it('is the documented 1000px threshold', () => {
    expect(INLINE_MIN_WIDTH).toBe(1000);
  });
});

describe('derivePanelMode', () => {
  it('sits inline at the exact threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1000, overlayOpen: false })).toBe('inline');
  });

  it('drops to the rail one pixel below the threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 999, overlayOpen: false })).toBe('rail');
  });

  it('is rail at an unmeasured (zero) width', () => {
    expect(derivePanelMode({ surfaceWidth: 0, overlayOpen: false })).toBe('rail');
  });

  it('floats as an overlay when narrow and the overlay is open', () => {
    expect(derivePanelMode({ surfaceWidth: 999, overlayOpen: true })).toBe('overlay');
    expect(derivePanelMode({ surfaceWidth: 640, overlayOpen: true })).toBe('overlay');
  });

  it('stays inline when wide, even with a stale overlay flag', () => {
    expect(derivePanelMode({ surfaceWidth: 1000, overlayOpen: true })).toBe('inline');
    expect(derivePanelMode({ surfaceWidth: 1600, overlayOpen: true })).toBe('inline');
  });

  it('is inline well above the threshold', () => {
    expect(derivePanelMode({ surfaceWidth: 1440, overlayOpen: false })).toBe('inline');
  });
});
