// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { captureReadingAnchor, restoreReadingAnchor } from '../reading-anchor';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'caretRangeFromPoint');
});

function fixture() {
  const viewport = document.createElement('div');
  const text = document.createTextNode('Visible reading anchor');
  viewport.append(text);
  const range = document.createRange();
  range.setStart(text, 0);
  let width = 600;
  let textTop = 12;
  Object.defineProperty(viewport, 'clientWidth', { get: () => width });
  Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: vi.fn(() => range) });
  range.getBoundingClientRect = () => ({ top: textTop - viewport.scrollTop }) as DOMRect;
  return {
    viewport,
    text,
    resize() {
      width = 380;
      textTop = 202;
    },
  };
}

it('keeps the visible text offset when width reflow moves it', () => {
  const f = fixture();
  const anchor = captureReadingAnchor(f.viewport, null);
  f.resize();
  expect(captureReadingAnchor(f.viewport, anchor)).toBe(anchor);
  const restored = restoreReadingAnchor(f.viewport, anchor);
  expect(f.viewport.scrollTop).toBe(190);
  expect(restored?.offset).toBe(12);
  expect(restored?.width).toBe(380);
  restoreReadingAnchor(f.viewport, restored);
  expect(f.viewport.scrollTop).toBe(190);
});

it('discards detached anchors instead of moving a different transcript', () => {
  const f = fixture();
  const anchor = captureReadingAnchor(f.viewport, null);
  f.text.remove();
  f.resize();
  expect(restoreReadingAnchor(f.viewport, anchor)).toBeNull();
  expect(f.viewport.scrollTop).toBe(0);
});
