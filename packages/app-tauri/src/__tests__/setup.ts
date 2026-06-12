/**
 * Vitest global setup for the jsdom environment.
 *
 * Mirrors packages/desktop/src/__tests__/setup.ts: a localStorage shim, the
 * React act environment flag, jest-dom matchers, and a ResizeObserver stub for
 * Radix-based primitives (scroll-area, collapsible).
 *
 * Also stubs DOM Range methods required by CodeMirror 6: CM6 measures text
 * via Range.getClientRects / getBoundingClientRect which jsdom doesn't
 * implement. Zero-rect stubs satisfy the calls without crashing.
 */
const store = new Map<string, string>();

const localStorageShim: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageShim,
  writable: true,
  configurable: true,
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import '@testing-library/jest-dom';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;

// ── CodeMirror 6 DOM stubs ───────────────────────────────────────────────────
// CM6 measures text via Range client rects; jsdom returns undefined for these.
// Zero-rect stubs prevent "Cannot read properties of undefined" crashes.

const zeroRect: DOMRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
};

function zeroRectList(): DOMRectList {
  return {
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {
      /* jsdom measurement stub */
    },
  } as unknown as DOMRectList;
}

// Guard: this global setup file is also loaded by `@vitest-environment node`
// test files, where `Range` (a DOM global) is undefined.
if (typeof Range !== 'undefined') {
  Range.prototype.getClientRects = zeroRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
}

// ── scrollIntoView stub ──────────────────────────────────────────────────────
// jsdom does not implement Element.scrollIntoView — it throws "not a function".
// Stub it globally so keyboard-navigation tests (ArrowUp/Down) don't crash.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {
    /* jsdom stub */
  };
}
