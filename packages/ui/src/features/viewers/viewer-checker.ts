import type { CSSProperties } from 'react';

/**
 * Transparency checkerboard backdrop shared by the image + SVG preview canvases.
 * Mirrors the prototype `CHECKER` in docs/design-reference/prototype/15-viewers.jsx:
 * a warm 18px tile built from four diagonal linear gradients (NOT a conic
 * gradient — both viewers must read identically).
 */
export const checkerStyle: CSSProperties = {
  backgroundColor: 'var(--mf-viewer-check-a)',
  backgroundImage: [
    'linear-gradient(45deg,var(--mf-viewer-check-b) 25%,transparent 25%)',
    'linear-gradient(-45deg,var(--mf-viewer-check-b) 25%,transparent 25%)',
    'linear-gradient(45deg,transparent 75%,var(--mf-viewer-check-b) 75%)',
    'linear-gradient(-45deg,transparent 75%,var(--mf-viewer-check-b) 75%)',
  ].join(','),
  backgroundSize: '18px 18px',
  backgroundPosition: '0 0,0 9px,9px -9px,-9px 0',
};
